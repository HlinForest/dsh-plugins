"""Pure geometry regressions for the generic receiver motif."""

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "mcp"))

from receiver_layout import place  # noqa: E402


def component(ref, library, pins):
    return {
        "ref": ref,
        "librarySymbol": library,
        "value": ref,
        "pins": [
            {"number": str(number), "name": name, "type": pin_type}
            for number, name, pin_type in pins
        ],
    }


def specs(refs):
    return {
        ref: {"_low": [-5.0, -4.0], "width": 10.0, "height": 8.0}
        for ref in refs
    }


def old_receiver_fixture():
    components = [
        component(
            "RX",
            "Evidence:receiver",
            [("1", "OUT", "output"), ("2", "GND", "power_in"), ("3", "VCC", "power_in")],
        ),
        component(
            "IFACE",
            "Evidence:box",
            [("1", "RCV", "input"), ("2", "GND", "power_out"), ("3", "+V", "power_out")],
        ),
        component("SUPPLY_LINK", "Evidence:R", [("1", "", "passive"), ("2", "", "passive")]),
        component("PULLUP", "Evidence:R", [("1", "", "passive"), ("2", "", "passive")]),
        component("BYPASS_A", "Evidence:C", [("1", "", "passive"), ("2", "", "passive")]),
        component("BYPASS_B", "Evidence:C", [("1", "", "passive"), ("2", "", "passive")]),
    ]
    design = {
        "components": components,
        "nets": [
            {"name": "+V", "nodes": ["IFACE.3", "SUPPLY_LINK.2", "PULLUP.2"]},
            {"name": "SGND", "nodes": ["IFACE.2", "RX.2", "BYPASS_A.1", "BYPASS_B.1"]},
            {"name": "RX_VCC", "nodes": ["SUPPLY_LINK.1", "RX.3", "BYPASS_A.2", "BYPASS_B.2"]},
            {"name": "RCV", "nodes": ["RX.1", "PULLUP.1", "IFACE.1"]},
        ],
    }
    pinmap = {
        "RX.1": {"pos": [17.78, -6.35], "direction": [1, 0]},
        "RX.2": {"pos": [17.78, -1.27], "direction": [1, 0]},
        "RX.3": {"pos": [17.78, -11.43], "direction": [1, 0]},
        "IFACE.1": {"pos": [-2.54, -1.27], "direction": [-1, 0]},
        "IFACE.2": {"pos": [-2.54, -5.08], "direction": [-1, 0]},
        "IFACE.3": {"pos": [-2.54, -8.89], "direction": [-1, 0]},
        "SUPPLY_LINK.1": {"pos": [0.0, 0.0], "direction": [-1, 0]},
        "SUPPLY_LINK.2": {"pos": [10.16, 0.0], "direction": [1, 0]},
        "PULLUP.1": {"pos": [0.0, 0.0], "direction": [0, 1]},
        "PULLUP.2": {"pos": [0.0, -10.16], "direction": [0, -1]},
        "BYPASS_A.1": {"pos": [0.0, 0.0], "direction": [0, 1]},
        "BYPASS_A.2": {"pos": [0.0, -7.62], "direction": [0, -1]},
        "BYPASS_B.1": {"pos": [0.0, 0.0], "direction": [0, 1]},
        "BYPASS_B.2": {"pos": [0.0, -7.62], "direction": [0, -1]},
    }
    for pin in pinmap.values():
        pin["port"] = [
            pin["pos"][0] + pin["direction"][0] * 3.81,
            pin["pos"][1] + pin["direction"][1] * 3.81,
        ]
    return design, pinmap


class ReceiverLayout(unittest.TestCase):
    def test_legacy_single_output_pullup_motif_survives_renaming(self):
        design, pinmap = old_receiver_fixture()
        resources = {
            "symbols": {
                "Evidence:receiver": {"appearance": {"kind": "specified-receiver"}},
                "Evidence:box": {"appearance": {"kind": "specified-box"}},
                "Evidence:R": {"appearance": {"kind": "specified-resistor"}},
                "Evidence:C": {"appearance": {"kind": "specified-capacitor"}},
            }
        }
        references = [component["ref"] for component in design["components"]]
        result = place(
            {"id": "legacy-renamed", "references": references},
            design,
            resources,
            specs(references),
            pinmap,
            5.08,
        )
        self.assertIsNotNone(result)
        self.assertEqual(
            {child["id"] for child in result["children"]},
            set(references),
        )


if __name__ == "__main__":
    unittest.main()
