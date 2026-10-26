"""Pure grouping regressions for driver input resistor/capacitor filters."""

import copy
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "mcp"))

from functional_groups import groups  # noqa: E402
from generic_layout import required_visual_groups  # noqa: E402


def _component(ref, library, pins, **extra):
    value = {
        "ref": ref,
        "librarySymbol": library,
        "pins": [
            {"number": str(number), "type": pin_type}
            for number, pin_type in pins
        ],
    }
    value.update(extra)
    return value


def _resources():
    return {
        "symbols": {
            "Evidence:Driver": {
                "drawingRules": {"origin": "fixture"},
                "appearance": {"kind": "logic-ic"},
            },
            "Evidence:Display": {
                "drawingRules": {"origin": "fixture"},
                "appearance": {"kind": "display"},
            },
            "Connector_Generic:Conn_01x04": {
                "drawingRules": {"origin": "fixture"},
            },
            "Device:R": {
                "drawingRules": {"origin": "kicad-library"},
                "description": "Resistor",
            },
            "Device:C": {
                "drawingRules": {"origin": "kicad-library"},
                "description": "Unpolarized capacitor",
            },
        }
    }


def _driver_input_design():
    return {
        "components": [
            _component(
                "U_MAIN",
                "Evidence:Driver",
                [
                    ("1", "input"),
                    ("2", "input"),
                    ("3", "output"),
                    ("4", "output"),
                    ("5", "output"),
                    ("6", "power_in"),
                ],
            ),
            _component("R_IN_A", "Device:R", [("1", "passive"), ("2", "passive")]),
            _component("C_IN_A", "Device:C", [("1", "passive"), ("2", "passive")]),
            # C_IN_B intentionally reverses the signal/return pin numbers.
            # Both the resistor and capacitor terminals are reversed in this
            # branch; grouping must follow net adjacency instead of pin order.
            _component("R_IN_B", "Device:R", [("1", "passive"), ("2", "passive")]),
            _component("C_IN_B", "Device:C", [("1", "passive"), ("2", "passive")]),
            _component("R_LIMIT", "Device:R", [("1", "passive"), ("2", "passive")]),
            _component("R_GRID", "Device:R", [("1", "passive"), ("2", "passive")], value="0"),
            _component("DS1", "Evidence:Display", [("1", "passive")]),
            _component(
                "J_INPUT",
                "Connector_Generic:Conn_01x04",
                [("1", "output"), ("2", "output"), ("3", "passive"), ("4", "passive")],
            ),
        ],
        "nets": [
            {"name": "INPUT_A", "nodes": ["U_MAIN.1", "R_IN_A.1", "J_INPUT.3"]},
            {"name": "A_FILTERED", "nodes": ["R_IN_A.2", "C_IN_A.1"]},
            {"name": "INPUT_B", "nodes": ["U_MAIN.2", "R_IN_B.2", "J_INPUT.4"]},
            {"name": "B_FILTERED", "nodes": ["R_IN_B.1", "C_IN_B.2"]},
            {"name": "GND", "nodes": ["U_MAIN.6", "C_IN_A.2", "C_IN_B.1"]},
            {"name": "OUT_A", "nodes": ["U_MAIN.3", "R_LIMIT.1"]},
            {"name": "OUT_A_M", "nodes": ["R_LIMIT.2", "R_GRID.1"]},
            {"name": "OUT_A_END", "nodes": ["R_GRID.2", "DS1.1"]},
            {"name": "OUT_B", "nodes": ["U_MAIN.4"]},
            {"name": "OUT_C", "nodes": ["U_MAIN.5"]},
            {"name": "J_OUT_A", "nodes": ["J_INPUT.1"]},
            {"name": "J_OUT_B", "nodes": ["J_INPUT.2"]},
        ],
        "supplied_nets": ["GND"],
    }


