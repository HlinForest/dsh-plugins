"""Compact, topology-driven placement for independent input R-C pairs.

The generic layout fallback can otherwise send a chain of a series resistor and
an input capacitor through a layered router.  This helper handles only the
small local island that is already recognized by :mod:`functional_groups`:
each resistor has one terminal on a signal-side net shared with exactly one
capacitor terminal, and the capacitor's other terminal is on one evidenced
return rail.  The helper does not change the design or symbol records.  It
returns the same local placement shape as the other motif helpers, so the
caller can still pack the group adaptively on the page.

No component reference, net name, component count, or source-CAD coordinate is
special-cased here.  Component widths, heights, local pin positions and pin
directions are the only geometry inputs.  If the topology or native symbol
orientation is ambiguous, ``place`` returns ``None`` and the caller keeps its
normal layout path.
"""

import math
import re

from functional_groups import (
    _is_kind,
    _is_passive,
    _is_shared_return_net,
    _kind,
    _power_nets,
)


_GRID = 1.27
_POWER_NAME = re.compile(
    r"^(?:[+-]?(?:\d+(?:\.\d+)?V\d*|\d+V\d+)(?:[_-][A-Z0-9]+)*|"
    r"VCC|VDD|VSS|VEE|GND|GROUND|SGND|AGND|DGND|PGND|PWR|POWER)$",
    re.I,
)


def _snap(value):
    """Snap a generated coordinate to the native 50 mil presentation grid."""

    return round(round(float(value) / _GRID) * _GRID, 4)


