"""Project-scoped, exact-coordinate schematic primitives over MCP stdio.

No CAD import, DSL interpretation, model, or design-specific data lives here.
Each request is an explicit set of generic objects supplied by the caller.
"""
from __future__ import annotations

import argparse
import copy
import csv
import datetime as dt
import hashlib
import io
import json
import math
import os
from pathlib import Path
import re
import subprocess
import sys
import uuid

import jsonschema

VERSION = "1.0.0"
PROTOCOL = "2025-03-26"
PIN_TYPES = ["input", "output", "bidirectional", "tri_state", "passive", "free", "unspecified", "power_in", "power_out", "open_collector", "open_emitter", "no_connect"]
PIN_SHAPES = ["line", "inverted", "clock", "inverted_clock", "input_low", "clock_low", "output_low", "falling_edge_clock", "non_logic"]


def obj(properties, required=()):
    return {"type": "object", "properties": properties, "required": list(required), "additionalProperties": False}


NUM = {"type": "number", "minimum": -100000, "maximum": 100000}
NONNEG = {"type": "number", "minimum": 0, "maximum": 100000}
STR = {"type": "string"}
BOOL = {"type": "boolean"}
POINT = {"type": "array", "items": NUM, "minItems": 2, "maxItems": 2}
AT = {"type": "array", "items": NUM, "minItems": 2, "maxItems": 3, "description": "[x,y,angle=0] in mm; library Y-up, schematic Y-down. No snapping."}
FONT = obj({"size": POINT, "face": STR, "bold": BOOL, "italic": BOOL, "thickness": NONNEG, "justify": {"type": "array", "items": {"enum": ["left", "right", "top", "bottom", "mirror"]}, "uniqueItems": True}})
PROP = obj({"name": STR, "value": STR, "at": AT, "visible": BOOL, "font": FONT}, ["name", "value", "at"])
PIN = obj({"number": STR, "name": STR, "at": AT, "length": NONNEG, "type": {"enum": PIN_TYPES}, "shape": {"enum": PIN_SHAPES}, "visible": BOOL, "name_visible": BOOL, "number_visible": BOOL, "name_font": FONT, "number_font": FONT}, ["number", "name", "at", "length", "type"])
GRAPHIC = obj({"kind": {"enum": ["rectangle", "rounded_rectangle", "polyline", "arc", "circle", "text"]}, "start": POINT, "mid": POINT, "end": POINT, "center": POINT, "radius": NONNEG, "rx": NONNEG, "ry": NONNEG, "points": {"type": "array", "items": POINT, "minItems": 2}, "text": STR, "at": AT, "font": FONT, "visible": BOOL, "width": NONNEG, "fill": {"enum": ["none", "outline", "background"]}, "stroke_type": {"enum": ["default", "solid", "dash", "dot", "dash_dot", "dash_dot_dot"]}}, ["kind"])
SYMBOL = obj({"name": {"type": "string", "pattern": r"^[A-Za-z0-9_+.-]+$"}, "reference_prefix": STR, "description": STR, "datasheet": STR, "footprint": STR, "pin_names_visible": BOOL, "pin_numbers_visible": BOOL, "pin_name_offset": NONNEG, "power": BOOL, "pins": {"type": "array", "items": PIN}, "graphics": {"type": "array", "items": GRAPHIC}}, ["name", "pins"])
ITEM = obj({"id": {"type": "string", "minLength": 1}, "kind": {"enum": ["component", "wire", "junction", "label", "no_connect", "text", "rectangle", "polyline", "arc", "circle"]}, "symbol": STR, "reference": STR, "value": STR, "footprint": STR, "datasheet": STR, "at": AT, "mirror": {"enum": ["x", "y"]}, "in_bom": BOOL, "on_board": BOOL, "dnp": BOOL, "exclude_from_sim": BOOL, "properties": {"type": "array", "items": PROP}, "points": {"type": "array", "items": POINT, "minItems": 2}, "width": NONNEG, "diameter": NONNEG, "text": STR, "font": FONT, "visible": BOOL, "label_type": {"enum": ["local", "global", "hierarchical"]}, "shape": {"enum": ["input", "output", "bidirectional", "tri_state", "passive"]}, "start": POINT, "mid": POINT, "end": POINT, "center": POINT, "radius": NONNEG, "fill": {"enum": ["none", "outline", "background"]}, "stroke_type": {"enum": ["default", "solid", "dash", "dot", "dash_dot", "dash_dot_dot"]}}, ["id", "kind"])
ITEM["properties"]["kind"]["enum"].append("rounded_rectangle")
ITEM["properties"].update(rx=NONNEG, ry=NONNEG)

