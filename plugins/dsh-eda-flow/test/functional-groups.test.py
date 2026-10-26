"""Functional grouping for mixed Evidence and installed-library symbols."""

import sys
import unittest
from copy import deepcopy
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "mcp"))

from functional_groups import groups, interface_feed_nets  # noqa: E402


def _component(ref, library, pins, **extra):
    value = {
        "ref": ref,
        "librarySymbol": library,
        "pins": [{"number": str(number), "type": pin_type} for number, pin_type in pins],
    }
    value.update(extra)
    return value


def _resources():
    # Device:R/Device:C deliberately have no appearance metadata, matching
    # the installed-library snapshot used by the live sparse run.
    return {
        "symbols": {
            "Evidence:U": {"drawingRules": {"origin": "fact"}, "appearance": {"kind": "logic-ic"}},
            "Evidence:D": {"drawingRules": {"origin": "fact"}, "appearance": {"kind": "infrared-receiver"}},
            "Evidence:DS": {"drawingRules": {"origin": "fact"}, "appearance": {"kind": "display"}},
            "Device:R": {
                "drawingRules": {"origin": "kicad-library"},
                "description": "Resistor",
            },
            "Device:C": {
                "drawingRules": {"origin": "kicad-library"},
                "description": "Unpolarized capacitor",
            },
            "Connector_Generic:Conn_01x02": {
                "drawingRules": {"origin": "kicad-library"},
            },
        }
    }


def _design():
    components = [
        # U1 has one powered pin on each shared rail plus a second powered
        # pin on +5V.  This keeps the fixture's supply capacitors ambiguous,
        # so only the dedicated local-supply regression below is inferred.
        _component("U1", "Evidence:U", [("1", "output"), ("2", "output"), ("3", "output"), ("4", "power_in"), ("5", "power_in")]),
        _component("D1", "Evidence:D", [("1", "output"), ("2", "power_in"), ("3", "power_in")]),
        _component("DS1", "Evidence:DS", [("1", "passive")]),
        _component("J1", "Connector_Generic:Conn_01x02", [("1", "input"), ("2", "output")]),
        _component("R1", "Device:R", [("1", "passive"), ("2", "passive")]),
        _component("R2", "Device:R", [("1", "passive"), ("2", "passive")]),
        # This is a serial 0R-style link in the output branch.  The grouping
        # code must follow it instead of putting it in a global leftovers box.
        _component("R3", "Device:R", [("1", "passive"), ("2", "passive")], value="0"),
        _component("R4", "Device:R", [("1", "passive"), ("2", "passive")]),
        _component("R5", "Device:R", [("1", "passive"), ("2", "passive")], value="0"),
        _component("C1", "Device:C", [("1", "passive"), ("2", "passive")]),
        _component("C2", "Device:C", [("1", "passive"), ("2", "passive")]),
        _component("C3", "Device:C", [("1", "passive"), ("2", "passive")]),
    ]
    nets = [
        {"name": "IR_OUT", "nodes": ["D1.1", "R1.1"]},
        {"name": "IR_CHAIN", "nodes": ["R1.2", "R2.1"]},
        {"name": "IR_INPUT", "nodes": ["R2.2", "J1.1"]},
        {"name": "SEG", "nodes": ["U1.1", "R3.1"]},
        {"name": "SEG_M", "nodes": ["R3.2", "R4.1"]},
        {"name": "LED_A", "nodes": ["R4.2", "R5.1"]},
        {"name": "LED_B", "nodes": ["R5.2", "DS1.1"]},
        {"name": "DIN", "nodes": ["U1.2", "C3.1", "J1.2"]},
        {"name": "SGND", "nodes": ["D1.2", "U1.4", "C1.2", "C2.2", "C3.2"]},
        {"name": "+5V", "nodes": ["D1.3", "U1.5", "C1.1", "C2.1"]},
        # Keep a second output so U1 satisfies the driver heuristic without
        # adding another branch that would obscure the assertions below.
        {"name": "SPARE", "nodes": ["U1.3"]},
    ]
    return {"components": components, "nets": nets, "supplied_nets": ["+5V", "SGND"]}


