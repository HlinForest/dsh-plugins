import copy
import json
import math
from pathlib import Path
import sys
import tempfile
import pymupdf
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "mcp"))
from fixed_components import audit_layout
from series_pair import place

design = {"components": [{"ref": r, "pins": [{"number": "1"}, {"number": "2"}]} for r in ["X7", "Y9"]],
          "nets": [{"name": "LINK", "nodes": ["X7.2", "Y9.1"]}]}
specs = {r: {"_low": [-5, -7], "width": 15, "height": 18} for r in ["X7", "Y9"]}
for direction in [[0, 1], [1, 0], [0, -1], [-1, 0]]:
    pins = {"X7.2": {"pos": [0, 3.81], "direction": direction},
            "Y9.1": {"pos": [1.27, -3.81], "direction": [-v for v in direction]}}
    result = place({"id": "series", "references": ["X7", "Y9"]}, design, specs, pins, 7.62)
    section = result["edges"][0]["sections"][0]
    a, b = section["startPoint"], section["endPoint"]
    assert a["x"] == b["x"] if direction[1] else a["y"] == b["y"]
    branch = copy.deepcopy(design)
    branch["nets"][0]["nodes"].append("Z3.1")
    assert place({"id": "series", "references": ["X7", "Y9"]}, branch, specs, pins, 7.62) is None

symbol = json.loads((Path(__file__).parent / "fixtures/led-symbol.json").read_text(encoding="utf8"))
with tempfile.TemporaryDirectory() as directory:
    root = Path(directory)
    doc = pymupdf.open()
    doc.new_page()
    doc.save(root / "blank.pdf")
    for rotation in [0, 90, 180, 270]:
        def world(x, y):
            a = math.radians(rotation)
            return [50 + x * math.cos(a) - y * math.sin(a), 50 - x * math.sin(a) - y * math.cos(a)]
        state = {"symbols": {"LED": symbol}, "items": {
            "D1": {"id": "D1", "kind": "component", "symbol": "LED", "reference": "D1", "at": [50, 50, rotation], "properties": []},
            "lead": {"id": "lead", "kind": "wire", "points": [world(-10, 0), world(-3.81, 0)]},
        }}
        result = audit_layout(root, state, root / "blank.pdf")
        assert not result["wireBodyCrossings"], (rotation, result["wireBodyCrossings"])
        for points in [[(-10, 0), (10, 0)], [(-10, 0), (0, 0)], [(-4, -4), (-4, 4)]]:
            bad = copy.deepcopy(state)
            bad["items"]["lead"]["points"] = [world(*p) for p in points]
            assert audit_layout(root, bad, root / "blank.pdf")["wireBodyCrossings"], (rotation, points)