SCHEMAS = {
    "precise_create": obj({"request_key": STR, "name": {"type": "string", "pattern": r"^[A-Za-z0-9_+.-]+$"}, "title": STR, "paper": {"enum": ["A4"]}, "portrait": BOOL}, ["request_key", "name"]),
    "precise_apply": obj({"request_key": STR, "symbols": {"type": "array", "items": SYMBOL}, "items": {"type": "array", "items": ITEM}, "delete_ids": {"type": "array", "items": STR}, "delete_symbols": {"type": "array", "items": STR}}, ["request_key"]),
    "precise_read": obj({"include_objects": BOOL, "include_source": BOOL}),
    "precise_check_export": obj({"request_key": STR, "formats": {"type": "array", "items": {"enum": ["pdf", "svg", "netlist", "erc", "bom"]}, "uniqueItems": True, "minItems": 1}}, ["request_key", "formats"]),
}
DESCRIPTIONS = {
    "precise_create": "Create an empty A4 schematic in the server's fixed new-project root. No import. Idempotent request_key.",
    "precise_apply": "Atomically upsert explicit symbols and schematic primitives by stable name/id. All coordinates exact mm, no grid snap or inferred connectivity. Symbol local Y-up; page Y-down. Request keys prevent replay duplicates. Upsert replaces the complete object.",
    "precise_read": "Read actual schematic fingerprint and compare it with the authored model; return object model and transformed pin coordinates. Reject externally changed files.",
    "precise_check_export": "Validate via installed KiCad CLI, export PDF/SVG/KiCad XML netlist/ERC JSON/BOM. ERC findings are reported, never suppressed. Outputs remain inside project root.",
}


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def digest(value):
    return hashlib.sha256((value if isinstance(value, bytes) else canonical(value).encode("utf-8"))).hexdigest()


def q(value):
    return json.dumps(str(value), ensure_ascii=False)


def n(value):
    value = float(value)
    if not math.isfinite(value):
        raise ValueError("Coordinates must be finite")
    return f"{value:.9f}".rstrip("0").rstrip(".") or "0"


def at(value):
    return f"(at {n(value[0])} {n(value[1])} {n(value[2] if len(value) == 3 else 0)})"


def xy(value, tag="xy"):
    return f"({tag} {n(value[0])} {n(value[1])})"


def yn(value):
    return "yes" if value else "no"


def effects(font=None, visible=True):
    font = font or {}
    size = font.get("size", [1.27, 1.27])
    face = f" (face {q(font['face'])})" if font.get("face") else ""
    style = (" (bold yes)" if font.get("bold") else "") + (" (italic yes)" if font.get("italic") else "")
    thickness = f" (thickness {n(font['thickness'])})" if "thickness" in font else ""
    justify = " (justify " + " ".join(font["justify"]) + ")" if font.get("justify") else ""
    hide = "" if visible else " (hide yes)"
    return f"(effects (font{face} (size {n(size[0])} {n(size[1])}){thickness}{style}){justify}{hide})"


def prop(p):
    return f"(property {q(p['name'])} {q(p['value'])} {at(p['at'])} {effects(p.get('font'), p.get('visible', True))})"


def stroke(item):
    return f"(stroke (width {n(item.get('width', 0))}) (type {item.get('stroke_type', 'default')}))"


def graphic(item, identifier=None):
    kind = item["kind"]
    if kind == "rounded_rectangle":
        item = {**item, "kind": "polyline", "points": rounded_rectangle_points(item)}
        kind = "polyline"
    suffix = f" (uuid {q(identifier)})" if identifier else ""
    if kind == "text":
        return f"(text {q(item['text'])} {at(item['at'])} {effects(item.get('font'), item.get('visible', True))}{suffix})"
    if kind == "rectangle":
        geometry = xy(item["start"], "start") + " " + xy(item["end"], "end")
    elif kind == "polyline":
        geometry = "(pts " + " ".join(xy(p) for p in item["points"]) + ")"
    elif kind == "arc":
        geometry = " ".join(xy(item[tag], tag) for tag in ["start", "mid", "end"])
    elif kind == "circle":
        geometry = xy(item["center"], "center") + f" (radius {n(item['radius'])})"
    else:
        raise ValueError("Unknown graphic kind")
    return f"({kind} {geometry} {stroke(item)} (fill (type {item.get('fill', 'none')})){suffix})"


