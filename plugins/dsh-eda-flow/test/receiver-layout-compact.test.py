"""Pure topology-driven regression for the compact receiver motif."""

import sys
import unittest
from copy import deepcopy
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


def fixture(extra=None, reverse_output=False):
    components = [
        component(
            "SENSOR",
            "Evidence:receiver",
            [("1", "OUT", "output"), ("2", "GND", "power_in"), ("3", "VCC", "power_in")],
        ),
        component("FILTER", "Evidence:R", [("1", "", "passive"), ("2", "", "passive")]),
        component("LINK", "Evidence:R", [("1", "", "passive"), ("2", "", "passive")]),
        component("PULL", "Evidence:R", [("1", "", "passive"), ("2", "", "passive")]),
        component("BYPASS", "Evidence:C", [("1", "", "passive"), ("2", "", "passive")]),
    ]
    if extra:
        components.append(extra)
    design = {
        "components": components,
        "nets": [
            {"name": "+V", "nodes": ["FILTER.1", "PULL.1"]},
            {"name": "SGND", "nodes": ["SENSOR.2", "BYPASS.2"]},
            {"name": "SENSOR_VCC", "nodes": ["SENSOR.3", "FILTER.2", "BYPASS.1"]},
            {"name": "SENSOR_OUT", "nodes": ["SENSOR.1", "LINK.1", "PULL.2"]},
            {"name": "RCV", "nodes": ["LINK.2"]},
        ],
    }
    pinmap = {
        "SENSOR.1": {"pos": [10.16, 0.0], "direction": [1, 0]},
        "SENSOR.2": {"pos": [10.16, -5.08], "direction": [1, 0]},
        "SENSOR.3": {"pos": [10.16, 5.08], "direction": [1, 0]},
        "FILTER.1": {"pos": [0.0, 0.0], "direction": [-1, 0]},
        "FILTER.2": {"pos": [7.62, 0.0], "direction": [1, 0]},
        "LINK.1": {"pos": [0.0, 0.0], "direction": [-1, 0]},
        "LINK.2": {"pos": [7.62, 0.0], "direction": [1, 0]},
        "PULL.1": {"pos": [0.0, 3.81], "direction": [0, -1]},
        "PULL.2": {"pos": [0.0, -3.81], "direction": [0, 1]},
        "BYPASS.1": {"pos": [-3.81, 0.0], "direction": [-1, 0]},
        "BYPASS.2": {"pos": [3.81, 0.0], "direction": [1, 0]},
    }
    for pin in pinmap.values():
        pin["port"] = [
            pin["pos"][0] + pin["direction"][0] * 2.54,
            pin["pos"][1] + pin["direction"][1] * 2.54,
        ]
    if reverse_output:
        pinmap["LINK.1"]["direction"] = [1, 0]
        pinmap["LINK.2"]["direction"] = [-1, 0]
    refs = [component["ref"] for component in components]
    return design, pinmap, refs


def resources():
    return {
        "symbols": {
            "Evidence:receiver": {"appearance": {"kind": "specified-receiver"}},
            "Evidence:R": {"appearance": {"kind": "specified-resistor"}},
            "Evidence:C": {"appearance": {"kind": "specified-capacitor"}},
            "Evidence:connector": {"appearance": {"kind": "connector"}},
        }
    }


def specs(refs):
    return {
        ref: {"_low": [-5.0, -4.0], "width": 10.0, "height": 8.0}
        for ref in refs
    }


