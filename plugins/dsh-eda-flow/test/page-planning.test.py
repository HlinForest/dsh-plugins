"""Page-level packing must not promote paper because of incidental group order."""
import sys
import unittest
import copy
import itertools
from unittest.mock import patch
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'mcp'))
from generic_layout import pack_groups
from page_planning import signal_affinities


class PagePlanningRegression(unittest.TestCase):
    def test_shared_interface_can_touch_two_peers_without_center_alignment(self):
        groups=[({'id':name},{'width':w,'height':h}) for name,w,h in
                [('sensor',60,50),('driver',150,75),('port',60,40),('display',45,65)]]
        links=[{'source':'sensor','target':'port','weight':1},
               {'source':'driver','target':'port','weight':3},
               {'source':'driver','target':'display','weight':10}]
        result=pack_groups(groups,240,135,5,connections=links)
        self.assertFits(result,240,135,5)
        boxes={b['id']:b for b in result['children']}
        for peer in ('sensor','driver'):
            a,b=boxes[peer],boxes['port']
            separation=sum(max(0,a[axis]-b[axis]-b[size],b[axis]-a[axis]-a[size])
                           for axis,size in [('x','width'),('y','height')])
            self.assertLessEqual(separation,5.01,'A wide peer pulled the shared interface away from its other neighbor')

    def test_feasible_but_worse_solver_result_does_not_replace_measured_candidate(self):
        groups=[({'id':name},{'width':40,'height':30}) for name in ('a','b')]
        links=[{'source':'a','target':'b','weight':5}]
        worse={'width':180,'height':80,'children':[
            {'id':'a','x':0,'y':0,'width':40,'height':30},
            {'id':'b','x':140,'y':50,'width':40,'height':30}]}
        with patch('page_planning._constraint_pack',return_value=worse):
            result=pack_groups(groups,200,100,5,connections=links)
        self.assertFits(result,200,100,5)
        self.assertLess(result['candidateSearch']['selectedScore'],result['candidateSearch']['solverScore'])
        self.assertEqual(result['strategy'],'topology-seeded-rows-columns')

    def test_signal_driven_packing_ignores_serialized_group_and_edge_order(self):
        groups=[({'id':name},{'width':w,'height':h}) for name,w,h in
                [('sensor',73,65),('driver',141,87),('port',79,46),('display',44,75)]]
        links=[{'source':'sensor','target':'port','weight':1},
               {'source':'driver','target':'port','weight':3},
               {'source':'driver','target':'display','weight':10}]
        before=copy.deepcopy(groups)
        original=pack_groups(groups,276,154,5,connections=links)
        changed=pack_groups(list(reversed(groups)),276,154,5,connections=list(reversed(links)))
        self.assertFits(original,276,154,5);self.assertFits(changed,276,154,5)
        positions=lambda p:{b['id']:(b['x'],b['y']) for b in p['children']}
        self.assertEqual(positions(original),positions(changed), 'Serialization order still changes the inferred page layout')
        self.assertEqual(groups,before)

    def assertFits(self, result, width, height, gap):
        self.assertIsNotNone(result)
        for box in result['children']:
            self.assertGreaterEqual(box['x'], 0)
            self.assertGreaterEqual(box['y'], 0)
            self.assertLessEqual(box['x']+box['width'], width+1e-6)
            self.assertLessEqual(box['y']+box['height'], height+1e-6)
        for a, b in itertools.combinations(result['children'], 2):
            self.assertTrue(a['x']+a['width']+gap <= b['x']+1e-6 or
                            b['x']+b['width']+gap <= a['x']+1e-6 or
                            a['y']+a['height']+gap <= b['y']+1e-6 or
                            b['y']+b['height']+gap <= a['y']+1e-6)

    def test_functional_groups_fill_independent_columns_before_enlarging_paper(self):
        groups = [({'id': name}, {'width': w, 'height': h})
                  for name, w, h in [('a', 57, 94), ('b', 79, 71), ('c', 126, 79),
                                     ('d', 47, 48), ('e', 46, 77)]]
        # A small group can fill the space beneath a shorter upper group;
        # it need not wait below the tallest item in the preceding row.
        result = pack_groups(groups, 276, 154, 5)
        self.assertIsNotNone(result, 'Input group order forced an unnecessary larger sheet')
        self.assertFits(result, 276, 154, 5)

    def test_signal_relations_bring_related_circuits_together(self):
        groups = [({'id': name}, {'width': 40, 'height': 30}) for name in ('source', 'other', 'load')]
        links = [{'source': 'source', 'target': 'load', 'weight': 10}]
        before = copy.deepcopy(groups)
        result = pack_groups(groups, 140, 90, 5, connections=links)
        self.assertFits(result, 140, 90, 5)
        boxes = {b['id']: b for b in result['children']}
        distance = lambda a,b: abs(a['x']-b['x'])+abs(a['y']-b['y'])
        self.assertLessEqual(distance(boxes['source'], boxes['load']), 45)
        self.assertEqual(groups, before)

    def test_unrelated_group_shapes_and_counts(self):
        for shapes in ([(28,24),(53,38)], [(35,30)]*4,
                       [(38,48),(23,17),(60,25),(31,35),(40,20),(16,26),(35,28)]):
            groups = [({'id': f'block-{i}'}, {'width': w, 'height': h}) for i,(w,h) in enumerate(shapes)]
            links = [{'source': f'block-{i}', 'target': f'block-{i+1}', 'weight': 1}
                     for i in range(len(groups)-1)]
            with self.subTest(count=len(groups)):
                result = pack_groups(groups, 240, 160, 5, top_margin=6, connections=links)
                self.assertFits(result, 240, 160, 5)
                self.assertEqual(len(result['children']), len(groups))
                self.assertEqual([b['height'] for b in result['children']], [h+6 for _,h in shapes])

    def test_impossible_bounds_remain_impossible(self):
        groups = [({'id': 'one'}, {'width': 110, 'height': 80})]
        self.assertIsNone(pack_groups(groups, 100, 90, 5))
        self.assertIsNone(pack_groups(groups, 115, 85, 5, top_margin=6))

    def test_supply_hubs_and_duplicate_pins_do_not_distort_signal_affinities(self):
        groups = [{'id': ref, 'references': [ref]} for ref in ('controller', 'sensor', 'port')]
        design = {
            'components': [{'ref': ref, 'pins': [
                {'number':'1','type':'power_in'}, {'number':'2','type':'passive'},
                {'number':'3','type':'passive'}, {'number':'4','type':'passive'}]}
                for ref in ('controller', 'sensor', 'port')],
            'nets': [
                {'name':'RAIL_WITH_ARBITRARY_NAME','nodes':['controller.1','sensor.1','port.1']},
                {'name':'GND','nodes':['controller.4','sensor.4','port.4']},
                {'name':'BUS','nodes':['controller.2','sensor.2','sensor.3','port.2']},
            ]
        }
        self.assertEqual(signal_affinities(design, groups), [
            {'source':'controller','target':'port','weight':1},
            {'source':'controller','target':'sensor','weight':1},
            {'source':'port','target':'sensor','weight':1}])

    def test_explicit_row_boundary_remains_a_constraint(self):
        groups = [({'id': str(i)}, {'width': 45, 'height': 25}) for i in range(4)]
        result = pack_groups(groups, 110, 100, 5, [2],
                             connections=[{'source':'0','target':'3','weight':8}])
        self.assertFits(result, 110, 100, 5)
        boxes = result['children']
        self.assertEqual(boxes[0]['y'], boxes[1]['y'])
        self.assertGreater(boxes[2]['y'], boxes[0]['y'])


if __name__ == '__main__':
    unittest.main()