def rounded_rectangle_points(item):
    """Ellipse-corner polyline; maximum chord error <= 0.00025 mm.

    R=max(rx,ry) bounds ellipse curvature interpolation error by the scaled
    unit-circle sagitta. Extrema and straight-side endpoints are exact.
    """
    x0, x1 = sorted([item["start"][0], item["end"][0]])
    y0, y1 = sorted([item["start"][1], item["end"][1]])
    rx, ry = min(item["rx"], (x1-x0)/2), min(item["ry"], (y1-y0)/2)
    if not rx or not ry:
        return [[x0,y0], [x1,y0], [x1,y1], [x0,y1], [x0,y0]]
    radius = max(rx, ry)
    step = 2 * math.acos(max(-1, min(1, 1 - 0.00025 / radius)))
    segments = max(2, math.ceil(math.pi/2/step))
    points = []
    for cx, cy, a0 in [(x1-rx, y1-ry, 0), (x0+rx, y1-ry, 90), (x0+rx, y0+ry, 180), (x1-rx, y0+ry, 270)]:
        for i in range(segments+1):
            angle = math.radians(a0 + 90*i/segments)
            points.append([round(cx + rx*math.cos(angle),9), round(cy + ry*math.sin(angle),9)])
    return points + [points[0]]


def symbol_definition(s, embedded=True):
    name = s["name"]
    lib_name = "Precise:" + name if embedded else name
    head = [f"(symbol {q(lib_name)}", "(exclude_from_sim no) (in_bom yes) (on_board yes)"]
    if s.get("power"):
        head.append("(power)")
    head.append(f"(pin_names (offset {n(s.get('pin_name_offset', 0.508))})" + (" (hide yes)" if not s.get("pin_names_visible", True) else "") + ")")
    if not s.get("pin_numbers_visible", True):
        head.append("(pin_numbers (hide yes))")
    for key, value, visible in [("Reference", s.get("reference_prefix", "U"), True), ("Value", name, True), ("Footprint", s.get("footprint", ""), False), ("Datasheet", s.get("datasheet", ""), False), ("Description", s.get("description", ""), False)]:
        head.append(prop({"name": key, "value": value, "at": [0, 0], "visible": visible}))
    head.append(f"(symbol {q(name + '_0_1')} " + " ".join(graphic(g) for g in s.get("graphics", [])) + ")")
    pins = []
    for p in s["pins"]:
        hide = "" if p.get("visible", True) else " (hide yes)"
        pins.append(f"(pin {p['type']} {p.get('shape', 'line')} {at(p['at'])} (length {n(p['length'])}){hide} (name {q(p['name'])} {effects(p.get('name_font'), p.get('name_visible', True))}) (number {q(p['number'])} {effects(p.get('number_font'), p.get('number_visible', True))}))")
    head.append(f"(symbol {q(name + '_1_1')} " + " ".join(pins) + ")")
    return "\n  ".join(head) + ")"


def ident(state, value):
    return str(uuid.uuid5(uuid.UUID(state["uuid"]), value))


def component(state, item):
    symbol = state["symbols"][item["symbol"]]
    parts = [f"(symbol (lib_id {q('Precise:' + item['symbol'])}) {at(item['at'])} (unit 1)"]
    if item.get("mirror"):
        parts.append(f"(mirror {item['mirror']})")
    parts += [f"(exclude_from_sim {yn(item.get('exclude_from_sim', False))}) (in_bom {yn(item.get('in_bom', True))}) (on_board {yn(item.get('on_board', True))}) (dnp {yn(item.get('dnp', False))})", f"(uuid {q(ident(state, item['id']))})"]
    defaults = [("Reference", item["reference"], True), ("Value", item.get("value", item["symbol"]), True), ("Footprint", item.get("footprint", symbol.get("footprint", "")), False), ("Datasheet", item.get("datasheet", symbol.get("datasheet", "")), False)]
    props = {p["name"]: p for p in item.get("properties", [])}
    for key, value, visible in defaults:
        if key not in props:
            props[key] = {"name": key, "value": value, "at": item["at"][:2], "visible": visible}
        elif key == "Reference" and props[key]["value"] != item["reference"]:
            raise ValueError("Reference property must match reference")
    parts.extend(prop(p) for p in props.values())
    parts.extend(f"(pin {q(p['number'])} (uuid {q(ident(state, item['id'] + '/pin/' + p['number']))}))" for p in symbol["pins"])
    parts.append(f"(instances (project {q(state['name'])} (path {q('/' + state['uuid'])} (reference {q(item['reference'])}) (unit 1))))")
    return "\n  ".join(parts) + ")"