def _float(value, fallback=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return float(fallback)


def _bounds(spec):
    low = spec.get("_low", [0.0, 0.0])
    return (
        _float(low[0]),
        _float(low[1]),
        _float(low[0]) + _float(spec.get("width")),
        _float(low[1]) + _float(spec.get("height")),
    )


def _key(ref, pin):
    return ref + "." + str(pin.get("number"))


def _axis(direction):
    if not isinstance(direction, (list, tuple)) or len(direction) != 2:
        return None
    pair = tuple(int(round(_float(v))) for v in direction)
    if pair in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        return pair
    return None


def _net_index(design):
    netof = {}
    members = {}
    for net in design.get("nets", []) or []:
        name = str(net.get("name") or "")
        if not name:
            continue
        nodes = [str(node) for node in net.get("nodes", []) or []]
        # functional_groups' rail-evidence helpers index component records.
        members[name] = {node.rsplit('.', 1)[0] for node in nodes if '.' in node}
        for node in nodes:
            netof[node] = name
    return netof, members


def _classify(component, resources):
    """Return a conservative resistor/capacitor kind for one component."""

    value = _kind(component, resources or {})
    if _is_kind(value, "resistor"):
        return "resistor"
    if _is_kind(value, "capacitor"):
        return "capacitor"
    # A few old snapshots omit a symbol description.  The library identity is
    # still evidence for the standard two-terminal family; do not infer from
    # reference prefixes or values.
    ident = str(component.get("librarySymbol") or "")
    if len(component.get("pins", [])) == 2 and all(
        str(pin.get("type", "")).lower() == "passive"
        for pin in component.get("pins", [])
    ):
        if re.search(r"(?:^|:)R(?:_|$)", ident, re.I):
            return "resistor"
        if re.search(r"(?:^|:)C(?:_|$)", ident, re.I):
            return "capacitor"
    return None


def _terminal_records(component, netof, pinmap):
    result = []
    ref = component.get("ref")
    for pin in component.get("pins", []) or []:
        key = _key(ref, pin)
        name = netof.get(key)
        mapped = pinmap.get(key)
        direction = _axis((mapped or {}).get("direction"))
        pos = (mapped or {}).get("pos")
        if not name or direction is None or not isinstance(pos, (list, tuple)) or len(pos) != 2:
            return None
        result.append(
            {
                "key": key,
                "net": name,
                "direction": direction,
                "pos": [_float(pos[0]), _float(pos[1])],
            }
        )
    return result


def _return_is_evidenced(return_net, design, netof, members, supplied, power_nets):
    """Use the same conservative return-rail evidence as grouping.

    A net name alone is accepted only for conventional power identities.  A
    custom name needs a frozen power pin (or an explicitly supplied net), so a
    pair of arbitrary passive endpoints cannot silently become a ground bus.
    """

    if return_net in power_nets or return_net in set(supplied or ()):
        return True
    if _POWER_NAME.fullmatch(str(return_net or "")):
        return True
    # Keep the helper robust when called with a pre-normalized design whose
    # power-net index is not available: _is_shared_return_net performs the
    # same pin-role/name checks used by functional grouping.
    components = {
        component.get("ref"): component
        for component in design.get("components", []) or []
        if component.get("ref")
    }
    return _is_shared_return_net(
        return_net,
        components,
        netof,
        members,
        set(supplied or ()),
        power_nets,
    )


def _recognize_pairs(group, design, resources, specs, pinmap):
    """Return unique pair records or ``None`` for an ambiguous group."""

    refs = list(group.get("references", []) or [])
    if len(refs) < 2 or len(set(refs)) != len(refs):
        return None
    components = {
        component.get("ref"): component
        for component in design.get("components", []) or []
        if component.get("ref")
    }
    if any(ref not in components or ref not in specs for ref in refs):
        return None
    selected = [components[ref] for ref in refs]
    kinds = {ref: _classify(components[ref], resources) for ref in refs}
    if any(kind not in ("resistor", "capacitor") for kind in kinds.values()):
        return None
    if any(len(component.get("pins", [])) != 2 for component in selected):
        return None

    netof, members = _net_index(design)
    supplied = set(design.get("supplied_nets", []) or [])
    power_nets = _power_nets(components, netof, members, supplied)
    terminals = {}
    for component in selected:
        records = _terminal_records(component, netof, pinmap)
        if records is None or len(records) != 2:
            return None
        terminals[component["ref"]] = records

    resistors = [ref for ref in refs if kinds[ref] == "resistor"]
    capacitors = [ref for ref in refs if kinds[ref] == "capacitor"]
    if not resistors or len(resistors) != len(capacitors):
        return None

    # Build every topology-valid edge in the R-C bipartite graph.  A pair has
    # exactly one common net, and the capacitor's other net is its candidate
    # return.  Both pin directions are checked later so pin-number polarity is
    # never used to select an endpoint.
    candidates = {}
    candidate_returns = {}
    for resistor in resistors:
        rnets = {record["net"] for record in terminals[resistor]}
        for capacitor in capacitors:
            cnets = {record["net"] for record in terminals[capacitor]}
            shared = rnets & cnets
            if len(shared) != 1:
                continue
            shared_net = next(iter(shared))
            c_other = cnets - {shared_net}
            r_other = rnets - {shared_net}
            if len(c_other) != 1 or len(r_other) != 1:
                continue
            return_net = next(iter(c_other))
            if return_net == shared_net:
                continue
            candidates.setdefault(resistor, []).append(capacitor)
            candidate_returns[(resistor, capacitor)] = (shared_net, return_net)

    # A valid group has a unique matching.  This explicit check prevents a
    # parallel capacitor bank or a shared R from being silently laid out as
    # independent rows.
    if any(len(values) != 1 for values in candidates.values()):
        return None
    matched = {values[0] for values in candidates.values()}
    if len(matched) != len(resistors) or matched != set(capacitors):
        return None
    if len(candidates) != len(resistors):
        return None

    pairs = []
    returns = set()
    external_nets = set()
    shared_nets = set()
    for resistor in sorted(resistors):
        capacitor = candidates[resistor][0]
        shared_net, return_net = candidate_returns[(resistor, capacitor)]
        if not _return_is_evidenced(
            return_net, design, netof, members, supplied, power_nets
        ):
            return None
        rterms = terminals[resistor]
        cterms = terminals[capacitor]
        r_shared = next(record for record in rterms if record["net"] == shared_net)
        r_external = next(record for record in rterms if record["net"] != shared_net)
        c_shared = next(record for record in cterms if record["net"] == shared_net)
        c_return = next(record for record in cterms if record["net"] == return_net)
        if r_external["net"] in external_nets or shared_net in shared_nets:
            # Independent rows must not share a signal-side hypernet.  A
            # shared return is the only deliberately common net.
            return None
        external_nets.add(r_external["net"])
        shared_nets.add(shared_net)
        returns.add(return_net)
        pairs.append(
            {
                "resistor": resistor,
                "capacitor": capacitor,
                "shared_net": shared_net,
                "return_net": return_net,
                "r_shared": r_shared,
                "r_external": r_external,
                "c_shared": c_shared,
                "c_return": c_return,
            }
        )
    if len(returns) != 1:
        return None
    return pairs


def _edge(points, net):
    """Create one orthogonal edge, dropping duplicate/collinear points."""

    clean = []
    for point in points:
        point = [_float(point[0]), _float(point[1])]
        if clean and abs(clean[-1][0] - point[0]) < 1e-6 and abs(clean[-1][1] - point[1]) < 1e-6:
            continue
        if clean and abs(clean[-1][0] - point[0]) > 1e-6 and abs(clean[-1][1] - point[1]) > 1e-6:
            # This is an internal guard, not a router.  The caller only feeds
            # horizontal/vertical endpoints, but keeping the helper fail-safe
            # avoids emitting a diagonal if a future symbol has an odd pin.
            clean.append([point[0], clean[-1][1]])
        clean.append(point)
    while len(clean) >= 3:
        a, b, c = clean[-3:]
        if (abs(a[0] - b[0]) < 1e-6 and abs(b[0] - c[0]) < 1e-6) or (
            abs(a[1] - b[1]) < 1e-6 and abs(b[1] - c[1]) < 1e-6
        ):
            clean.pop(-2)
        else:
            break
    if len(clean) < 2:
        return None
    section = {
        "startPoint": {"x": round(clean[0][0], 4), "y": round(clean[0][1], 4)},
        "endPoint": {"x": round(clean[-1][0], 4), "y": round(clean[-1][1], 4)},
    }
    if len(clean) > 2:
        section["bendPoints"] = [
            {"x": round(point[0], 4), "y": round(point[1], 4)}
            for point in clean[1:-1]
        ]
    return {"net": net, "sections": [section]}


def _pair_geometry(pair, specs, gap, row_y=0.0):
    """Place one pair relative to its R shared terminal at ``(0,row_y)``."""

    resistor = pair["resistor"]
    capacitor = pair["capacitor"]
    r_shared = pair["r_shared"]
    c_shared = pair["c_shared"]
    c_return = pair["c_return"]
    r_direction = r_shared["direction"]
    c_direction = c_shared["direction"]
    if r_direction not in ((1, 0), (-1, 0)) or c_direction not in ((0, 1), (0, -1)):
        return None
    r_terms = pair["r_external"], r_shared
    r_other_direction = pair["r_external"]["direction"]
    c_other_direction = c_return["direction"]
    if r_other_direction != (-r_direction[0], 0):
        return None
    if c_other_direction != (0, -c_direction[1]):
        return None
    r_pos = r_shared["pos"]
    r_origin = [_snap(-r_pos[0]), _snap(row_y - r_pos[1])]
    r_low_x, r_low_y, r_high_x, r_high_y = _bounds(specs[resistor])
    r_box = [
        r_origin[0] + r_low_x,
        r_origin[1] + r_low_y,
        r_origin[0] + r_high_x,
        r_origin[1] + r_high_y,
    ]
    side = r_direction[0]
    clearance = max(_float(gap, 0.0), _GRID * 2)
    c_low_x, c_low_y, c_high_x, c_high_y = _bounds(specs[capacitor])
    if side > 0:
        c_origin_x = _snap(r_box[2] + clearance - c_low_x)
    else:
        c_origin_x = _snap(r_box[0] - clearance - c_high_x + c_low_x)
    lead = max(_GRID * 2, _snap(max(_float(gap, 0.0) / 2.0, _GRID * 2)))
    # Approach the signal pin from its outward side. Moving toward that
    # side instead can put the resistor row through the capacitor body when
    # a larger gap makes the lead equal the pin-to-body distance.
    c_target_y = _snap(row_y - c_direction[1] * lead)
    c_origin_y = _snap(c_target_y - c_shared["pos"][1])
    c_box = [
        c_origin_x + c_low_x,
        c_origin_y + c_low_y,
        c_origin_x + c_high_x,
        c_origin_y + c_high_y,
    ]
    r_shared_point = [r_origin[0] + r_shared["pos"][0], r_origin[1] + r_shared["pos"][1]]
    c_shared_point = [c_origin_x + c_shared["pos"][0], c_origin_y + c_shared["pos"][1]]
    c_return_point = [c_origin_x + c_return["pos"][0], c_origin_y + c_return["pos"][1]]
    stub = max(_GRID * 2, lead)
    c_return_stub = [
        _snap(c_return_point[0] + c_return["direction"][0] * stub),
        _snap(c_return_point[1] + c_return["direction"][1] * stub),
    ]
    # ``r_terms`` is intentionally retained in this local scope as an
    # assertion aid: a malformed record with an endpoint on the same axis
    # would otherwise produce a visually plausible but electrically unsafe
    # row.
    if r_terms[0]["net"] == r_terms[1]["net"] or pair["c_shared"]["net"] != pair["shared_net"]:
        return None
    return {
        "positions": {resistor: r_origin, capacitor: [c_origin_x, c_origin_y]},
        "boxes": [r_box, c_box],
        "r_shared_point": r_shared_point,
        "c_shared_point": c_shared_point,
        "c_return_point": c_return_point,
        "c_return_stub": c_return_stub,
        "row_y": row_y,
        "lead": lead,
    }


def place(group, design, resources, specs, pinmap, gap):
    """Place one all-passive input-conditioning group.

    The return value is ``None`` when the group is not a unique set of
    horizontal-R/vertical-C pairs.  Otherwise it contains measured children
    and orthogonal, net-tagged sections with pin-exact endpoints.
    """

    pairs = _recognize_pairs(group, design, resources, specs, pinmap)
    if not pairs:
        return None
    # Group order is a presentation input, not a topology contract.  Sort by
    # the generic component identity only after topology has established a
    # unique pair; no design-specific reference is consulted.
    pairs = sorted(pairs, key=lambda pair: (pair["resistor"], pair["capacitor"]))
    initial = []
    max_span = 0.0
    for pair in pairs:
        geometry = _pair_geometry(pair, specs, gap, 0.0)
        if geometry is None:
            return None
        initial.append(geometry)
        points = [point for box in geometry["boxes"] for point in ([box[:2], box[2:]])]
        points.extend(
            [geometry["c_return_point"], geometry["c_return_stub"]]
        )
        low = min(point[1] for point in points)
        high = max(point[1] for point in points)
        max_span = max(max_span, high - low)
    row_pitch = _snap(max(_GRID * 2, max_span + max(_float(gap, 0.0), _GRID * 2)))
    if row_pitch <= 0:
        row_pitch = _GRID * 2

    geometries = []
    for index, pair in enumerate(pairs):
        geometry = _pair_geometry(pair, specs, gap, index * row_pitch)
        if geometry is None:
            return None
        geometries.append(geometry)

    body_bounds = [point for geometry in geometries for box in geometry["boxes"] for point in (box[:2], box[2:])]
    stubs = [geometry["c_return_stub"] for geometry in geometries]
    all_x = [point[0] for point in body_bounds]
    all_y = [point[1] for point in body_bounds]
    margin = max(_GRID, _float(gap, 0.0) / 2.0)
    # A single outer return trunk physically joins all capacitor returns.  Its
    # x position is selected from measured bounds so it remains outside every
    # symbol, independent of which side a pair's R terminal faces.
    right_rail = _snap(max(all_x) + margin)
    left_rail = _snap(min(all_x) - margin)
    rail_candidates = [right_rail, left_rail]
    candidate_spans = [
        max(max(all_x), rail) - min(min(all_x), rail)
        for rail in rail_candidates
    ]
    rail_x = rail_candidates[0 if candidate_spans[0] <= candidate_spans[1] else 1]
    body_bounds.extend([[rail_x, point[1]] for point in stubs])

    edges = []
    for pair, geometry in zip(pairs, geometries):
        branch = _edge(
            [
                geometry["r_shared_point"],
                [geometry["c_shared_point"][0], geometry["r_shared_point"][1]],
                geometry["c_shared_point"],
            ],
            pair["shared_net"],
        )
        if branch is None:
            return None
        edges.append(branch)
        # The short outward lead prevents an open return tail.  The horizontal
        # tap then reaches the common measured rail; all three sections stay
        # orthogonal and each pin endpoint remains exact.
        return_edge = _edge(
            [
                geometry["c_return_point"],
                geometry["c_return_stub"],
                [rail_x, geometry["c_return_stub"][1]],
            ],
            pair["return_net"],
        )
        if return_edge is None:
            return None
        edges.append(return_edge)
    if len(stubs) > 1:
        ordered = sorted(stubs, key=lambda point: point[1])
        rail = _edge(
            [
                [rail_x, ordered[0][1]],
                [rail_x, ordered[-1][1]],
            ],
            pairs[0]["return_net"],
        )
        if rail is not None:
            edges.append(rail)

    edge_points = []
    for edge in edges:
        for section in edge["sections"]:
            edge_points.extend(
                [[point["x"], point["y"]] for point in [section["startPoint"], *section.get("bendPoints", []), section["endPoint"]]]
            )
    all_points = body_bounds + edge_points
    left = _snap(min(point[0] for point in all_points) - margin)
    top = _snap(min(point[1] for point in all_points) - margin)
    right = _snap(max(point[0] for point in all_points) + margin)
    bottom = _snap(max(point[1] for point in all_points) + margin)
    if right <= left or bottom <= top:
        return None

    children = []
    for pair, geometry in zip(pairs, geometries):
        for ref, origin in geometry["positions"].items():
            low = specs[ref].get("_low", [0.0, 0.0])
            children.append(
                {
                    "id": ref,
                    "x": round(origin[0] + _float(low[0]) - left, 4),
                    "y": round(origin[1] + _float(low[1]) - top, 4),
                }
            )
    normalized_edges = []
    for edge in edges:
        sections = []
        for section in edge["sections"]:
            points = [
                section["startPoint"],
                *section.get("bendPoints", []),
                section["endPoint"],
            ]
            clean = [
                {"x": round(_float(point["x"]) - left, 4), "y": round(_float(point["y"]) - top, 4)}
                for point in points
            ]
            out = {"startPoint": clean[0], "endPoint": clean[-1]}
            if len(clean) > 2:
                out["bendPoints"] = clean[1:-1]
            sections.append(out)
        normalized_edges.append({"net": edge["net"], "sections": sections})
    return {
        "id": group.get("id"),
        "width": round(right - left, 4),
        "height": round(bottom - top, 4),
        "children": children,
        "edges": normalized_edges,
    }


__all__ = ["place"]
