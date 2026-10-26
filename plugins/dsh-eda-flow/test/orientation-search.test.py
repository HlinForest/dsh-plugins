from pathlib import Path
import copy,json,math,sys,tempfile,unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'mcp'))
from orientation_search import candidates,select_candidate
from layout_quality import wire_metrics,complexity
from topology_layout import decoupling_return_nodes,place_driver
from driver_inputs import ground_island

def circuit():
    def part(ref,lib,pins):return {'ref':ref,'librarySymbol':lib,'pins':[{'number':str(n),'type':kind} for n,kind in pins]}
    d={'components':[part('CTRL','Logic:Hub',[(7,'input'),(9,'input'),(11,'power_in'),(13,'power_in'),(21,'output'),(22,'output'),(23,'output')])]
       ,'nets':[{'name':'alpha','nodes':['CTRL.7','FA.1']},{'name':'beta','nodes':['CTRL.9','FB.2']},
                {'name':'positive','nodes':['CTRL.11','PA.1','PB.1']},
                {'name':'return','nodes':['CTRL.13','FA.2','FB.1','PA.2','PB.2']}],
        'functions':[{'layout':[{'kind':'decoupling','anchor':'CTRL.11','return':'CTRL.13','members':['PA','PB']}]}]}
    for ref in ('FA','FB','PA','PB'):d['components'].append(part(ref,'Device:C',[(1,'passive'),(2,'passive')]))
    r={'symbols':{'Device:C':{'description':'Capacitor'},'Logic:Hub':{'description':'Driver'}}}
    layout={'template':'generic-v1','paper':'A4-landscape','gapMm':5.08,
            'groups':[{'id':'region','title':'Control','references':[c['ref'] for c in d['components']]}],
            'rotations':{'CTRL':0,'FA':0,'FB':180,'PA':90,'PB':90}}
    return d,r,layout

class OrientationSearch(unittest.TestCase):
    def test_bank_choices_preserve_network_and_pin_identity(self):
        d,r,l=circuit();before=copy.deepcopy((d,r,l))
        banks,plans=candidates(d,r,l)
        self.assertEqual(len(banks),2);self.assertEqual(len(plans),4)
        self.assertEqual((d,r,l),before)
        self.assertEqual(plans[0]['layout'],l)
        self.assertTrue(all(p['layout']['rotations']['CTRL']==0 for p in plans))
        self.assertEqual(decoupling_return_nodes(d,r,l['groups']),{'CTRL.13','PA.2','PB.2'})
        for net in d['nets']:net['nodes'].reverse()
        d['nets'].reverse();d['components'].reverse()
        self.assertEqual(candidates(d,r,l), (banks,plans))

    def test_one_explicit_rotation_preserves_its_whole_bank(self):
        d,r,l=circuit();banks,plans=candidates(d,r,l,{'FA':0})
        self.assertEqual([b['role'] for b in banks],['power-bypass'])
        self.assertTrue(all(p['layout']['rotations']['FB']==180 for p in plans))

    def test_installed_capacitor_symbols_keep_the_short_filter_return_island(self):
        d,r,l=circuit()
        for c in d['components']:
            for p in c['pins']:p['name']='GND' if c['ref']=='CTRL' and p['number']=='13' else p['number']
        self.assertNotIn('appearance',r['symbols']['Device:C'])
        self.assertEqual(ground_island(d,r,l['groups'][0]['references']),{'FA.2','FB.1'})
        d['nets'][1]['nodes'].remove('FB.2');d['nets'][0]['nodes'].append('FB.2')
        # It remains one local return island even when inputs share a signal.
        self.assertEqual(ground_island(d,r,l['groups'][0]['references']),{'FA.2','FB.1'})

    def test_drawing_contracts_and_frozen_blocks_are_not_search_inputs(self):
        for kind in ('drawing','specified','frozen'):
            d,r,l=circuit()
            if kind=='drawing':r['symbols']['Device:C']['drawingRules']={'keep':True}
            elif kind=='specified':r['symbols']['Device:C']['appearance']={'kind':'specified-capacitor'}
            else:r['blocks']=[{'bindings':{c['ref']:c['ref'] for c in d['components']}}]
            self.assertEqual(len(candidates(d,r,l)[1]),1,kind)
            if kind=='frozen':self.assertEqual(decoupling_return_nodes(d,r,l['groups']),set())

    def test_failed_first_route_does_not_hide_another_power_side(self):
        def render(*args,**kwargs):
            if kwargs.get('placement_only'):return {'_bankAdvanceLimit':0,'_powerChoiceCount':2}
            choice=args[8]
            if choice==0:return None
            return {'width':20,'height':20,'edges':[{'net':'N','sections':[{'startPoint':{'x':0,'y':0},'endPoint':{'x':10,'y':0}}]}],
                    '_bankAdvanceLimit':0,'_powerChoiceCount':2}
        with patch('topology_layout._place_driver_candidate',side_effect=render):
            result=place_driver({}, {}, {}, {}, {}, 5.08)
        self.assertEqual(result['placementSearch']['selectedPowerCandidate'],1)

    def test_only_native_and_routing_checked_candidates_can_replace_output(self):
        with tempfile.TemporaryDirectory() as folder:
            out=Path(folder);plans=[{'id':i,'flippedBanks':[],'layout':{'rotations':{},'id':i}} for i in range(4)]
            def render(layout,directory):
                (directory/'drawing.txt').write_text(str(layout['id']))
                return {'status':'failed' if layout['id']==0 else 'passed','errors':[],'id':layout['id']}
            def measure(directory,report):return {'score':[report['id']],'routingStatus':'failed' if report['id']==1 else 'passed'}
            report,search=select_candidate(plans,out,render,measure)
            self.assertEqual(report['id'],2);self.assertEqual((out/'drawing.txt').read_text(),'2')
            self.assertEqual(search['selected'],2);self.assertFalse(list(out.glob('.orientation-*')))
            with self.assertRaisesRegex(ValueError,'No independently checked'):
                select_candidate(plans,out,render,lambda *args:{'score':[math.nan]})
            self.assertEqual((out/'drawing.txt').read_text(),'2')
            self.assertFalse(list(out.glob('.orientation-*')))

    def test_metrics_distinguish_crossing_junction_and_turn(self):
        segments=[((0,5),(10,5)),((5,0),(5,10)),((20,0),(20,5)),((20,5),(25,5))]
        raw=wire_metrics(segments);joined=wire_metrics(segments,[(5,5)])
        self.assertEqual(raw['crossings'],1);self.assertEqual(joined['crossings'],0)
        self.assertEqual(raw['bends'],1);self.assertEqual(raw['wireMm'],30)
        self.assertGreater(complexity(raw,30,10),complexity(joined,30,10))

    def test_label_proximity_cannot_replace_a_better_routed_orientation(self):
        plans=[{'id':i,'flippedBanks':[], 'layout':{'rotations':{},'id':i,
                'groups':[{'references':['one','two']}] if i>0 else [{'references':['one']},{'references':['two']}]}} for i in range(3)]
        with tempfile.TemporaryDirectory() as folder:
            def render(layout,directory):return {'status':'passed','id':layout['id']}
            def measure(directory,report):
                i=report['id']
                return {'orientationScore':[[10],[11],[30]][i],'score':[[100],[70],[50]][i]}
            report,search=select_candidate(plans,Path(folder),render,measure)
            self.assertEqual(report['id'],1)
            self.assertFalse(search['candidates'][2]['orientationWinnerForGrouping'])

if __name__=='__main__':unittest.main()