def render(state):
    paper = '(paper "A4" portrait)' if state.get("portrait") else '(paper "A4")'
    parts = [f'(kicad_sch (version 20260101) (generator "precise_mcp") (generator_version "10.0") (uuid {q(state["uuid"])}) {paper}', f'(title_block (title {q(state.get("title", ""))}))', "(lib_symbols " + "\n".join(symbol_definition(state["symbols"][key]) for key in sorted(state["symbols"])) + ")"]
    for key in sorted(state["items"]):
        item = state["items"][key]
        kind, uid = item["kind"], ident(state, item["id"])
        if kind == "component":
            parts.append(component(state, item))
        elif kind == "wire":
            for index, (a, b) in enumerate(zip(item["points"], item["points"][1:])):
                parts.append(f"(wire (pts {xy(a)} {xy(b)}) {stroke(item)} (uuid {q(ident(state, item['id'] + '/' + str(index)))}))")
        elif kind == "junction":
            parts.append(f"(junction {xy(item['at'], 'at')} (diameter {n(item.get('diameter', 0))}) (color 0 0 0 0) (uuid {q(uid)}))")
        elif kind == "no_connect":
            parts.append(f"(no_connect {xy(item['at'], 'at')} (uuid {q(uid)}))")
        elif kind == "label":
            label_kind = {"local": "label", "global": "global_label", "hierarchical": "hierarchical_label"}[item.get("label_type", "local")]
            shape = "" if label_kind == "label" else f" (shape {item.get('shape', 'input')})"
            parts.append(f"({label_kind} {q(item['text'])}{shape} {at(item['at'])} {effects(item.get('font'), item.get('visible', True))} (uuid {q(uid)}))")
        else:
            parts.append(graphic(item, uid))
    parts.append('(sheet_instances (path "/" (page "1")))')
    return "\n".join(parts) + "\n)\n"


def validate_model(state):
    references = set()
    needed = {"component": ["symbol", "reference", "at"], "wire": ["points"], "junction": ["at"], "no_connect": ["at"], "label": ["text", "at"], "text": ["text", "at"], "rectangle": ["start", "end"], "rounded_rectangle": ["start", "end", "rx", "ry"], "circle": ["center", "radius"], "arc": ["start", "mid", "end"], "polyline": ["points"]}
    for symbol in state["symbols"].values():
        numbers = [p["number"] for p in symbol["pins"]]
        if len(numbers) != len(set(numbers)):
            raise ValueError("Duplicate pin number in " + symbol["name"])
        # KiCad 10 does not honor per-pin name/number effects.hide. Reject
        # contradictory requests rather than silently rendering different intent.
        for per_pin, global_flag in [("name_visible", "pin_names_visible"), ("number_visible", "pin_numbers_visible")]:
            explicit = {p[per_pin] for p in symbol["pins"] if per_pin in p}
            if len(explicit) > 1:
                raise ValueError(f"{symbol['name']}: mixed {per_pin} is unsupported by KiCad 10; report capability gap")
            if explicit and next(iter(explicit)) != symbol.get(global_flag, True):
                raise ValueError(f"{symbol['name']}: set symbol-level {global_flag} consistently with {per_pin}; per-pin effects.hide is not effective in KiCad 10")
        for graphic_item in symbol.get("graphics", []):
            for field in needed[graphic_item["kind"]]:
                if field not in graphic_item:
                    raise ValueError(f"{graphic_item['kind']} requires {field}")
    for item in state["items"].values():
        for field in needed[item["kind"]]:
            if field not in item:
                raise ValueError(f"{item['id']}: {item['kind']} requires {field}")
        if item["kind"] == "component":
            if item["symbol"] not in state["symbols"]:
                raise ValueError("Undefined symbol: " + item["symbol"])
            decoration = not state["symbols"][item["symbol"]]["pins"] and not item.get("on_board", True) and not item.get("in_bom", True)
            if item["reference"] in references and not decoration:
                raise ValueError("Duplicate reference: " + item["reference"])
            references.add(item["reference"])
            names = [p["name"] for p in item.get("properties", [])]
            if len(names) != len(set(names)):
                raise ValueError("Duplicate component property")
        if item["kind"] == "wire" and any(a == b for a, b in zip(item["points"], item["points"][1:])):
            raise ValueError("Zero-length wire segment: " + item["id"])


