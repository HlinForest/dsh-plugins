from pathlib import Path
import copy,sys,unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'mcp'))
from layout_quality import unwired_metrics

class LabelSpan(unittest.TestCase):
    def circuit(self):
        state={'symbols':{'ONE':{'pins':[{'number':'9','at':[0,0]}]}},'items':{
            name:{'kind':'component','reference':name,'symbol':'ONE','at':xy}
            for name,xy in [('SRC',[0,0]),('MID',[10,0]),('LOAD',[30,0]) ]}}
        d={'nets':[{'name':'any-name','nodes':['SRC.9','MID.9','LOAD.9']}]}
        return state,d
    def test_labels_do_not_hide_physical_separation(self):
        s,d=self.circuit();s['items']['label']={'kind':'label','text':'any-name','at':[0,0]}
        self.assertEqual(unwired_metrics(s,d),{'labelSpanMm':30,'labelSeparatedNets':1,'labelIslandLinks':2})
    def test_real_wires_remove_only_the_islands_they_connect(self):
        s,d=self.circuit();s['items']['wire']={'kind':'wire','points':[[0,0],[10,0]]}
        self.assertEqual(unwired_metrics(s,d)['labelSpanMm'],20)
        s['items']['wire']['points'].append([30,0])
        self.assertEqual(unwired_metrics(s,d)['labelSpanMm'],0)
    def test_order_and_net_name_cannot_change_the_distance(self):
        s,d=self.circuit();before=copy.deepcopy((s,d));expected=unwired_metrics(s,d)
        self.assertEqual((s,d),before)
        d['nets'][0]['nodes'].reverse();d['nets'][0]['name']='renamed'
        self.assertEqual(unwired_metrics(s,d),expected)
    def test_missing_native_pin_is_an_error_not_zero_cost(self):
        s,d=self.circuit();s['items'].pop('MID')
        with self.assertRaisesRegex(ValueError,'Missing native terminal'):unwired_metrics(s,d)

if __name__=='__main__':unittest.main()