def _shared_interface_design():
    """Two powered modules reached from one connector through R/C-like chains."""

    return {
        "components": [
            _component(
                "U1",
                "Evidence:U",
                [("1", "output"), ("2", "power_in"), ("3", "power_in")],
            ),
            _component(
                "U2",
                "Evidence:U",
                [("1", "output"), ("2", "power_in"), ("3", "power_in")],
            ),
            _component(
                "J1",
                "Connector_Generic:Conn_01x02",
                [("1", "input"), ("2", "input"), ("3", "power_in"), ("4", "passive")],
            ),
            _component("R1", "Device:R", [("1", "passive"), ("2", "passive")]),
            _component("R2", "Device:R", [("1", "passive"), ("2", "passive")]),
        ],
        "nets": [
            {"name": "IF_A", "nodes": ["J1.1", "R1.1"]},
            {"name": "IF_A_END", "nodes": ["R1.2", "U1.1"]},
            {"name": "IF_B", "nodes": ["J1.2", "R2.1"]},
            {"name": "IF_B_END", "nodes": ["R2.2", "U2.1"]},
            {"name": "VCC", "nodes": ["J1.3", "U1.2", "U2.2"]},
            {"name": "GND", "nodes": ["J1.4", "U1.3", "U2.3"]},
        ],
        "supplied_nets": ["VCC", "GND"],
    }