class CompactReceiverLayout(unittest.TestCase):
    def test_owned_bypass_bank_uses_real_geometry_and_preserves_every_supply_branch(self):
        for count in (2, 3, 5):
            with self.subTest(count=count):
                design, pinmap, refs = fixture()
                members = ['BYPASS']
                for index in range(1, count):
                    ref = f'STORE_{index}'
                    part = deepcopy(design['components'][-1]); part['ref'] = ref
                    design['components'].append(part); refs.append(ref); members.append(ref)
                    for number in ('1', '2'):
                        pinmap[f'{ref}.{number}'] = deepcopy(pinmap[f'BYPASS.{number}'])
                    design['nets'][1]['nodes'].append(f'{ref}.2')
                    design['nets'][2]['nodes'].append(f'{ref}.1')
                design['functions'] = [{'layout': [{'kind': 'decoupling', 'anchor': 'SENSOR.3', 'return': 'SENSOR.2', 'members': members}]}]
                original = deepcopy(design)
                geometry = specs(refs)
                for index, ref in enumerate(members):
                    geometry[ref].update({'_content_low': [-4, -2-index], '_content_high': [4, 3+index]})
                result = place({'id': 'owned-bank', 'references': list(reversed(refs))}, design, resources(), geometry, pinmap, 5.08)
                self.assertIsNotNone(result, 'Multiple owned bypass capacitors must not force a generic-layout fallback')
                self.assertEqual(design, original, 'Layout must not synthesize or change any electrical connections')
                self.assertEqual({c['id'] for c in result['children']}, set(refs))
                self.assertTrue(result.get('localReturns'))
                children = {c['id']: c for c in result['children']}
                intervals = []
                segments = []
                for e in result['edges']:
                    if e['net'] != 'SENSOR_VCC':
                        continue
                    for s in e['sections']:
                        points = [s['startPoint'], *s.get('bendPoints', []), s['endPoint']]
                        segments.extend(zip(points, points[1:]))
                for ref in members:
                    c, spec = children[ref], geometry[ref]
                    x = c['x']-spec['_low'][0]+pinmap[f'{ref}.1']['pos'][0]
                    y = c['y']-spec['_low'][1]+pinmap[f'{ref}.1']['pos'][1]
                    self.assertTrue(any(min(a['x'], b['x'])-1e-6 <= x <= max(a['x'], b['x'])+1e-6
                                        and min(a['y'], b['y'])-1e-6 <= y <= max(a['y'], b['y'])+1e-6
                                        and abs((x-a['x'])*(b['y']-a['y'])-(y-a['y'])*(b['x']-a['x'])) < 1e-6
                                        for a,b in segments), ref+' supply is not attached to the actual routed bank')
                    intervals.append((c['y']-spec['_low'][1]+spec['_content_low'][1], c['y']-spec['_low'][1]+spec['_content_high'][1]))
                intervals.sort()
                for a,b in zip(intervals, intervals[1:]):
                    self.assertGreaterEqual(b[0]-a[1], 5.08-1e-6, 'Visible bank fields need their measured clearance')
                reordered = deepcopy(design)
                reordered['components'].reverse(); reordered['nets'].reverse()
                for net in reordered['nets']:
                    net['nodes'].reverse()
                reordered['functions'][0]['layout'][0]['members'].reverse()
                again = place({'id': 'owned-bank', 'references': refs}, reordered, resources(), geometry, pinmap, 5.08)
                self.assertEqual({c['id']:(c['x'],c['y']) for c in again['children']},
                                 {c['id']:(c['x'],c['y']) for c in result['children']},
                                 'The local bank must not depend on serialization order')
                reordered['functions'][0]['layout'][0]['members'].pop()
                self.assertIsNone(place({'id': 'ambiguous-bank', 'references': refs}, reordered, resources(), geometry, pinmap, 5.08),
                                  'Sharing a supply net alone does not authorize local ownership')

    def test_owned_bypass_spacing_uses_visible_extent_not_empty_node_reserve(self):
        design, pinmap, refs = fixture()
        design['functions'] = [{'layout': [{'kind': 'decoupling', 'anchor': 'SENSOR.3', 'return': 'SENSOR.2', 'members': ['BYPASS']}]}]
        def relative_y(reserve, bottom):
            geometry = specs(refs)
            geometry['BYPASS'].update({'_low': [-10, -reserve], 'height': 2*reserve,
                                       '_content_low': [-4, -2], '_content_high': [4, bottom]})
            result = place({'id': 'visible-bounds', 'references': refs}, design, resources(), geometry, pinmap, 5.08)
            children = {c['id']: c for c in result['children']}
            return (children['BYPASS']['y']-geometry['BYPASS']['_low'][1]
                    -children['SENSOR']['y']+geometry['SENSOR']['_low'][1])
        self.assertAlmostEqual(relative_y(10, 3), relative_y(50, 3), places=6)
        self.assertLess(relative_y(10, 8), relative_y(10, 3), 'A larger visible field still requires more clearance')

    def test_filtered_rail_pullup_is_not_misclassified_as_a_second_supply_feed(self):
        design, pinmap, refs = fixture()
        design['nets'][0]['nodes'].remove('PULL.1')
        design['nets'][2]['nodes'].append('PULL.1')
        design['functions'] = [{'layout': [{'kind': 'decoupling', 'anchor': 'SENSOR.3', 'return': 'SENSOR.2', 'members': ['BYPASS']}]}]
        result = place({'id': 'filtered-bias', 'references': refs}, design, resources(), specs(refs), pinmap, 5.08)
        self.assertIsNotNone(result, 'A local-rail bias is a shunt, not another feed resistor')
        self.assertEqual({c['id'] for c in result['children']}, set(refs))
        self.assertTrue(result.get('localReturns'))
        signal_sections = [s for e in result['edges'] if e['net'] == 'SENSOR_OUT' for s in e['sections']]
        longest = max(signal_sections, key=lambda s: abs(s['endPoint']['x']-s['startPoint']['x']))
        self.assertAlmostEqual(longest['startPoint']['y'], longest['endPoint']['y'])

    def test_owned_bypass_uses_nearby_supply_branch_and_local_return(self):
        design, pinmap, refs = fixture()
        design['functions'] = [{'layout': [{'kind': 'decoupling', 'anchor': 'SENSOR.3', 'return': 'SENSOR.2', 'members': ['BYPASS']}]}]
        result = place({'id': 'owned', 'references': refs}, design, resources(), specs(refs), pinmap, 5.08)
        self.assertTrue(result.get('localReturns'))
        children = {c['id']: c for c in result['children']}
        self.assertLess(abs(children['BYPASS']['x'] - children['SENSOR']['x']), 30)
        self.assertFalse(any(e['net'] == 'SGND' for e in result['edges']))
        self.assertTrue(any(e['net'] == 'SENSOR_VCC' for e in result['edges']))

    def test_series_output_and_pullup_share_receiver_out_row(self):
        design, pinmap, refs = fixture()
        result = place(
            {"id": "compact", "references": refs},
            design,
            resources(),
            specs(refs),
            pinmap,
            5.08,
        )
        self.assertIsNotNone(result)
        self.assertEqual({child["id"] for child in result["children"]}, set(refs))
        output_edges = [edge for edge in result["edges"] if edge["net"] == "SENSOR_OUT"]
        self.assertEqual(len(output_edges), 2)
        section = max(
            (edge["sections"][0] for edge in output_edges),
            key=lambda item: abs(item["endPoint"]["x"] - item["startPoint"]["x"]),
        )
        points = [section["startPoint"], *section.get("bendPoints", []), section["endPoint"]]
        self.assertTrue(all(abs(point["y"] - points[0]["y"]) < 0.001 for point in points))
        self.assertLess(result["width"], 100.0)

        # The supply rail is deliberately lifted above the vertical pull body
        # instead of crossing the receiver VCC row through that body.
        vcc_edges = [edge for edge in result["edges"] if edge["net"] == "SENSOR_VCC"]
        self.assertTrue(vcc_edges)
        vcc_points = [
            point
            for point in [
                vcc_edges[0]["sections"][0]["startPoint"],
                *vcc_edges[0]["sections"][0].get("bendPoints", []),
                vcc_edges[0]["sections"][0]["endPoint"],
            ]
        ]
        self.assertLess(min(point["y"] for point in vcc_points), vcc_points[0]["y"])
        riser_x = next(
            point["x"]
            for point, following in zip(vcc_points, vcc_points[1:])
            if abs(point["x"] - following["x"]) < 0.001
            and abs(point["y"] - following["y"]) > 1.0
        )
        riser_grid = (riser_x - vcc_points[0]["x"]) / 1.27
        self.assertAlmostEqual(riser_grid, round(riser_grid), places=6)

        # Native schematic wires must remain orthogonal even when a legacy
        # caller supplies a diagonal intermediate point.
        for edge in result["edges"]:
            for section in edge["sections"]:
                points = [section["startPoint"], *section.get("bendPoints", []), section["endPoint"]]
                self.assertTrue(
                    all(
                        abs(a["x"] - b["x"]) < 0.001 or abs(a["y"] - b["y"]) < 0.001
                        for a, b in zip(points, points[1:])
                    ),
                    msg=f"non-orthogonal edge: {edge}",
                )

    def test_ambiguous_orientation_falls_back(self):
        design, pinmap, refs = fixture(reverse_output=True)
        self.assertIsNone(
            place(
                {"id": "fallback", "references": refs},
                design,
                resources(),
                specs(refs),
                pinmap,
                5.08,
            )
        )

    def test_filter_content_box_moves_vcc_riser_before_the_field(self):
        design, pinmap, refs = fixture()
        baseline_specs = specs(refs)
        baseline = place(
            {"id": "baseline", "references": refs},
            design,
            resources(),
            baseline_specs,
            pinmap,
            5.08,
        )
        self.assertIsNotNone(baseline)
        wide_specs = specs(refs)
        wide_specs["FILTER"].update(
            {"_content_low": [-8.0, -1.0], "_content_high": [4.0, 1.0]}
        )
        wide = place(
            {"id": "wide-field", "references": refs},
            design,
            resources(),
            wide_specs,
            pinmap,
            5.08,
        )
        self.assertIsNotNone(wide)

        def riser_x(result):
            edge = next(edge for edge in result["edges"] if edge["net"] == "SENSOR_VCC")
            section = edge["sections"][0]
            points = [section["startPoint"], *section.get("bendPoints", []), section["endPoint"]]
            return next(
                point["x"]
                for point, following in zip(points, points[1:])
                if abs(point["x"] - following["x"]) < 0.001
                and abs(point["y"] - following["y"]) > 1.0
            )

        self.assertLess(riser_x(wide), riser_x(baseline))

    def test_extra_component_is_not_silently_claimed(self):
        extra = component("EXTRA", "Evidence:R", [("1", "", "passive"), ("2", "", "passive")])
        design, pinmap, refs = fixture(extra=extra)
        design["nets"].append({"name": "UNUSED", "nodes": ["EXTRA.1", "EXTRA.2"]})
        pinmap["EXTRA.1"] = {"pos": [0.0, 0.0], "direction": [-1, 0]}
        pinmap["EXTRA.2"] = {"pos": [7.62, 0.0], "direction": [1, 0]}
        self.assertIsNone(
            place(
                {"id": "fallback-extra", "references": refs},
                design,
                resources(),
                specs(refs),
                pinmap,
                5.08,
            )
        )


if __name__ == "__main__":
    unittest.main()
