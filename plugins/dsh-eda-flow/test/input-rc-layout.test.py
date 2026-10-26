"""Pure regressions for compact, topology-driven input R-C rows."""

import copy
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "mcp"))

from input_rc_layout import place  # noqa: E402


def _component(ref, library, pins, **extra):
    result = {
        "ref": ref,
        "librarySymbol": library,
        "pins": [
            {"number": str(number), "type": pin_type}
            for number, pin_type in pins
        ],
    }
    result.update(extra)
    return result


def _fixture():
    design = {
        "components": [
            _component("R_A", "Device:R", [("1", "passive"), ("2", "passive")]),
            _component("C_A", "Device:C", [("1", "passive"), ("2", "passive")]),
            _component("R_B", "Device:R", [("1", "passive"), ("2", "passive")]),
            _component("C_B", "Device:C", [("1", "passive"), ("2", "passive")]),
            _component("U", "Evidence:driver", [("1", "power_in")]),
        ],
        "nets": [
            {"name": "IN_A", "nodes": ["R_A.1"]},
            {"name": "FILTER_A", "nodes": ["R_A.2", "C_A.1"]},
            {"name": "IN_B", "nodes": ["R_B.2"]},
            {"name": "FILTER_B", "nodes": ["R_B.1", "C_B.2"]},
            {"name": "GND", "nodes": ["C_A.2", "C_B.1", "U.1"]},
        ],
        "supplied_nets": ["GND"],
    }
    resources = {
        "symbols": {
            "Device:R": {"description": "Resistor"},
            "Device:C": {"description": "Capacitor"},
            "Evidence:driver": {"appearance": {"kind": "logic-ic"}},
        }
    }
    specs = {
        "R_A": {"_low": [-5.0, -2.0], "width": 10.0, "height": 4.0},
        "R_B": {"_low": [-5.0, -2.0], "width": 10.0, "height": 4.0},
        "C_A": {"_low": [-2.0, -5.0], "width": 4.0, "height": 10.0},
        "C_B": {"_low": [-2.0, -5.0], "width": 4.0, "height": 10.0},
    }
    pinmap = {
        "R_A.1": {"pos": [-5.0, 0.0], "direction": [-1, 0]},
        "R_A.2": {"pos": [5.0, 0.0], "direction": [1, 0]},
        "C_A.1": {"pos": [0.0, -5.0], "direction": [0, -1]},
        "C_A.2": {"pos": [0.0, 5.0], "direction": [0, 1]},
        # The second pair reverses both resistor and capacitor terminal
        # polarity.  Recognition must follow net adjacency rather than pin 1.
        "R_B.1": {"pos": [-5.0, 0.0], "direction": [-1, 0]},
        "R_B.2": {"pos": [5.0, 0.0], "direction": [1, 0]},
        "C_B.1": {"pos": [0.0, -5.0], "direction": [0, -1]},
        "C_B.2": {"pos": [0.0, 5.0], "direction": [0, 1]},
        "U.1": {"pos": [0.0, 0.0], "direction": [0, 1]},
    }
    for value in pinmap.values():
        value["port"] = [
            value["pos"][0] + value["direction"][0] * 2.54,
            value["pos"][1] + value["direction"][1] * 2.54,
        ]
    return design, resources, specs, pinmap