class FunctionalGroups(unittest.TestCase):
    def test_interface_feed_does_not_claim_fanout_unknown_role_or_port_to_port_links(self):
        for case in ('fanout','unknown-role','port-to-port','atomic'):
            with self.subTest(case=case):
                design=_shared_interface_design()
                link=_component('ENTRY_LINK','Device:R',[('1','passive'),('2','passive')],value='0',electricalRole='routing-bridge')
                design['components'].append(link)
                ground=next(n for n in design['nets'] if n['name']=='GND')
                ground['nodes'].remove('J1.4');ground['nodes'].append('ENTRY_LINK.2')
                entry={'name':'GND_ENTRY','nodes':['J1.4','ENTRY_LINK.1']}
                design['nets'].append(entry)
                if case=='fanout':
                    ground['nodes'].remove('U1.3');entry['nodes'].append('U1.3')
                elif case=='unknown-role':
                    link.pop('electricalRole')
                elif case=='port-to-port':
                    design['components'].append(_component('J2','Connector_Generic:Conn_01x02',[('1','power_in'),('2','passive')]))
                    ground['nodes'].remove('ENTRY_LINK.2')
                    design['nets'].append({'name':'SECOND_ENTRY','nodes':['ENTRY_LINK.2','J2.1']})
                    design['nets'].append({'name':'SPARE','nodes':['J2.2']})
                else:
                    design['blockInstances']=[{'bindings':{'link':'ENTRY_LINK','load':'U1'}}]
                result=groups(design,_resources())
                self.assertNotIn('GND_ENTRY',interface_feed_nets(design,_resources(),result))

    def test_unique_interface_feed_link_stays_with_connector_without_absorbing_shared_rail(self):
        design = _shared_interface_design()
        design['components'].append(_component('ENTRY_LINK', 'Device:R', [('1','passive'),('2','passive')], value='0', electricalRole='routing-bridge'))
        for net in design['nets']:
            if net['name']=='GND':
                net['nodes'].remove('J1.4'); net['nodes'].append('ENTRY_LINK.2')
        design['nets'].append({'name':'GND_ENTRY','nodes':['J1.4','ENTRY_LINK.1']})
        design['supplied_nets']=['VCC','GND_ENTRY']
        original=deepcopy(design)
        result=groups(design,_resources())
        by_ref={r:g for g in result for r in g['references']}
        self.assertEqual(by_ref['ENTRY_LINK']['id'],by_ref['J1']['id'],
                         'A unique connector feed link must not become a standalone decoupling group')
        self.assertNotEqual(by_ref['U1']['id'],by_ref['J1']['id'])
        self.assertNotEqual(by_ref['U2']['id'],by_ref['J1']['id'])
        self.assertEqual(design,original)
        self.assertEqual(interface_feed_nets(design,_resources(),result), {'GND_ENTRY'})
        separate = deepcopy(result)
        by_connector=next(g for g in separate if 'J1' in g['references'])
        by_connector['references'].remove('ENTRY_LINK')
        separate.append({'id':'explicit-separate','references':['ENTRY_LINK']})
        self.assertFalse(interface_feed_nets(design,_resources(),separate), 'Explicit visual grouping is respected')
        design['components'].reverse();design['nets'].reverse()
        repeated=groups(design,_resources())
        self.assertEqual({frozenset(g['references']) for g in result},
                         {frozenset(g['references']) for g in repeated})

    def test_installed_library_kinds_and_long_passive_chains(self):
        result = groups(_design(), _resources())
        self.assertIsNotNone(result)
        by_title = {group["title"]: set(group["references"]) for group in result}

        self.assertEqual(by_title["接口与接收"], {"D1", "R1", "R2"})
        self.assertEqual(by_title["共享接口"], {"J1"})
        self.assertEqual(
            by_title["驱动与滤波"], {"U1", "R3", "R4", "R5", "C3"}
        )
        self.assertEqual(by_title["显示模块"], {"DS1"})
        self.assertEqual(by_title["电源与去耦"], {"C1", "C2"})
        self.assertNotIn("其他电路", by_title)

    def test_power_ground_does_not_diffuse_signal_chain(self):
        result = groups(_design(), _resources())
        flattened = {
            ref: group["title"]
            for group in result
            for ref in group["references"]
        }
        # The signal capacitor stays with its DIN branch; it is not pulled into
        # the supply group just because its other terminal is SGND.
        self.assertEqual(flattened["C3"], "驱动与滤波")
        self.assertEqual(flattened["C1"], "电源与去耦")

    def test_connector_serving_two_active_modules_is_a_shared_interface(self):
        result = groups(_shared_interface_design(), _resources())
        ownership = {
            ref: group["title"]
            for group in result
            for ref in group["references"]
        }
        self.assertEqual(ownership["J1"], "共享接口")
        self.assertNotEqual(ownership["J1"], ownership["U1"])
        self.assertNotEqual(ownership["J1"], ownership["U2"])

    def test_connector_serving_one_active_module_is_not_split(self):
        design = _shared_interface_design()
        design["components"] = [
            component
            for component in design["components"]
            if component["ref"] != "U2"
        ]
        design["nets"] = [
            net
            for net in design["nets"]
            if not any(node.startswith("U2.") for node in net["nodes"])
            and net["name"] not in {"IF_B_END"}
        ]
        result = groups(design, _resources())
        ownership = {
            ref: group["title"]
            for group in result
            for ref in group["references"]
        }
        self.assertNotIn("共享接口", {group["title"] for group in result})
        self.assertEqual(ownership["J1"], ownership["U1"])

    def test_connector_power_only_nets_do_not_count_as_shared_interface(self):
        design = _shared_interface_design()
        design["nets"] = [
            {"name": "VCC", "nodes": ["J1.1", "J1.3", "U1.2", "U2.2"]},
            {"name": "GND", "nodes": ["J1.2", "J1.4", "U1.3", "U2.3"]},
        ]
        for component in design["components"]:
            if component["ref"] == "J1":
                component["pins"] = [
                    {"number": "1", "type": "passive"},
                    {"number": "2", "type": "passive"},
                    {"number": "3", "type": "power_in"},
                    {"number": "4", "type": "passive"},
                ]
        result = groups(design, _resources())
        self.assertNotIn("共享接口", {group["title"] for group in result})

    def test_frozen_block_prevents_connector_split(self):
        design = _shared_interface_design()
        design["blockInstances"] = [
            {"bindings": {"interface": "J1", "module": "U1"}}
        ]
        result = groups(design, _resources())
        ownership = {
            ref: frozenset(group["references"])
            for group in result
            for ref in group["references"]
        }
        self.assertNotIn("共享接口", {group["title"] for group in result})
        self.assertEqual(ownership["J1"], ownership["U1"])

    def test_same_net_passive_is_left_for_cross_over_group(self):
        design = _design()
        design["components"].append(
            _component(
                "R6",
                "Device:R",
                [("1", "passive"), ("2", "passive")],
                value="0",
            )
        )
        # Both terminals are on the same driver net.  It must not be swallowed
        # by the signal BFS; the later cross-over group owns it.
        design["nets"][-1]["nodes"].extend(["R6.1", "R6.2"])
        result = groups(design, _resources())
        flattened = {
            ref: group["title"]
            for group in result
            for ref in group["references"]
        }
        self.assertEqual(flattened["R6"], "零欧跨线")
        self.assertNotIn("R6", next(g for g in result if g["title"] == "驱动与滤波")["references"])

    def test_appearance_only_symbols_and_specialized_roles_are_grouped(self):
        resources = {
            "symbols": {
                # These records intentionally have no drawingRules.  The
                # explicit appearance kind is the only frozen-symbol evidence.
                "Evidence:RX": {"appearance": {"kind": "specified-receiver"}},
                "Evidence:DS": {"appearance": {"kind": "stepped-two-digit-display"}},
                "Device:R": {},
            }
        }
        design = {
            "components": [
                _component("RX1", "Evidence:RX", [("1", "output"), ("2", "power_in"), ("3", "power_in")]),
                _component("DS1", "Evidence:DS", [("1", "passive")]),
                _component("R1", "Device:R", [("1", "passive"), ("2", "passive")]),
            ],
            "nets": [
                {"name": "RX_OUT", "nodes": ["RX1.1", "R1.1"]},
                {"name": "RX_BRANCH", "nodes": ["R1.2"]},
                {"name": "RX_VCC", "nodes": ["RX1.2"]},
                {"name": "RX_GND", "nodes": ["RX1.3"]},
                {"name": "DISPLAY_BUS", "nodes": ["DS1.1"]},
            ],
            "supplied_nets": ["RX_VCC", "RX_GND"],
        }
        result = groups(design, resources)
        self.assertIsNotNone(result)
        by_title = {group["title"]: set(group["references"]) for group in result}
        self.assertEqual(by_title["接口与接收"], {"RX1", "R1"})
        self.assertEqual(by_title["显示模块"], {"DS1"})

    def test_specified_box_needs_power_input_and_multiple_outputs(self):
        resources = {
            "symbols": {
                "Evidence:BOX": {"appearance": {"kind": "specified-box"}},
                "Evidence:CONN": {"appearance": {"kind": "specified-box"}},
                "Device:R": {},
            }
        }
        design = {
            "components": [
                _component(
                    "BOX1",
                    "Evidence:BOX",
                    [("1", "power_in"), ("2", "output"), ("3", "output"), ("4", "input")],
                ),
                # A connector-like custom box has several signal pins but no
                # power input, so it must not become the driver anchor.
                _component(
                    "J1",
                    "Evidence:CONN",
                    [("1", "input"), ("2", "output"), ("3", "output")],
                ),
                _component("R1", "Device:R", [("1", "passive"), ("2", "passive")]),
                _component("R2", "Device:R", [("1", "passive"), ("2", "passive")]),
            ],
            "nets": [
                {"name": "VCC", "nodes": ["BOX1.1"]},
                {"name": "OUT_A", "nodes": ["BOX1.2", "R1.1"]},
                {"name": "OUT_B", "nodes": ["BOX1.3", "R2.1"]},
                {"name": "R1_END", "nodes": ["R1.2"]},
                {"name": "R2_END", "nodes": ["R2.2"]},
                {"name": "J1_BUS", "nodes": ["J1.1", "J1.2", "J1.3"]},
            ],
            "supplied_nets": ["VCC"],
        }
        result = groups(design, resources)
        by_title = {group["title"]: set(group["references"]) for group in result}
        self.assertEqual(by_title["驱动与滤波"], {"BOX1", "R1", "R2"})
        self.assertNotIn("J1", by_title["驱动与滤波"])
        self.assertIn("J1", by_title["其他电路"])

    def test_connector_metadata_overrides_power_out_box_shape(self):
        resources = {
            "symbols": {
                "Evidence:BOX": {"appearance": {"kind": "specified-box"}},
                "Evidence:CONN": {
                    # The generic appearance is box-shaped, but the
                    # installed-library identity independently says connector.
                    "appearance": {"kind": "specified-box"},
                    "drawingRules": {
                        "librarySymbol": "Connector_Generic:Conn_01x04",
                        "description": "Generic connector, single row",
                    },
                },
            }
        }
        design = {
            "components": [
                _component(
                    "BOX1",
                    "Evidence:BOX",
                    [("1", "power_in"), ("2", "output"), ("3", "output")],
                ),
                _component(
                    "J1",
                    "Evidence:CONN",
                    [("1", "power_out"), ("2", "output"), ("3", "output"), ("4", "output")],
                ),
            ],
            "nets": [
                {"name": "VCC", "nodes": ["BOX1.1"]},
                {"name": "BOX_OUT_A", "nodes": ["BOX1.2"]},
                {"name": "BOX_OUT_B", "nodes": ["BOX1.3"]},
                {"name": "J1_VCC", "nodes": ["J1.1"]},
                {"name": "J1_OUT_A", "nodes": ["J1.2"]},
                {"name": "J1_OUT_B", "nodes": ["J1.3"]},
                {"name": "J1_OUT_C", "nodes": ["J1.4"]},
            ],
            "supplied_nets": ["VCC", "J1_VCC"],
        }
        result = groups(design, resources)
        by_title = {group["title"]: set(group["references"]) for group in result}
        self.assertIn("BOX1", by_title["驱动与滤波"])
        self.assertNotIn("J1", by_title["驱动与滤波"])
        self.assertIn("J1", by_title["其他电路"])

    def test_unique_local_supply_claims_rc_but_shared_rails_stay_ambiguous(self):
        resources = {
            "symbols": {
                "Evidence:RX": {"appearance": {"kind": "specified-receiver"}},
                "Evidence:IC": {"appearance": {"kind": "logic-ic"}},
                "Device:R": {},
                "Device:C": {},
            }
        }
        design = {
            "components": [
                _component("RX1", "Evidence:RX", [("1", "output"), ("2", "power_in"), ("3", "power_in")]),
                _component("IC1", "Evidence:IC", [("1", "output"), ("2", "power_in"), ("3", "power_in")]),
                _component("IC2", "Evidence:IC", [("1", "output"), ("2", "power_in"), ("3", "power_in")]),
                _component("R_LOCAL", "Device:R", [("1", "passive"), ("2", "passive")]),
                _component("C_LOCAL", "Device:C", [("1", "passive"), ("2", "passive")]),
                _component("C_SHARED", "Device:C", [("1", "passive"), ("2", "passive")]),
            ],
            "nets": [
                {"name": "RX_OUT", "nodes": ["RX1.1"]},
                {"name": "LOCAL_VCC", "nodes": ["RX1.2", "R_LOCAL.1", "C_LOCAL.1"]},
                {"name": "LOCAL_GND", "nodes": ["RX1.3", "C_LOCAL.2"]},
                {"name": "R_LOCAL_END", "nodes": ["R_LOCAL.2"]},
                {"name": "SHARED_VCC", "nodes": ["IC1.2", "IC2.2", "C_SHARED.1"]},
                {"name": "SHARED_GND", "nodes": ["IC1.3", "IC2.3", "C_SHARED.2"]},
                {"name": "IC1_OUT", "nodes": ["IC1.1"]},
                {"name": "IC2_OUT", "nodes": ["IC2.1"]},
            ],
            "supplied_nets": ["LOCAL_VCC", "LOCAL_GND", "SHARED_VCC", "SHARED_GND"],
        }
        result = groups(design, resources)
        ownership = {
            ref: group["title"]
            for group in result
            for ref in group["references"]
        }
        self.assertEqual(ownership["RX1"], "接口与接收")
        self.assertEqual(ownership["R_LOCAL"], "接口与接收")
        self.assertEqual(ownership["C_LOCAL"], "接口与接收")
        self.assertEqual(ownership["C_SHARED"], "电源与去耦")

    def test_declared_decoupling_owners_cover_receiver_and_multiple_ic_domains(self):
        components = [
            _component("RX1", "Evidence:D", [("1", "output"), ("2", "power_in"), ("3", "power_in")]),
            _component("RX2", "Evidence:D", [("1", "output"), ("2", "power_in"), ("3", "power_in")]),
            # One output is deliberately below the driver heuristic.  Its
            # declared decoupler must still form an owner group.
            _component("IC_A", "Evidence:U", [("1", "output"), ("2", "power_in"), ("3", "power_in")]),
            _component("IC_B", "Evidence:U", [("1", "output"), ("2", "power_in"), ("3", "power_in")]),
            _component("C_RX", "Device:C", [("1", "passive"), ("2", "passive")]),
            _component("C_A", "Device:C", [("1", "passive"), ("2", "passive")]),
            _component("C_B", "Device:C", [("1", "passive"), ("2", "passive")]),
            _component("J1", "Connector_Generic:Conn_01x02", [("1", "input"), ("2", "input")]),
        ]
        design = {
            "components": components,
            "nets": [
                {"name": "RX_SIGNAL", "nodes": ["RX1.1", "J1.1"]},
                # RX2's signal touches IC_A.  The IC anchor is reserved so this
                # neighbouring receiver walk cannot claim it or its capacitor.
                {"name": "SHARED_SIGNAL", "nodes": ["RX2.1", "IC_A.1"]},
                {"name": "VCC_SHARED", "nodes": ["RX1.3", "IC_A.3", "C_RX.1", "C_A.1"]},
                {"name": "GND_SHARED", "nodes": ["RX1.2", "IC_A.2", "C_RX.2", "C_A.2"]},
                {"name": "VDD_B", "nodes": ["IC_B.3", "C_B.1"]},
                {"name": "GND_B", "nodes": ["IC_B.2", "C_B.2"]},
                {"name": "RX2_VCC", "nodes": ["RX2.3"]},
                {"name": "RX2_GND", "nodes": ["RX2.2"]},
                {"name": "J1_AUX", "nodes": ["J1.2"]},
            ],
            "supplied_nets": ["VCC_SHARED", "GND_SHARED", "VDD_B", "GND_B", "RX2_VCC", "RX2_GND"],
            "functions": [
                {
                    "requirementId": "rx-bypass",
                    "layout": [
                        {"kind": "decoupling", "anchor": "RX1.3", "return": "RX1.2", "members": ["C_RX"]}
                    ],
                },
                {
                    "requirementId": "ic-a-bypass",
                    "layout": [
                        {"kind": "decoupling", "anchor": "IC_A.3", "return": "IC_A.2", "members": ["C_A"]}
                    ],
                },
                {
                    "requirementId": "ic-b-bypass",
                    "layout": [
                        {"kind": "decoupling", "anchor": "IC_B.3", "return": "IC_B.2", "members": ["C_B"]}
                    ],
                },
            ],
        }
        result = groups(design, _resources())
        ownership = {
            ref: frozenset(group["references"])
            for group in result
            for ref in group["references"]
        }
        self.assertEqual(ownership["RX1"], ownership["C_RX"])
        self.assertEqual(ownership["IC_A"], ownership["C_A"])
        self.assertEqual(ownership["IC_B"], ownership["C_B"])
        self.assertNotEqual(ownership["C_RX"], ownership["C_A"])
        self.assertNotEqual(ownership["C_A"], ownership["C_B"])
        # The neighbouring receiver must not steal the ordinary IC anchor.
        self.assertNotEqual(ownership["RX2"], ownership["IC_A"])

    def test_default_groups_keep_frozen_block_atomic(self):
        design = _design()
        design["blockInstances"] = [
            {"bindings": {"driver": "U1", "display": "DS1"}}
        ]
        result = groups(design, _resources())
        by_ref = {
            ref: group["title"]
            for group in result
            for ref in group["references"]
        }
        self.assertEqual(by_ref["U1"], by_ref["DS1"])
        self.assertEqual(
            sum("U1" in group["references"] for group in result),
            1,
        )
        self.assertEqual(
            sum("DS1" in group["references"] for group in result),
            1,
        )

    def test_block_closure_keeps_owner_decoupler_atomic(self):
        design = _design()
        # Make U1.3 the declared supply-side anchor for C1.  The receiver walk
        # claims D1 first, while the frozen block then pulls U1 into that group;
        # atomic closure must pull U1's declared decoupler along with it.
        design["nets"] = [net for net in design["nets"] if net["name"] != "SPARE"]
        next(net for net in design["nets"] if net["name"] == "+5V")["nodes"].append("U1.3")
        design["blockInstances"] = [
            {"bindings": {"receiver": "D1", "driver": "U1"}}
        ]
        design["functions"] = [
            {
                "layout": [
                    {
                        "kind": "decoupling",
                        "anchor": "U1.3",
                        "return": "U1.4",
                        "members": ["C1"],
                    }
                ]
            }
        ]

        result = groups(design, _resources())
        ownership = {
            ref: frozenset(group["references"])
            for group in result
            for ref in group["references"]
        }
        self.assertEqual(ownership["D1"], ownership["U1"])
        self.assertEqual(ownership["U1"], ownership["C1"])


if __name__ == "__main__":
    unittest.main()