class InputConditioningGroups(unittest.TestCase):
    def test_multiple_input_rc_pairs_are_one_local_group_and_outputs_remain_driver_owned(self):
        design = _driver_input_design()
        before = copy.deepcopy(design)
        result = groups(design, _resources())

        self.assertEqual(design, before)
        ownership = {
            ref: group
            for group in result
            for ref in group["references"]
        }
        conditioning = [
            group for group in result if group["title"] == "输入调理"
        ]
        self.assertEqual(len(conditioning), 1)
        self.assertEqual(
            set(conditioning[0]["references"]),
            {"R_IN_A", "C_IN_A", "R_IN_B", "C_IN_B"},
        )
        self.assertEqual(ownership["R_LIMIT"]["title"], "驱动与滤波")
        self.assertEqual(ownership["R_GRID"]["title"], "驱动与滤波")
        self.assertEqual(ownership["DS1"]["title"], "显示模块")
        self.assertEqual(
            sum(ref in group["references"] for group in result for ref in ownership),
            len(design["components"]),
        )
        self.assertEqual(
            sorted(ownership),
            sorted(component["ref"] for component in design["components"]),
        )

    def test_direct_input_capacitor_keeps_legacy_driver_group(self):
        design = _driver_input_design()
        design["components"] = [
            component
            for component in design["components"]
            if component["ref"] not in {"R_IN_A", "C_IN_A"}
        ]
        for net in design["nets"]:
            net["nodes"] = [
                node for node in net["nodes"]
                if node.rsplit(".", 1)[0] not in {"R_IN_A", "C_IN_A"}
                and node != "U_MAIN.1"
            ]
        design["components"].append(
            _component("C_DIRECT", "Device:C", [("1", "passive"), ("2", "passive")])
        )
        design["nets"].extend([
            {"name": "DIRECT_INPUT", "nodes": ["U_MAIN.1", "C_DIRECT.1"]},
            {"name": "GND_DIRECT", "nodes": ["C_DIRECT.2"]},
        ])
        result = groups(design, _resources())
        by_ref = {
            ref: group["title"]
            for group in result
            for ref in group["references"]
        }
        conditioning = [
            set(group["references"])
            for group in result
            if group["title"] == "输入调理"
        ]
        self.assertTrue(conditioning)
        self.assertFalse(any("C_DIRECT" in refs for refs in conditioning))
        self.assertEqual(by_ref["C_DIRECT"], "驱动与滤波")

    def test_ambiguous_parallel_capacitors_fail_closed(self):
        design = _driver_input_design()
        design["components"].append(
            _component("C_IN_A_2", "Device:C", [("1", "passive"), ("2", "passive")])
        )
        for net in design["nets"]:
            if net["name"] == "A_FILTERED":
                net["nodes"].append("C_IN_A_2.1")
            elif net["name"] == "GND":
                net["nodes"].append("C_IN_A_2.2")
        result = groups(design, _resources())
        conditioning = [
            set(group["references"])
            for group in result
            if group["title"] == "输入调理"
        ]
        self.assertTrue(conditioning)
        self.assertFalse(any({"R_IN_A", "C_IN_A"}.issubset(refs) for refs in conditioning))
        ownership = {
            ref: group["title"]
            for group in result
            for ref in group["references"]
        }
        self.assertEqual(ownership["R_IN_A"], "驱动与滤波")
        self.assertEqual(ownership["C_IN_A"], "驱动与滤波")
        self.assertEqual(ownership["C_IN_A_2"], "驱动与滤波")

    def test_frozen_block_keeps_input_pair_atomic(self):
        design = _driver_input_design()
        design["blockInstances"] = [
            {"bindings": {"driver": "U_MAIN", "resistor": "R_IN_A", "capacitor": "C_IN_A"}}
        ]
        result = groups(design, _resources())
        ownership = {
            ref: frozenset(group["references"])
            for group in result
            for ref in group["references"]
        }
        self.assertEqual(ownership["U_MAIN"], ownership["R_IN_A"])
        self.assertEqual(ownership["R_IN_A"], ownership["C_IN_A"])
        self.assertEqual(
            sum("U_MAIN" in group["references"] for group in result),
            1,
        )

    def test_connector_output_bank_is_not_required_as_active_driver(self):
        design = {
            "components": [
                _component(
                    "J1",
                    "Connector_Generic:Conn_01x04",
                    [("1", "output"), ("2", "output"), ("3", "output"), ("4", "passive")],
                ),
                *[
                    _component(ref, "Device:R", [("1", "passive"), ("2", "passive")])
                    for ref in ("R1", "R2", "R3")
                ],
            ],
            "nets": [
                {"name": "N1", "nodes": ["J1.1", "R1.1"]},
                {"name": "N2", "nodes": ["J1.2", "R2.1"]},
                {"name": "N3", "nodes": ["J1.3", "R3.1"]},
            ],
        }
        self.assertEqual(required_visual_groups(design, _resources()), [])

    def test_active_source_output_bank_remains_fully_contained(self):
        # The target input is also one branch of an active source.  Stealing
        # R_SHARED for a target-side input RC group would split the source's
        # required output bank and make normalize_layout reject the result.
        design = {
            "components": [
                _component(
                    "U_SRC",
                    "Evidence:Driver",
                    [("1", "output"), ("2", "output"), ("3", "output"), ("4", "power_in")],
                ),
                _component(
                    "U_TGT",
                    "Evidence:Driver",
                    [("1", "input"), ("2", "output"), ("3", "output"), ("4", "output"), ("5", "power_in")],
                ),
                _component("R_SHARED", "Device:R", [("1", "passive"), ("2", "passive")]),
                _component("R_SRC_2", "Device:R", [("1", "passive"), ("2", "passive")]),
                _component("R_SRC_3", "Device:R", [("1", "passive"), ("2", "passive")]),
                _component("C_TARGET", "Device:C", [("1", "passive"), ("2", "passive")]),
            ],
            "nets": [
                {"name": "SHARED_INPUT", "nodes": ["U_SRC.1", "U_TGT.1", "R_SHARED.1"]},
                {"name": "FILTERED_INPUT", "nodes": ["R_SHARED.2", "C_TARGET.1"]},
                {"name": "GND", "nodes": ["U_TGT.5", "C_TARGET.2"]},
                {"name": "SRC_OUT_2", "nodes": ["U_SRC.2", "R_SRC_2.1"]},
                {"name": "SRC_OUT_3", "nodes": ["U_SRC.3", "R_SRC_3.1"]},
                {"name": "VCC", "nodes": ["U_SRC.4"]},
                {"name": "TARGET_OUT_2", "nodes": ["U_TGT.2"]},
                {"name": "TARGET_OUT_3", "nodes": ["U_TGT.3"]},
                {"name": "TARGET_OUT_4", "nodes": ["U_TGT.4"]},
            ],
            "supplied_nets": ["VCC", "GND"],
        }
        expected_required = {"U_SRC", "R_SHARED", "R_SRC_2", "R_SRC_3"}
        for target_first in (False, True):
            trial = copy.deepcopy(design)
            if target_first:
                by_ref = {
                    component["ref"]: component
                    for component in trial["components"]
                }
                trial["components"] = [
                    by_ref[ref]
                    for ref in (
                        "U_TGT",
                        "R_SHARED",
                        "R_SRC_2",
                        "R_SRC_3",
                        "C_TARGET",
                        "U_SRC",
                    )
                ]
            required = required_visual_groups(trial, _resources())
            self.assertEqual(required, [expected_required])
            result = groups(trial, _resources())
            self.assertNotIn("输入调理", {group["title"] for group in result})
            self.assertTrue(
                any(
                    set(required_group).issubset(set(group["references"]))
                    for required_group in required
                    for group in result
                )
            )
            ownership = {
                ref: frozenset(group["references"])
                for group in result
                for ref in group["references"]
            }
            self.assertEqual(ownership["U_SRC"], ownership["R_SHARED"])


if __name__ == "__main__":
    unittest.main()