def pin_locations(state):
    result = []
    for item in state["items"].values():
        if item["kind"] != "component":
            continue
        theta = math.radians(item["at"][2] if len(item["at"]) == 3 else 0)
        for pin in state["symbols"][item["symbol"]]["pins"]:
            x, y = pin["at"][:2]
            wx = x * math.cos(theta) - y * math.sin(theta)
            wy = -(x * math.sin(theta) + y * math.cos(theta))
            if item.get("mirror") == "x":
                wy = -wy
            if item.get("mirror") == "y":
                wx = -wx
            # KiCad rounds library-local positions and placement independently
            # to schematic internal units (100 nm); this can differ by 1 IU
            # from rounding the mathematical sum. Report, never silently snap.
            ix, iy = to_iu(x), to_iu(y)
            nx = int(round(ix * math.cos(theta) - iy * math.sin(theta)))
            ny = -int(round(ix * math.sin(theta) + iy * math.cos(theta)))
            if item.get("mirror") == "x":
                ny = -ny
            if item.get("mirror") == "y":
                nx = -nx
            native = [(nx + to_iu(item["at"][0])) / 10000, (ny + to_iu(item["at"][1])) / 10000]
            result.append({"reference": item["reference"], "number": pin["number"], "name": pin["name"], "type": pin["type"], "at": [round(wx + item["at"][0], 9), round(wy + item["at"][1], 9)], "native_at": native})
    return result


def to_iu(value):
    return int(float(value) * 10000 + (0.5 if value >= 0 else -0.5))