class InputRcLayout(unittest.TestCase):
    def test_places_unique_pairs_with_pin_exact_orthogonal_edges(self):
        design, resources, specs, pinmap = _fixture()
        before = copy.deepcopy(design)
        result = place(
            {"id": "input", "references": ["C_B", "R_A", "C_A", "R_B"]},
            design,
            resources,
            specs,
            pinmap,
            5.08,
        )
        self.assertIsNotNone(result)
        self.assertEqual(
            {child["id"] for child in result["children"]},
            {"R_A", "C_A", "R_B", "C_B"},
        )
        self.assertEqual(design, before)
        self.assertGreaterEqual(len(result["edges"]), 5)
        for edge in result["edges"]:
            self.assertIn(edge["net"], {"FILTER_A", "FILTER_B", "GND"})
            for section in edge["sections"]:
                points = [
                    section["startPoint"],
                    *section.get("bendPoints", []),
                    section["endPoint"],
                ]
                self.assertTrue(
                    all(
                        abs(a["x"] - b["x"]) < 1e-4
                        or abs(a["y"] - b["y"]) < 1e-4
                        for a, b in zip(points, points[1:])
                    )
                )

        # The first endpoint of each signal edge is the actual R pin after the
        # returned child offset is applied, and the final endpoint is the
        # actual C pin.  This catches geometry that merely looks compact but
        # starts a wire at a guessed body edge.
        children = {child["id"]: child for child in result["children"]}

        def actual_pin(ref, number):
            child = children[ref]
            low = specs[ref]["_low"]
            local = pinmap[ref + "." + number]["pos"]
            return (
                round(child["x"] - low[0] + local[0], 4),
                round(child["y"] - low[1] + local[1], 4),
            )

        expected = {
            "FILTER_A": ("R_A", "2", "C_A", "1"),
            "FILTER_B": ("R_B", "1", "C_B", "2"),
        }
        for edge in result["edges"]:
            if edge["net"] not in expected:
                continue
            section = edge["sections"][0]
            points = [
                section["startPoint"],
                *section.get("bendPoints", []),
                section["endPoint"],
            ]
            r_ref, r_pin, c_ref, c_pin = expected[edge["net"]]
            self.assertEqual(
                (round(points[0]["x"], 4), round(points[0]["y"], 4)),
                actual_pin(r_ref, r_pin),
            )
            self.assertEqual(
                (round(points[-1]["x"], 4), round(points[-1]["y"], 4)),
                actual_pin(c_ref, c_pin),
            )

    def test_signal_wire_approaches_capacitor_from_outside_for_different_gaps(self):
        for gap in (2.54, 5.08, 7.62, 10.16):
            design, resources, specs, pinmap = _fixture()
            result = place(
                {'id': 'approach', 'references': ['R_A', 'C_A', 'R_B', 'C_B']},
                design, resources, specs, pinmap, gap,
            )
            self.assertIsNotNone(result)
            cap_pins = {'FILTER_A': 'C_A.1', 'FILTER_B': 'C_B.2'}
            for edge in result['edges']:
                if edge['net'] not in cap_pins:
                    continue
                section = edge['sections'][0]
                points = [section['startPoint'], *section.get('bendPoints', []), section['endPoint']]
                direction = pinmap[cap_pins[edge['net']]]['direction']
                last = [points[-1]['x']-points[-2]['x'], points[-1]['y']-points[-2]['y']]
                self.assertLess(sum(a*b for a,b in zip(last,direction)), 0)

    def test_parallel_capacitor_ambiguity_falls_back(self):
        design, resources, specs, pinmap = _fixture()
        design["components"].append(
            _component("C_A2", "Device:C", [("1", "passive"), ("2", "passive")])
        )
        design["nets"][1]["nodes"].append("C_A2.1")
        design["nets"][4]["nodes"].append("C_A2.2")
        specs["C_A2"] = copy.deepcopy(specs["C_A"])
        pinmap["C_A2.1"] = {"pos": [0.0, -5.0], "direction": [0, -1]}
        pinmap["C_A2.2"] = {"pos": [0.0, 5.0], "direction": [0, 1]}
        self.assertIsNone(
            place(
                {"id": "ambiguous", "references": ["R_A", "C_A", "C_A2", "R_B", "C_B"]},
                design,
                resources,
                specs,
                pinmap,
                5.08,
            )
        )

    def test_non_orthogonal_native_orientation_falls_back(self):
        design, resources, specs, pinmap = _fixture()
        pinmap["C_A.1"]["direction"] = [1, 1]
        self.assertIsNone(
            place(
                {"id": "rotated", "references": ["R_A", "C_A", "R_B", "C_B"]},
                design,
                resources,
                specs,
                pinmap,
                5.08,
            )
        )

    def test_custom_return_with_power_pin_evidence_is_compact(self):
        design, resources, specs, pinmap = _fixture()
        design['supplied_nets'] = []
        design['nets'][4]['name'] = 'RETURN_CUSTOM'
        self.assertIsNotNone(place(
            {'id': 'proved-return', 'references': ['R_A', 'C_A', 'R_B', 'C_B']},
            design, resources, specs, pinmap, 5.08,
        ))

    def test_custom_return_without_power_evidence_falls_back(self):
        design, resources, specs, pinmap = _fixture()
        design["supplied_nets"] = []
        design["nets"][4]["name"] = "RETURN"
        design["components"] = [component for component in design["components"] if component["ref"] != "U"]
        self.assertIsNone(
            place(
                {"id": "unproved-return", "references": ["R_A", "C_A", "R_B", "C_B"]},
                design,
                resources,
                specs,
                pinmap,
                5.08,
            )
        )


if __name__ == "__main__":
    unittest.main()
