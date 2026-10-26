"""Regression tests for topology-stable generic presentation geometry."""

import itertools
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "mcp"))

from functional_groups import decoupling_hints  # noqa: E402
from generic_layout import (  # noqa: E402
    _compact_passive_fields,
    _pin_number_boxes,
    _merge_orientation_defaults,
    _presentation_tree_edges,
    _safe_terminal_lead,
    _fit_routed_graph,
    _wire_boundary_violations,
    _grid_route_channels,
    _cross_net_contacts,
    _cross_net_overlaps,
    normalize_layout,
    required_visual_groups,
)
from symbol_orientation import defaults as orientation_defaults  # noqa: E402
from topology_layout import (  # noqa: E402
    _branch_chains,
    _classify_shunts,
    _complete_local_pairs,
    _net_index,
    _decoupling_positions,
    _decoupling_signal_pairs,
    _auto_shunt_orientation_allowed,
    _input_shunt_array,
    _rowwise_input_shunt_array,
    _serial_next_target,
    place_driver,
)


def _component(ref, pins):
    return {
        "ref": ref,
        "librarySymbol": "Evidence:" + ref,
        "pins": [
            {"number": str(number), "type": pin_type}
            for number, pin_type in pins
        ],
    }


class GenericRouting(unittest.TestCase):
    def test_interface_power_link_faces_the_actual_connector_pin(self):
        design={'components':[
            dict(_component('PORT',[('8','power_out'),('9','passive'),('10','passive')]),componentKind='connector'),
            dict(_component('LINK',[('1','passive'),('2','passive')]),librarySymbol='Device:R',electricalRole='routing-bridge')],
            'nets':[{'name':'ENTRY','nodes':['PORT.8','LINK.1']},{'name':'RETURN','nodes':['LINK.2']}]}
        for angle in (0,90,180,270):
            resources={'symbols':{
                'Evidence:PORT':{'native':f'(symbol "port" (symbol "p_1_1" (pin power_out line (at 0 0 {angle}) (length 2.54) (name "P") (number "8"))))'},
                'Device:R':{'native':'(symbol "resistor" (symbol "r_1_1" (pin passive line (at 0 3.81 270) (length 2.54) (name "1") (number "1")) (pin passive line (at 0 -3.81 90) (length 2.54) (name "2") (number "2"))))','description':'Resistor'}}}
            self.assertEqual(orientation_defaults(design,resources)['LINK'],(angle+180-270)%360)

    def test_interface_entry_pair_uses_a_straight_local_wire(self):
        from series_pair import place
        design={'components':[
            dict(_component('PORT',[('8','power_out'),('9','passive'),('10','passive')]),componentKind='connector'),
            dict(_component('LINK',[('1','passive'),('2','passive')]),librarySymbol='Device:R',electricalRole='routing-bridge')],
            'nets':[{'name':'ENTRY','nodes':['PORT.8','LINK.1']},{'name':'RETURN','nodes':['LINK.2']}]}
        resources={'symbols':{'Device:R':{'description':'Resistor'},'Evidence:PORT':{}}}
        specs={r:{'_low':[-10,-5],'width':20,'height':12} for r in ('PORT','LINK')}
        for direction in ([1,0],[-1,0],[0,1],[0,-1]):
            pins={'PORT.8':{'pos':[0,0],'direction':direction},'LINK.1':{'pos':[0,0],'direction':[-v for v in direction]}}
            result=place({'id':'entry','references':['PORT','LINK']},design,specs,pins,5.08,resources)
            self.assertIsNotNone(result)
            self.assertFalse(result['edges'][0]['sections'][0].get('bendPoints'))

    def test_series_input_faces_local_ic_instead_of_remote_connector(self):
        design={'components':[
            _component('CORE',[('17','input'),('42','power_in'),('99','output')]),
            _component('PORT',[('8','output'),('9','passive'),('10','passive')]),
            dict(_component('LINK',[('1','passive'),('2','passive')]),librarySymbol='Device:R')],
            'nets':[{'name':'EXTERNAL','nodes':['PORT.8','LINK.1']},
                    {'name':'LOCAL','nodes':['LINK.2','CORE.17']}]}
        def native(name,pins):
            return '(symbol "'+name+'" (symbol "unit_1_1" '+''.join(
                '(pin '+typ+' line (at 0 0 '+str(angle)+') (length 2.54) (name "") (number "'+num+'"))'
                for num,typ,angle in pins)+'))'
        resources={'symbols':{
            'Evidence:CORE':{'native':native('core',[('17','input',0)])},
            'Evidence:PORT':{'native':native('port',[('8','output',0)]),'appearance':{'kind':'connector'}},
            'Device:R':{'native':native('resistor',[('1','passive',270),('2','passive',90)]),'description':'Resistor'}}}
        self.assertEqual(orientation_defaults(design,resources)['LINK'],90)
        design['nets'][0]['nodes'][-1]='LINK.2'
        design['nets'][1]['nodes'][0]='LINK.1'
        self.assertEqual(orientation_defaults(design,resources)['LINK'],270)

    def test_input_series_and_parallel_shunt_are_distinct_local_branches(self):
        design={'components':[_component('CORE',[('17','input'),('42','power_in')]),
            *[dict(_component(ref,[('1','passive'),('2','passive')]),librarySymbol=lib)
              for ref,lib in [('SERIES','Device:R'),('FILTER','Device:C'),('BIAS','Device:R')]]],
            'nets':[{'name':'PORT','nodes':['SERIES.1']},
                    {'name':'INPUT','nodes':['CORE.17','SERIES.2','FILTER.1','BIAS.1']},
                    {'name':'GND','nodes':['CORE.42','FILTER.2','BIAS.2']}],
            'supplied_nets':['GND']}
        for components in (design['components'],list(reversed(design['components']))):
            candidate={**design,'components':components}
            netof,nodes=_net_index(candidate)
            refs=[c['ref'] for c in components]
            branches,used=_branch_chains(refs,'CORE',candidate,{},netof,nodes)
            self.assertEqual(used,{'SERIES'})
            self.assertEqual(branches,[{'source':'CORE.17','chain':[('SERIES','SERIES.2','SERIES.1')]}])
            shunts,decouplers,leftovers=_classify_shunts(refs,'CORE',used,candidate,{},netof)
            self.assertEqual({s[0] for s in shunts},{'FILTER','BIAS'})
            self.assertFalse(decouplers or leftovers)

    def test_driver_branches_on_different_axes_are_independent_banks(self):
        design={'components':[_component('CORE',[('1','output'),('2','output'),('3','output'),('4','power_in')]),
                  *[dict(_component(ref,[('1','passive'),('2','passive')]),librarySymbol='Device:R') for ref in ('LEFT','UP','DOWN')]],
                'nets':[{'name':ref,'nodes':['CORE.'+str(i+1),ref+'.1']} for i,ref in enumerate(('LEFT','UP','DOWN'))]
                       +[{'name':'GND','nodes':['CORE.4','LEFT.2','UP.2','DOWN.2']}], 'supplied_nets':['GND']}
        specs={'CORE':{'_low':[-12.7,-12.7],'width':25.4,'height':25.4}}
        pinmap={'CORE.4':{'pos':[10.16,0],'direction':[1,0],'port':[12.7,0]}}
        for i,(ref,direction) in enumerate([('LEFT',[-1,0]),('UP',[0,-1]),('DOWN',[0,1])]):
            specs[ref]={'_low':[-7.62,-7.62],'width':15.24,'height':15.24}
            pinmap['CORE.'+str(i+1)]={'pos':[d*10.16 for d in direction],'direction':direction,'port':[d*12.7 for d in direction]}
            for number,sign in [('1',-1),('2',1)]:
                pinmap[ref+'.'+number]={'pos':[d*sign*3.81 for d in direction],
                                       'direction':[d*sign for d in direction], 'port':[d*sign*7.62 for d in direction]}
        self.assertIsNotNone(place_driver({'id':'three-sides','references':list(specs)},design,{},specs,pinmap,5.08))

    def test_local_motif_completes_unhandled_pins_without_changing_net_domains(self):
        design={'nets':[{'name':'VCC_LOCAL','nodes':['CORE.1','FEED.1','CORE.2','CORE.3']},
                        {'name':'SIGNAL','nodes':['CORE.4','LOAD.1']},
                        {'name':'GND','nodes':['CORE.5','LOAD.2']} ]}
        positions={'CORE':[0,0],'FEED':[0,-20],'LOAD':[30,0]}
        pinmap={key:{'pos':[0,y],'direction':[1,0],'port':[5,y]}
                for key,y in [('CORE.1',0),('CORE.2',5),('CORE.3',10),('CORE.4',15),('CORE.5',20),('FEED.1',0),('LOAD.1',0),('LOAD.2',5)]}
        prior=[('CORE.1','FEED.1'),('CORE.4','LOAD.1')]
        result=_complete_local_pairs(prior,list(positions),design,positions,pinmap)
        self.assertEqual(result[:2],prior)
        self.assertEqual(len(result),4)
        self.assertFalse(any('CORE.5' in pair or 'LOAD.2' in pair for pair in result))
        netof={pin:net['name'] for net in design['nets'] for pin in net['nodes']}
        self.assertTrue(all(netof[a]==netof[b] for a,b in result))
        shuffled={'nets':[dict(net,nodes=list(reversed(net['nodes']))) for net in reversed(design['nets'])]}
        self.assertEqual(result,_complete_local_pairs(prior,list(reversed(positions)),shuffled,positions,pinmap))

    def test_decoupling_candidate_keeps_outer_port_outside_its_feed_obstacle(self):
        specs={'CORE':{'_low':[-13.97,-16.51],'width':35.56,'height':40.64},
               'FEED':{'_low':[-15.24,-3.81],'width':22.86,'height':7.62},
               'LOCAL':{'_low':[-11.43,-7.62],'width':21.59,'height':15.24}}
        pinmap={
            'CORE.1':{'pos':[0,-12.7],'direction':[0,-1],'port':[0,-16.51]},
            'CORE.2':{'pos':[0,12.7],'direction':[0,1],'port':[0,24.13]},
            'LOCAL.1':{'pos':[0,3.81],'direction':[0,1],'port':[0,7.62]},
            'LOCAL.2':{'pos':[0,-3.81],'direction':[0,-1],'port':[0,-7.62]},
            'FEED.1':{'pos':[-3.81,0],'direction':[-1,0],'port':[-15.24,0]},
            'FEED.2':{'pos':[3.81,0],'direction':[1,0],'port':[7.62,0]},
        }
        result=_decoupling_positions([('LOCAL','CORE.1','CORE.2','LOCAL.1','LOCAL.2')],
             [-13.97,-16.51,21.59,24.13],{'CORE':[0,0],'FEED':[-3.81,-29.21]},
             specs,pinmap,5.08,local_returns={'CORE.2'})
        self.assertTrue(result)
        x,y=result['LOCAL'][0],result['LOCAL'][1]+7.62+1.27
        self.assertFalse(-19.05<x<3.81 and -33.02<y<-25.4,(x,y))

    def test_driver_bank_clears_measured_terminal_envelopes(self):
        design = {'components':[
            _component('CORE',[('1','output'),('2','output'),('3','output'),('4','power_in')]),
            *[dict(_component(ref,[('1','passive'),('2','passive')]),librarySymbol='Device:R') for ref in ('A','B','C')]],
            'nets':[{'name':'OUT_'+ref,'nodes':['CORE.'+str(i+1),ref+'.1']} for i,ref in enumerate(('A','B','C'))]
                   +[{'name':'GND','nodes':['CORE.4','A.2','B.2','C.2']}],
            'supplied_nets':['GND']}
        specs={'CORE':{'_low':[-13.97,-16.51],'width':35.56,'height':40.64}}
        pinmap={'CORE.4':{'pos':[0,12.7],'direction':[0,1],'port':[0,24.13]}}
        for i,ref in enumerate(('A','B','C')):
            y=-7.62+2.54*i
            specs[ref]={'_low':[-20.32,-3.81],'width':27.94,'height':7.62}
            pinmap['CORE.'+str(i+1)]={'pos':[10.16,y],'direction':[1,0],'port':[21.59,y]}
            pinmap[ref+'.1']={'pos':[-3.81,0],'direction':[-1,0],'port':[-20.32,0]}
            pinmap[ref+'.2']={'pos':[3.81,0],'direction':[1,0],'port':[7.62,0]}
        result=place_driver({'id':'driver','references':['CORE','A','B','C']},design,{},specs,pinmap,5.08)
        self.assertIsNotNone(result)
        rows={c['id']:c for c in result['children']}
        for ref in ('A','B','C'):
            self.assertGreaterEqual(rows[ref]['x'],rows['CORE']['x']+specs['CORE']['width']+5.08-.001)

    def test_output_load_chains_stop_at_shared_return_instead_of_walking_other_loads(self):
        design = {'components': [
            _component('CORE', [('1','output'),('2','output'),('3','output'),('4','power_in')]),
            *[dict(_component(ref,[('1','passive'),('2','passive')]),librarySymbol='Device:R')
              for ref in ('A','B','C')]],
            'nets':[{'name':'OUT_'+ref,'nodes':['CORE.'+str(index+1),ref+'.1']}
                    for index,ref in enumerate(('A','B','C'))]
                    +[{'name':'GND','nodes':['CORE.4','A.2','B.2','C.2']}],
            'supplied_nets':['GND']}
        netof,nodes=_net_index(design)
        result=_branch_chains([c['ref'] for c in design['components']], 'CORE', design, {}, netof, nodes)
        self.assertIsNotNone(result)
        branches,used=result
        self.assertEqual(used,{'A','B','C'})
        self.assertTrue(all(len(b['chain'])==1 for b in branches))

    def test_route_bends_use_connection_grid_without_moving_terminals(self):
        graph={'grid':1.27,'width':30,'height':30,'children':[],
               'edges':[{'net':'signal','sources':['a.1'],'targets':['b.1'],
                         'sections':[{'startPoint':{'x':0,'y':0},
                                      'bendPoints':[{'x':6.096,'y':0},{'x':6.096,'y':12.7}],
                                      'endPoint':{'x':12.7,'y':12.7}}]}]}
        result=_grid_route_channels(graph)
        section=result['edges'][0]['sections'][0]
        self.assertEqual(section['startPoint'],{'x':0,'y':0})
        self.assertEqual(section['endPoint'],{'x':12.7,'y':12.7})
        self.assertEqual(section['bendPoints'],[{'x':6.35,'y':0},{'x':6.35,'y':12.7}])
        self.assertEqual(graph['edges'][0]['sections'][0]['bendPoints'][0]['x'],6.096)

    def test_grid_cleanup_preserves_incompatible_fixed_terminal_positions(self):
        graph={'grid':1.27,'width':30,'height':30,'children':[],
               'edges':[{'net':'signal','sources':['a.1'],'targets':['b.1'],
                         'sections':[{'startPoint':{'x':0.254,'y':0},
                                      'endPoint':{'x':12.7,'y':0}}]}]}
        self.assertEqual(_grid_route_channels(graph)['edges'][0]['sections'][0]['startPoint']['x'],0.254)

    def test_grid_cleanup_never_joins_two_close_independent_channels(self):
        graph={'grid':1.27,'width':30,'height':30,'children':[], 'edges':[]}
        for net, end_y, lane in [('first',0,5.334),('second',12.7,5.588)]:
            graph['edges'].append({'net':net,'sources':[net+'.1'],'targets':[net+'.2'],
                                  'sections':[{'startPoint':{'x':0,'y':end_y},
                                               'bendPoints':[{'x':0,'y':lane},{'x':25.4,'y':lane}],
                                               'endPoint':{'x':25.4,'y':end_y}}]})
        result=_grid_route_channels(graph)
        self.assertFalse(_cross_net_contacts(result['edges']))
        self.assertFalse(_cross_net_overlaps(result['edges']))
        for before,after in zip(graph['edges'],result['edges']):
            for key in ('startPoint','endPoint'):
                self.assertEqual(before['sections'][0][key],after['sections'][0][key])

    def test_independent_wire_audit_catches_routes_outside_drawing_area(self):
        state={'items':{'bad':{'id':'bad','kind':'wire','points':[[8.89,25.4],[25.4,25.4]]},
                        'good':{'id':'good','kind':'wire','points':[[10.16,25.4],[25.4,25.4]]}}}
        self.assertEqual(_wire_boundary_violations(state,(297,210)),['bad'])

    def test_routed_group_bounds_include_detours_outside_symbol_boxes(self):
        graph={'width':20,'height':20,'grid':1.27,
               'children':[{'id':'part','x':2.54,'y':5.08,'width':10,'height':10}],
               'edges':[{'id':'signal','sources':['part.1'],'targets':['part.2'],
                         'sections':[{'startPoint':{'x':2.54,'y':5.08},
                                      'bendPoints':[{'x':-3.81,'y':5.08},{'x':-3.81,'y':24.13}],
                                      'endPoint':{'x':2.54,'y':24.13}}]}]}
        result=_fit_routed_graph(graph)
        section=result['edges'][0]['sections'][0]
        points=[section['startPoint'],*section['bendPoints'],section['endPoint']]
        self.assertGreaterEqual(min(p['x'] for p in points),0)
        self.assertGreaterEqual(min(p['y'] for p in points),0)
        self.assertGreaterEqual(result['height'],max(p['y'] for p in points))
        self.assertAlmostEqual(section['startPoint']['x'],result['children'][0]['x'])
        self.assertAlmostEqual(section['startPoint']['x']-section['bendPoints'][0]['x'],6.35)

    def test_unrouted_terminal_lead_stays_inside_its_reserved_port_envelope(self):
        endpoint = _safe_terminal_lead([20, 10], [0, 1], 'bypass', [], 7.62,
                                       reserved_end=[20, 13.81])
        self.assertLessEqual(endpoint[1], 13.81)
        self.assertGreaterEqual(endpoint[1], 12.54)

    def test_supply_feed_is_kept_separate_from_its_parallel_owned_decoupler(self):
        design = {
            'components': [
                _component('IC', [('1', 'power_in'), ('2', 'power_in'), ('3', 'output')]),
                dict(_component('FEED', [('1', 'passive'), ('2', 'passive')]), librarySymbol='Device:R'),
                dict(_component('BYPASS', [('1', 'passive'), ('2', 'passive')]), librarySymbol='Device:C'),
                dict(_component('SERIES', [('1', 'passive'), ('2', 'passive')]), librarySymbol='Device:R'),
            ],
            'nets': [
                {'name': 'LOCAL', 'nodes': ['IC.1', 'FEED.2', 'BYPASS.1']},
                {'name': 'RETURN', 'nodes': ['IC.2', 'BYPASS.2']},
                {'name': 'SOURCE', 'nodes': ['FEED.1']},
                {'name': 'OUT', 'nodes': ['IC.3', 'SERIES.1']},
                {'name': 'LOAD', 'nodes': ['SERIES.2']},
            ],
            'functions': [{'layout': [{'kind': 'decoupling', 'anchor': 'IC.1', 'return': 'IC.2', 'members': ['BYPASS']}]}],
        }
        netof, nodes = _net_index(design)
        branches, used = _branch_chains([c['ref'] for c in design['components']], 'IC', design, {}, netof, nodes)
        self.assertEqual(used, {'FEED', 'SERIES'})
        self.assertEqual(next(b['chain'] for b in branches if b['source'] == 'IC.1'), [('FEED', 'FEED.2', 'FEED.1')])

    def test_hypernet_presentation_is_invariant_to_serialized_node_order(self):
        design = {
            "components": [
                _component("U1", [("1", "output"), ("2", "power_in"), ("3", "power_in")]),
                _component("R1", [("1", "passive"), ("2", "passive")]),
                _component("R2", [("1", "passive"), ("2", "passive")]),
                _component("J1", [("1", "input"), ("2", "passive")]),
            ],
        }
        members = ["R2.1", "J1.1", "U1.1", "R1.1"]
        design["nets"] = [{"name": "BUS", "nodes": members}]
        netof = {node: "BUS" for node in members}

        expected = _presentation_tree_edges(members, design, netof)
        for permutation in itertools.permutations(members):
            actual = _presentation_tree_edges(list(permutation), design, netof)
            self.assertEqual(actual, expected)
        self.assertTrue(all(edge["sources"] == ["U1.1"] for edge in expected))
        self.assertEqual(len({edge["id"] for edge in expected}), len(expected))

    def test_decoupling_metadata_preserves_declared_endpoints(self):
        design = {
            "components": [
                _component("U1", [("1", "power_in"), ("2", "power_in")]),
                _component("C1", [("1", "passive"), ("2", "passive")]),
            ],
            "nets": [
                {"name": "+5V", "nodes": ["U1.1", "C1.1"]},
                {"name": "GND", "nodes": ["U1.2", "C1.2"]},
            ],
            "functions": [
                {
                    "layout": [
                        {
                            "kind": "decoupling",
                            "anchor": "U1.1",
                            "return": "U1.2",
                            "members": ["C1"],
                        }
                    ]
                }
            ],
        }
        self.assertEqual(
            decoupling_hints(design),
            {"U1": {"C1": {"anchor": "U1.1", "return": "U1.2"}}},
        )

    def test_decoupling_rejects_cross_component_or_active_members(self):
        base = {
            "components": [
                _component("U1", [("1", "power_in"), ("2", "power_in")]),
                _component("U2", [("1", "power_in"), ("2", "power_in")]),
                _component("C1", [("1", "passive"), ("2", "passive")]),
            ],
            "nets": [
                {"name": "+5V", "nodes": ["U1.1", "C1.1"]},
                {"name": "GND", "nodes": ["U1.2", "C1.2"]},
            ],
        }
        cross = dict(base, functions=[{"layout": [{
            "kind": "decoupling",
            "anchor": "U1.1",
            "return": "U2.2",
            "members": ["C1"],
        }]}])
        with self.assertRaises(ValueError):
            decoupling_hints(cross)

        active = dict(base)
        active["components"] = list(base["components"])
        active["components"][-1] = _component("C1", [("1", "power_in"), ("2", "passive")])
        active["functions"] = [{"layout": [{
            "kind": "decoupling",
            "anchor": "U1.1",
            "return": "U1.2",
            "members": ["C1"],
        }]}]
        with self.assertRaises(ValueError):
            decoupling_hints(active)

    def test_topology_routes_start_and_end_at_actual_pin_coordinates(self):
        def component(ref, pins, library_symbol="Device:R"):
            return {
                "ref": ref,
                "librarySymbol": library_symbol,
                "pins": [
                    {"number": str(number), "type": pin_type}
                    for number, pin_type in pins
                ],
            }

        design = {
            "components": [
                component(
                    "U1",
                    [("1", "output"), ("2", "output"), ("3", "output")],
                    "Evidence:driver",
                ),
                *(component(ref, [("1", "passive"), ("2", "passive")]) for ref in ("R1", "R2", "R3")),
                *(component(ref, [("1", "input")], "Evidence:receiver") for ref in ("J1", "J2", "J3")),
            ],
            "nets": [
                {"name": "N" + str(index), "nodes": [
                    "U1." + str(index), "R" + str(index) + ".1", "J" + str(index) + ".1"
                ]}
                for index in (1, 2, 3)
            ],
        }
        specs = {
            "U1": {"_low": [-5, -5], "width": 10, "height": 10},
            **{
                ref: {"_low": [-1, -1], "width": 2, "height": 2}
                for ref in ("R1", "R2", "R3")
            },
        }
        pinmap = {
            "U1.1": {"pos": [5, -2], "port": [8, -2], "direction": [1, 0]},
            "U1.2": {"pos": [5, 0], "port": [8, 0], "direction": [1, 0]},
            "U1.3": {"pos": [5, 2], "port": [8, 2], "direction": [1, 0]},
        }
        for index, ref in enumerate(("R1", "R2", "R3"), start=1):
            pinmap[ref + ".1"] = {"pos": [0, 0], "port": [-2, 0], "direction": [-1, 0]}
            pinmap[ref + ".2"] = {"pos": [0, 2], "port": [2, 2], "direction": [1, 0]}

        result = place_driver(
            {"id": "driver", "references": ["U1", "R1", "R2", "R3"]},
            design,
            {"symbols": {"Device:R": {"description": "Resistor"}}},
            specs,
            pinmap,
            5.08,
        )
        self.assertIsNotNone(result)
        children = {child["id"]: child for child in result["children"]}
        net_to_branch = {"N1": "R1", "N2": "R2", "N3": "R3"}

        def actual_pin(ref, number):
            child = children[ref]
            low = specs[ref]["_low"]
            local = pinmap[ref + "." + number]["pos"]
            return tuple(
                round(child[axis_name] - low[axis_index] + local[axis_index], 4)
                for axis_index, axis_name in ((0, "x"), (1, "y"))
            )

        # Branches may terminate at an existing trunk. Verify the actual pin
        # endpoints are still physically connected, including reserved leads.
        from functional_layout import on
        for net,ref in net_to_branch.items():
            segments=[]
            for edge in result["edges"]:
                if edge['net']!=net:continue
                section=edge['sections'][0]
                points=[section['startPoint'],*section.get('bendPoints',[]),section['endPoint']]
                points=[tuple(round(p[a],4) for a in ('x','y')) for p in points]
                segments.extend(zip(points,points[1:]))
            start,end=actual_pin('U1',net[1:]),actual_pin(ref,'1')
            self.assertTrue(any(start in pair for pair in segments))
            self.assertTrue(any(end in pair for pair in segments))
            self.assertTrue(all(a[0]==b[0] or a[1]==b[1] for a,b in segments))
            connected={start}
            vertices={p for pair in segments for p in pair}
            while True:
                added={p for a,b in segments if any(on(q,a,b) for q in connected) for p in vertices if on(p,a,b)}
                if added<=connected:break
                connected|=added
            self.assertIn(end,connected)

    def test_input_shunt_array_uses_one_clear_band_and_source_order(self):
        # Three vertical shunts on adjacent input rows would overlap their
        # measured fields.  The array keeps the bank in one clear band and
        # maps the top/bottom source order to a planar horizontal projection.
        specs = {
            ref: {
                "_low": [-7.62, -7.62],
                "width": 19.05,
                "height": 21.59,
                "_content_low": [-6.872, -3.81],
                "_content_high": [10.322, 3.81],
            }
            for ref in ("P1", "P2", "P3")
        }
        pinmap = {
            "U1.1": {"pos": [-10.16, -17.78], "direction": [-1, 0]},
            "U1.2": {"pos": [-10.16, -12.7], "direction": [-1, 0]},
            "U1.3": {"pos": [-10.16, -7.62], "direction": [-1, 0]},
        }
        for ref in ("P1", "P2", "P3"):
            # The input terminal faces down for an above-source bank.  The
            # helper must preserve that semantic orientation even when the
            # output branch rows occupy the nearer side.
            pinmap[ref + ".1"] = {"pos": [0, 3.81], "direction": [0, 1]}
            pinmap[ref + ".2"] = {"pos": [0, -3.81], "direction": [0, -1]}
        shunts = [
            ("P1", "P1.1", "P1.2"),
            ("P2", "P2.1", "P2.2"),
            ("P3", "P3.1", "P3.2"),
        ]
        result = _input_shunt_array(
            shunts,
            {"P1": "U1.1", "P2": "U1.2", "P3": "U1.3"},
            ["U1.1", "U1.2", "U1.3"],
            -1,
            [-13.97, -22.86, 27.94, 29.21],
            specs,
            pinmap,
            5.08,
            branch_rows=[-2.54, 2.54],
        )
        self.assertEqual(result["bandSide"], "above")
        self.assertEqual(len(set(result["target_y"].values())), 1)
        self.assertGreater(result["target_x"]["P1"], result["target_x"]["P2"])
        self.assertGreater(result["target_x"]["P2"], result["target_x"]["P3"])

        source_low = -17.78
        source_high = -7.62
        for ref in ("P1", "P2", "P3"):
            signal_y = pinmap[ref + ".1"]["pos"][1]
            content_low = result["target_y"][ref] + specs[ref]["_content_low"][1] - signal_y
            content_high = result["target_y"][ref] + specs[ref]["_content_high"][1] - signal_y
            self.assertLessEqual(content_high, source_low - 5.08)
            self.assertLess(content_low, content_high)
        fields = [
            (
                result["target_x"][ref] + specs[ref]["_content_low"][0],
                result["target_x"][ref] + specs[ref]["_content_high"][0],
            )
            for ref in ("P1", "P2", "P3")
        ]
        fields.sort()
        self.assertTrue(
            all(
                right <= next_left
                for (_, right), (next_left, _) in zip(fields, fields[1:])
            )
        )

    def test_input_shunt_array_prefers_near_side_without_same_side_rows(self):
        specs = {
            "P": {
                "_low": [-7.62, -7.62],
                "width": 19.05,
                "height": 21.59,
                "_content_low": [-6.872, -3.81],
                "_content_high": [10.322, 3.81],
            }
        }
        pinmap = {
            "U1.1": {"pos": [-10.16, -12.7], "direction": [-1, 0]},
            "P.1": {"pos": [0, -3.81], "direction": [0, -1]},
            "P.2": {"pos": [0, 3.81], "direction": [0, 1]},
        }
        result = _input_shunt_array(
            [("P", "P.1", "P.2")],
            {"P": "U1.1"},
            ["U1.1"],
            -1,
            [-13.97, -22.86, 27.94, 29.21],
            specs,
            pinmap,
            5.08,
        )
        self.assertEqual(result["bandSide"], "below")
        self.assertGreater(result["target_y"]["P"], -12.7)

    def test_candidate_bank_advance_cannot_enter_the_visible_source_clearance(self):
        specs={'CAP': {'_low':[-7.62,-7.62], 'width':19.05, 'height':21.59,
                       '_content_low':[-6,-3.81], '_content_high':[10,3.81]}}
        pins={'IC.17':{'pos':[-10.16,-17.78],'direction':[-1,0]},
              'CAP.1':{'pos':[0,3.81],'direction':[0,1]},
              'CAP.2':{'pos':[0,-3.81],'direction':[0,-1]}}
        args=([('CAP','CAP.1','CAP.2')], {'CAP':'IC.17'}, ['IC.17'], -1,
              [-14,-23,28,29],specs,pins,5.08)
        baseline=_input_shunt_array(*args,branch_rows=[-17.78])
        moved=_input_shunt_array(*args,branch_rows=[-17.78],advance=100)
        self.assertGreater(moved['target_y']['CAP'],baseline['target_y']['CAP'])
        visible_bottom=moved['target_y']['CAP']+specs['CAP']['_content_high'][1]-pins['CAP.1']['pos'][1]
        self.assertLessEqual(visible_bottom,pins['IC.17']['pos'][1]-5.08)

    def test_input_shunt_orientation_follows_topology_band(self):
        # The input-filter bank is oriented from native pin directions and
        # branch topology, rather than from references or net names.  With
        # output branches on the same side as the horizontal inputs, the
        # compact bank is above the source rows and its signal pin faces down.
        hub_template = (
            '(symbol "T:Controller" (symbol "Controller_1_1" '
            '(pin input line (at 0 0 0) (length 2.54) (name "IN_A") (number "1")) '
            '(pin input line (at 0 5.08 0) (length 2.54) (name "IN_B") (number "2")) '
            '(pin output line (at 5.08 0 {angle}) (length 2.54) (name "OUT_A") (number "4")) '
            '(pin output line (at 5.08 5.08 {angle}) (length 2.54) (name "OUT_B") (number "5")) '
            '(pin output line (at 5.08 10.16 {angle}) (length 2.54) (name "OUT_C") (number "6")) '
            '(pin power_in line (at 0 15.24 90) (length 2.54) (name "GND") (number "7"))))'
        )
        cap_native = (
            '(symbol "T:Filter" (symbol "Filter_1_1" '
            '(pin passive line (at 0 3.81 270) (length 2.54) (name "1") (number "1")) '
            '(pin passive line (at 0 -3.81 90) (length 2.54) (name "2") (number "2"))))'
        )
        resistor_native = (
            '(symbol "T:Branch" (symbol "Branch_1_1" '
            '(pin passive line (at -2.54 0 0) (length 2.54) (name "1") (number "1")) '
            '(pin passive line (at 2.54 0 180) (length 2.54) (name "2") (number "2"))))'
        )

        def design(output_angle):
            component = lambda ref, library, pins: {
                "ref": ref,
                "librarySymbol": library,
                "pins": [
                    {
                        "number": str(number),
                        "type": pin_type,
                        "name": "GND" if ref == "controller" and str(number) == "7" else "",
                    }
                    for number, pin_type in pins
                ],
            }
            return {
                "components": [
                    component(
                        "controller",
                        "T:Controller",
                        [("1", "input"), ("2", "input"),
                         ("4", "output"), ("5", "output"),
                         ("6", "output"), ("7", "power_in")],
                    ),
                    component("filter", "T:Filter", [("1", "passive"), ("2", "passive")]),
                    *(component(ref, "T:Branch", [("1", "passive"), ("2", "passive")])
                      for ref in ("branch_a", "branch_b", "branch_c")),
                ],
                "nets": [
                    {"name": "INPUT_A", "nodes": ["controller.1", "filter.1"]},
                    {"name": "RETURN", "nodes": ["controller.7", "filter.2"]},
                    {"name": "OUTPUT_A", "nodes": ["controller.4", "branch_a.1"]},
                    {"name": "OUTPUT_B", "nodes": ["controller.5", "branch_b.1"]},
                    {"name": "OUTPUT_C", "nodes": ["controller.6", "branch_c.1"]},
                ],
            }, {
                "symbols": {
                    "T:Controller": {"native": hub_template.format(angle=output_angle)},
                    "T:Filter": {
                        "native": cap_native,
                        "appearance": {"kind": "capacitor"},
                    },
                    "T:Branch": {
                        "native": resistor_native,
                        "appearance": {"kind": "resistor"},
                    },
                }
            }

        same_side_design, same_side_resources = design(0)
        same_side = orientation_defaults(same_side_design, same_side_resources)
        self.assertEqual(same_side["filter"], 180)

        opposite_side_design, opposite_side_resources = design(180)
        opposite_side = orientation_defaults(opposite_side_design, opposite_side_resources)
        self.assertEqual(opposite_side["filter"], 0)

        # Defaults remain lower precedence than a caller's explicit rotation
        # and are removed for a frozen block by the existing merge contract.
        same_side_resources["blocks"] = [{"bindings": {"filter": "filter"}}]
        self.assertEqual(
            _merge_orientation_defaults(
                {"rotations": {"filter": 270}}, same_side, same_side_resources
            )["rotations"]["filter"],
            270,
        )

    def test_specified_input_shunts_keep_rowwise_native_geometry(self):
        specs = {
            ref: {
                "_low": [-7.62, -7.62],
                "width": 19.05,
                "height": 15.24,
            }
            for ref in ("P1", "P2")
        }
        pinmap = {
            "U1.1": {"pos": [-10.16, -12.7], "direction": [-1, 0]},
            "U1.2": {"pos": [-10.16, -7.62], "direction": [-1, 0]},
            "P1.1": {"pos": [0, -3.81], "direction": [0, -1]},
            "P1.2": {"pos": [0, 3.81], "direction": [0, 1]},
            "P2.1": {"pos": [0, -3.81], "direction": [0, -1]},
            "P2.2": {"pos": [0, 3.81], "direction": [0, 1]},
        }
        shunts = [("P1", "P1.1", "P1.2"), ("P2", "P2.1", "P2.2")]
        input_source = {"P1": "U1.1", "P2": "U1.2"}
        result = _rowwise_input_shunt_array(
            shunts,
            input_source,
            -1,
            [-10.16, -20.32, 10.16, 5.08],
            specs,
            pinmap,
            5.08,
        )
        self.assertEqual(result["bandSide"], "rowwise")
        self.assertEqual(result["target_y"], {"P1": -12.7, "P2": -7.62})

        components = {
            ref: {
                "ref": ref,
                "librarySymbol": "Evidence:fixed-cap",
                "pins": [
                    {"number": "1", "type": "passive"},
                    {"number": "2", "type": "passive"},
                ],
            }
            for ref in ("P1", "P2")
        }
        resources = {
            "symbols": {
                "Evidence:fixed-cap": {
                    "appearance": {"kind": "specified-capacitor"},
                }
            }
        }
        self.assertFalse(
            _auto_shunt_orientation_allowed("P1", components, resources)
        )

    def test_required_groups_use_standard_passives_without_claiming_shared_rails(self):
        design = {
            "components": [
                _component("U1", [("1", "input"), ("2", "power_in"), ("3", "power_in")]),
                {**_component("R1", [("1", "passive"), ("2", "passive")]), "librarySymbol": "Device:R"},
                {**_component("C1", [("1", "passive"), ("2", "passive")]), "librarySymbol": "Device:C"},
            ],
            "nets": [
                {"name": "SIG", "nodes": ["U1.1", "R1.1"]},
                {"name": "+5V", "nodes": ["U1.2", "C1.1"]},
                {"name": "GND", "nodes": ["U1.3", "C1.2", "R1.2"]},
            ],
        }
        resources = {
            "symbols": {
                "Evidence:U1": {"appearance": {"kind": "specified-receiver"}},
                "Device:R": {"description": "Resistor"},
                "Device:C": {"description": "Capacitor"},
            }
        }
        self.assertEqual(
            required_visual_groups(design, resources),
            [{"U1", "R1"}],
        )

    def test_auto_orientation_skips_existing_frozen_device_resistor_block(self):
        requested = {"rotations": {}}
        resources = {
            "symbols": {"Device:R": {"description": "Resistor"}},
            "blocks": [{"bindings": {"resistor": "R1"}}],
        }
        merged = _merge_orientation_defaults(
            requested,
            {"R1": 90, "C1": 0},
            resources,
        )
        self.assertEqual(merged["rotations"], {"C1": 0})

        explicit = {"rotations": {"R1": 180}}
        merged_explicit = _merge_orientation_defaults(
            explicit,
            {"R1": 90, "C1": 0},
            resources,
        )
        self.assertEqual(merged_explicit["rotations"]["R1"], 180)

    def test_normalize_keeps_declared_decoupling_and_resource_blocks_atomic(self):
        design = {
            "components": [
                _component("U1", [("1", "power_in"), ("2", "power_in")]),
                {**_component("C1", [("1", "passive"), ("2", "passive")]), "librarySymbol": "Device:C"},
                {**_component("R1", [("1", "passive"), ("2", "passive")]), "librarySymbol": "Device:R"},
                {**_component("R2", [("1", "passive"), ("2", "passive")]), "librarySymbol": "Device:R"},
            ],
            "nets": [
                {"name": "+5V", "nodes": ["U1.1", "C1.1"]},
                {"name": "GND", "nodes": ["U1.2", "C1.2"]},
                {"name": "N1", "nodes": ["R1.1"]},
                {"name": "N2", "nodes": ["R1.2"]},
                {"name": "N3", "nodes": ["R2.1"]},
                {"name": "N4", "nodes": ["R2.2"]},
            ],
            "functions": [{"layout": [{
                "kind": "decoupling",
                "anchor": "U1.1",
                "return": "U1.2",
                "members": ["C1"],
            }]}],
        }
        resources = {
            "symbols": {
                "Device:C": {"description": "Capacitor"},
                "Device:R": {"description": "Resistor"},
            },
            "blocks": [{"bindings": {"a": "R1", "b": "R2"}}],
        }
        split = {
            "template": "generic-v1",
            "paper": "A3-landscape",
            "gapMm": 5.08,
            "groups": [
                {"id": "power", "title": "Power", "references": ["U1"]},
                {"id": "cap", "title": "Cap", "references": ["C1"]},
                {"id": "r1", "title": "R1", "references": ["R1"]},
                {"id": "r2", "title": "R2", "references": ["R2"]},
            ],
        }
        with self.assertRaisesRegex(ValueError, "functional circuit"):
            normalize_layout(split, design, resources)

        joined_decoupling = dict(split, groups=[
            {"id": "power", "title": "Power", "references": ["U1", "C1", "R1"]},
            {"id": "r2", "title": "R2", "references": ["R2"]},
        ])
        with self.assertRaisesRegex(ValueError, "resource block"):
            normalize_layout(joined_decoupling, design, resources)

    def test_default_grouping_receives_resource_blocks_as_atomic_units(self):
        design = {
            "components": [
                {**_component("U1", [("1", "output"), ("2", "output"), ("3", "output")]), "librarySymbol": "Evidence:U"},
                {**_component("R1", [("1", "passive"), ("2", "passive")]), "librarySymbol": "Device:R"},
                {**_component("C1", [("1", "passive"), ("2", "passive")]), "librarySymbol": "Device:C"},
            ],
            "nets": [
                {"name": "SIG", "nodes": ["U1.1", "R1.1"]},
                {"name": "SIG_RETURN", "nodes": ["R1.2"]},
                {"name": "+5V", "nodes": ["C1.1"]},
                {"name": "GND", "nodes": ["C1.2"]},
                {"name": "SPARE1", "nodes": ["U1.2"]},
                {"name": "SPARE2", "nodes": ["U1.3"]},
            ],
        }
        resources = {
            "symbols": {
                "Evidence:U": {
                    "drawingRules": {"origin": "fact"},
                    "appearance": {"kind": "logic-ic"},
                },
                "Device:R": {"drawingRules": {"origin": "kicad-library"}},
                "Device:C": {"drawingRules": {"origin": "kicad-library"}},
            },
            "blocks": [{"blockId": "frozen-filter", "bindings": {"r": "R1", "c": "C1"}}],
        }
        layout = normalize_layout(
            {"template": "generic-v1", "paper": "A3-landscape", "gapMm": 5.08},
            design,
            resources,
        )
        grouped = next(
            group for group in layout["groups"] if "R1" in group["references"]
        )
        self.assertIn("C1", grouped["references"])

    def test_serial_chain_target_keeps_routing_boxes_separated(self):
        # The source-pin advance is measured from both passive routing boxes,
        # rather than from the previous pin alone.  This is the geometry that
        # lets a two-resistor branch stay on the topology-first path.
        target = _serial_next_target(
            current_origin=0.0,
            current_low=-7.62,
            current_size=16.51,
            end=3.81,
            next_low=-7.62,
            next_size=16.51,
            next_pin=-3.81,
            side=1,
            gap=5.08,
        )
        current_high = 0.0 - 7.62 + 16.51
        next_low_at_target = target + (-7.62 - (-3.81))
        self.assertGreaterEqual(next_low_at_target - current_high, 5.08)
        self.assertGreater(target, 3.81 + 5.08 + 5.08)

    def test_compact_passive_fields_compensate_instance_rotation(self):
        # Device:R/C fields are stored in the symbol's local frame.  A 90/270
        # degree instance must therefore carry the complementary local angle
        # or KiCad renders the otherwise readable page label vertically.
        from native_resources import Atom as A

        def prop(name, value):
            return [
                "property",
                name,
                value,
                ["at", A("0"), A("0"), A("0")],
                ["effects", ["font", ["size", A("1.27"), A("1.27")]]],
            ]

        parts = [prop("Reference", "R1"), prop("Value", "10k")]
        _compact_passive_fields(parts, parts, [-2.5, -1, 2.5, 1], True, 270)
        self.assertEqual(float(parts[0][3][3]), 90.0)
        self.assertEqual(float(parts[1][3][3]), 90.0)

        parts = [prop("Reference", "C1"), prop("Value", "100nF")]
        _compact_passive_fields(parts, parts, [-1, -2.5, 1, 2.5], False, 0)
        self.assertEqual(float(parts[0][3][3]), 0.0)

    def test_compact_passive_fields_reserve_rendered_rotated_glyph_box(self):
        # KiCad's 90-degree property frame renders the glyph to the left and
        # below its anchor.  The returned obstacle must follow that PDF
        # envelope so an orthogonal bypass route cannot cross the label.
        from native_resources import Atom as A

        def prop(name, value):
            return [
                "property",
                name,
                value,
                ["at", A("0"), A("0"), A("0")],
                ["effects", ["font", ["size", A("1.27"), A("1.27")]]],
            ]

        parts = [prop("Reference", "C1"), prop("Value", "100nF")]
        boxes = _compact_passive_fields(
            parts,
            parts,
            [-3.81, -2.032, 3.81, 2.032],
            True,
            90,
        )
        # The fields sit just below the body in page coordinates, but the
        # rotated glyph reserve extends left of each property anchor.
        self.assertAlmostEqual(float(parts[0][3][2]), 2.532, places=3)
        self.assertAlmostEqual(float(parts[1][3][2]), 2.532, places=3)
        # Keep the value field clear of a neighbouring source-row label.  A
        # 90-degree glyph grows left, so its anchor can sit just inside the
        # terminal envelope without touching the body below it.
        self.assertAlmostEqual(float(parts[1][3][1]), 3.556, places=3)
        self.assertLess(boxes[0][0], boxes[0][2])
        self.assertLess(boxes[0][0], float(parts[0][3][1]))
        self.assertGreater(boxes[0][2], float(parts[0][3][1]))
        self.assertLess(boxes[1][0], float(parts[1][3][1]))
        self.assertGreater(boxes[0][3], float(parts[0][3][2]))

    def test_compact_passive_fields_reserve_rightward_glyph_for_270_instance(self):
        # A local 90-degree property on a 270-degree instance is rendered
        # upright and grows to the right in page coordinates.  The obstacle
        # must follow that actual envelope so a return trunk cannot cross the
        # visible value field.
        from native_resources import Atom as A

        def prop(name, value):
            return [
                "property",
                name,
                value,
                ["at", A("0"), A("0"), A("0")],
                ["effects", ["font", ["size", A("1.27"), A("1.27")]]],
            ]

        parts = [prop("Reference", "C6"), prop("Value", "100nF")]
        boxes = _compact_passive_fields(
            parts,
            parts,
            [-3.81, -2.032, 3.81, 2.032],
            True,
            270,
        )
        value_x = float(parts[1][3][1])
        value_y = float(parts[1][3][2])
        self.assertGreater(boxes[1][0], value_x - 0.3)
        self.assertGreater(boxes[1][2], value_x + len("100nF") * 1.15)
        self.assertLess(boxes[1][1], value_y)
        self.assertGreater(boxes[1][3], value_y)
        # Native PDF stroke glyphs extend 0.954 mm above and 0.316 mm
        # below the property anchor for this compensated orientation.
        self.assertLessEqual(boxes[1][1], value_y - 0.954)
        self.assertGreaterEqual(boxes[1][3], value_y + 0.316)

    def test_vertical_flipped_passive_fields_keep_page_space_justification(self):
        from design_audit import child
        parts = [["property", key, value, ["at", "0", "0", "0"], ["effects", ["font", ["size", "1.27", "1.27"]]]]
                 for key,value in (("Reference","filter"),("Value","100pF"))]
        boxes = _compact_passive_fields(parts,parts,[-2.032,-3.81,2.032,3.81],False,180)
        for prop,box in zip(parts,boxes):
            self.assertEqual(child(child(prop,"effects"),"justify")[1:],["right","top"])
            self.assertLess(box[1],float(child(prop,"at")[2]))
        self.assertLess(boxes[0][2],-2.032)
        self.assertGreater(boxes[1][0],2.032)

    def test_pin_number_lane_respects_rotation_and_hidden_numbers(self):
        symbol={"pins":[{"at":[-5.08,0,0],"length":2.54,"number":"7"}]}
        horizontal=_pin_number_boxes(symbol,[10.16,20.32],0)[0]
        self.assertLess(horizontal[1],20.32)
        self.assertGreater(horizontal[3],20.32)
        self.assertGreater(horizontal[0],5.08)
        rotated=_pin_number_boxes(symbol,[10.16,20.32],90)[0]
        self.assertLess(rotated[0],10.16)
        self.assertGreater(rotated[2],10.16)
        self.assertEqual(_pin_number_boxes(dict(symbol,pin_numbers_visible=False),[0,0],0),[])
        short={"pins":[{"at":[0,0,0],"length":.05,"number":"1"}]}
        box=_pin_number_boxes(short,[0,0],0)[0]
        self.assertLess(box[0],box[2])

    def test_open_terminal_lead_shortens_before_neighbour_body(self):
        # A shared-return label lead may otherwise terminate inside a nearby
        # second-stage passive body.  Preserve the outward direction and use
        # the longest clear native-grid stub.
        endpoint = _safe_terminal_lead(
            [5.0, 0.0],
            [0, 1],
            "C4",
            [("R8", [4.5, 5.0, 5.5, 6.0])],
            7.62,
        )
        self.assertEqual(endpoint, [5.0, 3.81])

    def test_decouplers_stay_near_owner_and_clear_measured_boxes(self):
        specs = {
            "U1": {"_low": [-10, -10], "width": 20, "height": 20},
            "C1": {"_low": [-5, -2], "width": 10, "height": 4},
            "C2": {"_low": [-5, -2], "width": 10, "height": 4},
        }
        positions = {"U1": [0, 0]}
        pinmap = {
            "U1.1": {"pos": [-10, 0], "direction": [-1, 0]},
            "U1.2": {"pos": [10, 0], "direction": [1, 0]},
            "C1.1": {"pos": [-3, 0], "direction": [-1, 0]},
            "C1.2": {"pos": [3, 0], "direction": [1, 0]},
            "C2.1": {"pos": [-3, 0], "direction": [-1, 0]},
            "C2.2": {"pos": [3, 0], "direction": [1, 0]},
        }
        decouplers = [
            ("C1", "U1.1", "U1.2", "C1.1", "C1.2"),
            ("C2", "U1.1", "U1.2", "C2.1", "C2.2"),
        ]
        result = _decoupling_positions(
            decouplers,
            [-10, -10, 10, 10],
            positions,
            specs,
            pinmap,
            5.08,
        )
        self.assertEqual(set(result), {"C1", "C2"})
        # A particular left-side placement is not part of the contract. Real
        # outward leads can make the upper or lower side the closer safe one.
        self.assertTrue(all(abs(result[ref][0])+abs(result[ref][1]) < 40 for ref in result))
        boxes = [
            [
                result[ref][0] + specs[ref]["_low"][0],
                result[ref][1] + specs[ref]["_low"][1],
                result[ref][0] + specs[ref]["_low"][0] + specs[ref]["width"],
                result[ref][1] + specs[ref]["_low"][1] + specs[ref]["height"],
            ]
            for ref in ("C1", "C2")
        ]
        separated = (
            boxes[0][2] <= boxes[1][0]
            or boxes[1][2] <= boxes[0][0]
            or boxes[0][3] <= boxes[1][1]
            or boxes[1][3] <= boxes[0][1]
        )
        self.assertTrue(separated)

    def test_owned_bypass_above_occupied_feed_keeps_facing_supply_corridor(self):
        # The direct supply row is occupied by its feed resistor.  A bypass
        # may move above it, but its facing pin should not move behind the
        # owner's pin and force a U-turn. Ground is a local label here.
        specs = {
            'IC': {'_low': [-10, -10], 'width': 20, 'height': 20},
            'FEED': {'_low': [-15, -4], 'width': 30, 'height': 8},
            'BYPASS': {'_low': [-12, -4], 'width': 24, 'height': 8},
        }
        pinmap = {
            'IC.1': {'pos': [-10, 0], 'direction': [-1, 0]},
            'IC.2': {'pos': [10, 0], 'direction': [1, 0]},
            'BYPASS.1': {'pos': [3.81, 0], 'direction': [1, 0]},
            'BYPASS.2': {'pos': [-3.81, 0], 'direction': [-1, 0]},
        }
        result = _decoupling_positions(
            [('BYPASS', 'IC.1', 'IC.2', 'BYPASS.1', 'BYPASS.2')],
            [-10, -10, 10, 10], {'IC': [0, 0], 'FEED': [-35, 0]},
            specs, pinmap, 5.08, local_returns={'IC.2'})
        self.assertTrue(result)
        supply_x = result['BYPASS'][0] + pinmap['BYPASS.1']['pos'][0]
        self.assertLessEqual(supply_x, pinmap['IC.1']['pos'][0] - 5.08)

    def test_owned_bypass_facing_corridor_survives_translation_and_quarter_turns(self):
        def rotate(point, turns):
            x, y = point
            for _ in range(turns):
                x, y = -y, x
            return [x, y]

        offset = [50.8, 25.4]
        for turns in range(4):
            with self.subTest(turns=turns):
                specs = {}
                for ref, half in [('CORE', [10, 10]), ('FEED', [15, 4]), ('LOCAL', [12, 4])]:
                    w, h = (half[::-1] if turns % 2 else half)
                    specs[ref] = {'_low': [-w, -h], 'width': 2*w, 'height': 2*h}
                pinmap = {}
                for key, point, direction in [
                    ('CORE.1', [-10, 0], [-1, 0]), ('CORE.2', [10, 0], [1, 0]),
                    ('LOCAL.1', [3.81, 0], [1, 0]), ('LOCAL.2', [-3.81, 0], [-1, 0])]:
                    pinmap[key] = {'pos': rotate(point, turns), 'direction': rotate(direction, turns)}
                feed = rotate([-35, 0], turns)
                positions = {'CORE': offset, 'FEED': [offset[i]+feed[i] for i in (0, 1)]}
                result = _decoupling_positions(
                    [('LOCAL', 'CORE.1', 'CORE.2', 'LOCAL.1', 'LOCAL.2')],
                    [offset[0]-10, offset[1]-10, offset[0]+10, offset[1]+10],
                    positions, specs, pinmap, 5.08, local_returns={'CORE.2'})
                self.assertTrue(result)
                source = [offset[i]+pinmap['CORE.1']['pos'][i] for i in (0, 1)]
                target = [result['LOCAL'][i]+pinmap['LOCAL.1']['pos'][i] for i in (0, 1)]
                facing_gap = sum((target[i]-source[i])*pinmap['CORE.1']['direction'][i] for i in (0, 1))
                self.assertGreaterEqual(facing_gap, 5.08)

    def test_decoupling_signal_pairs_share_same_supply_domain(self):
        # Two declared capacitors on the same anchor/return domains should
        # form one local trunk with taps.  Connecting both directly to the
        # owner pin makes the router draw two independent perimeter paths and
        # lets the serialized capacitor order decide the visual topology.
        decouplers = [
            ("C1", "U1.1", "U1.2", "C1.1", "C1.2"),
            ("C2", "U1.1", "U1.2", "C2.1", "C2.2"),
        ]
        positions = {"U1": [0.0, 0.0], "C1": [10.0, 0.0], "C2": [30.0, 0.0]}
        pinmap = {
            "U1.1": {"pos": [0.0, 0.0]},
            "U1.2": {"pos": [0.0, 5.0]},
            "C1.1": {"pos": [0.0, 0.0]},
            "C1.2": {"pos": [0.0, 5.0]},
            "C2.1": {"pos": [0.0, 0.0]},
            "C2.2": {"pos": [0.0, 5.0]},
        }
        netof = {
            "U1.1": "+5V", "C1.1": "+5V", "C2.1": "+5V",
            "U1.2": "GND", "C1.2": "GND", "C2.2": "GND",
        }
        expected = [("U1.1", "C1.1"), ("C1.1", "C2.1")]
        for permutation in itertools.permutations(decouplers):
            self.assertEqual(
                _decoupling_signal_pairs(list(permutation), positions, pinmap, netof),
                expected,
            )


if __name__ == "__main__":
    unittest.main()