class Engine:
    def __init__(self, root, cli):
        self.root = Path(root).resolve()
        self.cli = str(Path(cli).resolve())
        self.root.mkdir(parents=True, exist_ok=True)
        self.state_path = self.path(".precise-state.json")
        self.audit_path = self.path("mcp-audit.jsonl")

    def path(self, name):
        p = (self.root / name).resolve()
        if not p.is_relative_to(self.root) or p == self.root:
            raise ValueError("Path must remain inside the project root")
        return p

    def atomic(self, path, text):
        path = self.path(path.name)
        temp = self.path(path.name + ".tmp")
        temp.write_text(text, encoding="utf-8", newline="\n")
        os.replace(temp, path)

    def load(self):
        if not self.state_path.exists():
            raise ValueError("Call precise_create first")
        state = json.loads(self.state_path.read_text(encoding="utf-8"))
        actual = self.path(state["name"] + ".kicad_sch").read_bytes()
        if actual != render(state).encode("utf-8"):
            raise ValueError("Schematic was changed outside MCP; refusing to overwrite or misreport it")
        return state

    def save(self, state):
        validate_model(state)
        schematic = render(state)
        library = '(kicad_symbol_lib (version 20241209) (generator "precise_mcp")\n' + "\n".join(symbol_definition(state["symbols"][key], False) for key in sorted(state["symbols"])) + "\n)\n"
        self.atomic(self.path(state["name"] + ".kicad_sch"), schematic)
        self.atomic(self.path("Precise.kicad_sym"), library)
        self.atomic(self.path("sym-lib-table"), '(sym_lib_table (version 7) (lib (name "Precise") (type "KiCad") (uri "${KIPRJMOD}/Precise.kicad_sym") (options "") (descr "Explicit MCP-authored symbols")))\n')
        self.atomic(self.state_path, canonical(state))

    def summary(self, state):
        counts = {}
        for item in state["items"].values():
            counts[item["kind"]] = counts.get(item["kind"], 0) + 1
        path = self.path(state["name"] + ".kicad_sch")
        return {"project_root": str(self.root), "schematic": str(path), "schematic_sha256": digest(path.read_bytes()), "symbol_count": len(state["symbols"]), "item_counts": counts, "revision": state["revision"]}

    def audit(self, name, args, result, is_error=False):
        previous = ""
        if self.audit_path.exists():
            lines = self.audit_path.read_text(encoding="utf-8").splitlines()
            if lines:
                previous = json.loads(lines[-1])["entry_sha256"]
        entry = {"time_utc": dt.datetime.now(dt.timezone.utc).isoformat(), "tool": name, "arguments": args, "arguments_sha256": digest(args), "result": result, "result_sha256": digest(result), "is_error": is_error, "previous_entry_sha256": previous}
        entry["entry_sha256"] = digest(entry)
        with self.audit_path.open("a", encoding="utf-8", newline="\n") as f:
            f.write(canonical(entry) + "\n")

    def call(self, name, args):
        lock = self.path(".precise-lock")
        try:
            lock_fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            raise ValueError("Project is busy; retry after the active MCP request finishes")
        try:
            os.close(lock_fd)
            if name not in SCHEMAS:
                raise ValueError("Unknown tool")
            jsonschema.validate(args, SCHEMAS[name])
            result = self.execute(name, args)
            self.audit(name, args, result)
            return result
        except Exception as error:
            self.audit(name, args, {"error": str(error)}, True)
            raise
        finally:
            lock.unlink(missing_ok=True)

    def execute(self, name, args):
        key = args.get("request_key")
        request_hash = digest({"tool": name, "arguments": args})
        state = self.load() if self.state_path.exists() else None
        if state and key in state["requests"]:
            old = state["requests"][key]
            if old["hash"] != request_hash:
                raise ValueError("request_key reused with different arguments")
            return {**old["result"], "idempotent_replay": True}
        if name == "precise_create":
            if state:
                raise ValueError("Project already initialized")
            if any(p.suffix in [".kicad_sch", ".kicad_sym", ".kicad_pro", ".SchDoc", ".PcbDoc"] for p in self.root.iterdir()):
                raise ValueError("Refusing to initialize over existing CAD files")
            state = {"name": args["name"], "title": args.get("title", ""), "portrait": args.get("portrait", False), "uuid": str(uuid.uuid4()), "symbols": {}, "items": {}, "requests": {}, "revision": 0}
            self.save(state)
            self.atomic(self.path(state["name"] + ".kicad_pro"), json.dumps({"meta": {"filename": state["name"] + ".kicad_pro", "version": 1}, "net_settings": {"classes": [{"name": "Default", "clearance": 0.2, "track_width": 0.25}], "meta": {"version": 4}}}, indent=2))
            result = self.summary(state)
        elif state is None:
            raise ValueError("Call precise_create first")
        elif name == "precise_apply":
            state = copy.deepcopy(state)
            for s in args.get("symbols", []):
                state["symbols"][s["name"]] = s
            for item in args.get("items", []):
                state["items"][item["id"]] = item
            for oid in args.get("delete_ids", []):
                state["items"].pop(oid, None)
            for sym in args.get("delete_symbols", []):
                state["symbols"].pop(sym, None)
            state["revision"] += 1
            self.save(state)
            result = self.summary(state)
        elif name == "precise_read":
            result = {**self.summary(state), "pins": pin_locations(state), "file_matches_model": True}
            if args.get("include_objects", True):
                result.update(symbols=list(state["symbols"].values()), items=list(state["items"].values()))
            if args.get("include_source", False):
                result["source"] = render(state)
            return result
        elif name == "precise_check_export":
            result = self.export(state, args["formats"])
        if key:
            state["requests"][key] = {"hash": request_hash, "result": result}
            self.atomic(self.state_path, canonical(state))
        return result

    def export(self, state, formats):
        validate_model(state)
        sch = self.path(state["name"] + ".kicad_sch")
        result = {**self.summary(state), "outputs": {}, "commands": [], "erc": None}
        # A real KiCad parse/netlist export is mandatory, even for PDF-only calls.
        formats = list(dict.fromkeys(["netlist"] + formats))
        for fmt in formats:
            if fmt == "bom":
                out = self.path(state["name"] + "-bom.csv")
                buffer = io.StringIO(newline="")
                writer = csv.writer(buffer)
                components = [item for item in state["items"].values() if item["kind"] == "component"]
                custom_names = sorted({p["name"] for item in components for p in item.get("properties", []) if p["name"] not in ["Reference", "Value", "Footprint"]})
                writer.writerow(["Reference", "Value", "Footprint", "InBOM", "OnBoard", "DNP", "PinCount", "ObjectRole"] + custom_names)
                for item in state["items"].values():
                    if item["kind"] == "component":
                        values = {p["name"]: p["value"] for p in item.get("properties", [])}
                        symbol = state["symbols"][item["symbol"]]
                        role = "erc-helper" if values.get("Role") == "ERCHelper" else "schematic-decoration" if not symbol["pins"] else "component"
                        writer.writerow([item["reference"], values.get("Value", item.get("value", item["symbol"])), values.get("Footprint", item.get("footprint", symbol.get("footprint", ""))), item.get("in_bom", True), item.get("on_board", True), item.get("dnp", False), len(symbol["pins"]), role] + [values.get(name, "") for name in custom_names])
                self.atomic(out, buffer.getvalue())
            else:
                extension = {"netlist": ".net.xml", "erc": "-erc.json", "pdf": ".pdf", "svg": ".svg"}[fmt]
                out = self.path(state["name"] + extension)
                if fmt == "erc":
                    command = [self.cli, "sch", "erc", "--format", "json", "--severity-all", "--exit-code-violations", "-o", str(out), str(sch)]
                elif fmt == "svg":
                    command = [self.cli, "sch", "export", "svg", "-o", str(self.root) + os.sep, str(sch)]
                else:
                    command = [self.cli, "sch", "export", "netlist" if fmt == "netlist" else "pdf"]
                    if fmt == "netlist":
                        command += ["--format", "kicadxml"]
                    command += ["-o", str(out), str(sch)]
                run = subprocess.run(command, capture_output=True, encoding="utf-8", errors="replace", timeout=90, cwd=self.root)
                result["commands"].append({"argv": command, "exit_code": run.returncode, "stdout": run.stdout, "stderr": run.stderr})
                if run.returncode != 0 and not (fmt == "erc" and run.returncode == 5 and out.exists()):
                    raise ValueError(f"KiCad {fmt} failed ({run.returncode}): {run.stdout} {run.stderr}")
                if not out.exists():
                    raise ValueError(f"KiCad did not produce {out.name}")
                if fmt == "erc":
                    report = json.loads(out.read_text(encoding="utf-8-sig"))
                    violations = [v for sheet in report.get("sheets", []) for v in sheet.get("violations", [])]
                    result["erc"] = {"violation_count": len(violations), "by_severity": {severity: sum(v.get("severity") == severity for v in violations) for severity in ["error", "warning", "exclusion"]}, "violations": violations}
            result["outputs"][fmt] = {"path": str(out), "sha256": digest(out.read_bytes()), "bytes": out.stat().st_size}
        return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    parser.add_argument("--kicad-cli", default="D:/Kicad/bin/kicad-cli.exe")
    args = parser.parse_args()
    sys.stdin.reconfigure(encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8", newline="\n")
    engine = Engine(args.root, args.kicad_cli)
    initialized = False
    for line in sys.stdin:
        request = None
        try:
            request = json.loads(line)
            method = request.get("method")
            if method == "initialize":
                result = {"protocolVersion": PROTOCOL, "capabilities": {"tools": {}}, "serverInfo": {"name": "precise-kicad-mcp", "version": VERSION}}
                initialized = True
            elif method == "notifications/initialized":
                continue
            elif method == "ping":
                result = {}
            elif not initialized:
                raise ValueError("Initialize the MCP session first")
            elif method == "tools/list":
                result = {"tools": [{"name": name, "description": DESCRIPTIONS[name], "inputSchema": schema} for name, schema in SCHEMAS.items()]}
            elif method == "tools/call":
                try:
                    response = engine.call(request["params"]["name"], request["params"].get("arguments", {}))
                    result = {"content": [{"type": "text", "text": canonical(response)}], "isError": False}
                except Exception as error:
                    result = {"content": [{"type": "text", "text": canonical({"error": str(error)})}], "isError": True}
            elif method and method.startswith("notifications/"):
                continue
            else:
                raise ValueError("Unsupported MCP method: " + str(method))
            if "id" in request:
                print(canonical({"jsonrpc": "2.0", "id": request["id"], "result": result}), flush=True)
        except Exception as error:
            print(canonical({"jsonrpc": "2.0", "id": request.get("id") if isinstance(request, dict) else None, "error": {"code": -32602, "message": str(error)}}), flush=True)


if __name__ == "__main__":
    main()
