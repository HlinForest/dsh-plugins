import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'python'))
from pcb_signal_placement import signal_filter_relations,filter_row_banks

class Tests(unittest.TestCase):
    def setUp(self):
        self.components=[{'ref':'FILTER_X','electricalRole':'interface-filter','pins':[{'number':'1','type':'passive'},{'number':'2','type':'passive'}]},
                         {'ref':'RECEIVER_Z','pins':[{'number':'7','pad':'B2','type':'input'},{'number':'8','pad':'B3','type':'power_in'}]}]
        self.nets={('FILTER_X','1'):'/signal-a',('FILTER_X','2'):'/return-a',('RECEIVER_Z','B2'):'/signal-a',('RECEIVER_Z','B3'):'/return-a'}
        self.process={'copperNets':[{'name':'/return-a','kind':'return'}]}
    def test_explicit_filter_is_owned_by_receiver_pin_without_ref_or_net_name_rules(self):
        result=signal_filter_relations(self.components,self.nets,self.process)
        self.assertEqual(result['FILTER_X']['anchor'],{'ref':'RECEIVER_Z','pad':'B2'})
        self.assertEqual(result['FILTER_X']['return'],{'ref':'RECEIVER_Z','pad':'B3'})
        self.assertNotIn('maxDistanceMm',result['FILTER_X'])
    def test_no_inferred_owner_from_ambiguous_multidrop_or_missing_role(self):
        other={'ref':'SECOND','pins':[{'number':'1','type':'input'},{'number':'2','type':'power_in'}]}
        self.components.append(other);self.nets.update({('SECOND','1'):'/signal-a',('SECOND','2'):'/return-a'})
        self.assertEqual(signal_filter_relations(self.components,self.nets,self.process),{})
        self.components=self.components[:2];self.components[0].pop('electricalRole')
        self.assertEqual(signal_filter_relations(self.components,self.nets,self.process),{})
    def test_series_filter_and_unproven_return_are_not_shunt_filters(self):
        self.process['copperNets']=[]
        self.assertEqual(signal_filter_relations(self.components,self.nets,self.process),{})

    def test_common_return_filters_follow_physical_receiver_row_not_names(self):
        relations={ref:{'kind':'signal-filter','anchor':{'ref':'RX','pad':pin},
            'return':{'ref':'RX','pad':'RETURN'},'supplyPad':'A','returnPad':'B','returnNet':'/return'}
            for ref,pin in [('Z','last'),('A','first'),('M','middle')]}
        # Long-package end pins must still use the actual row normal.
        points={('RX','first'):(-2,-10),('RX','middle'):(-2,0),('RX','last'):(-2,10),
                ('RX','RETURN'):(2,0),('RX','other'):(2,5)}
        banks=filter_row_banks(relations,points,{'RX':(0,0)})
        self.assertEqual(len(banks),1)
        self.assertEqual([m['ref'] for m in banks[0]['members']],['A','M','Z'])
        self.assertEqual((banks[0]['normalAxis'],banks[0]['outwardSign']),(0,-1))
        self.assertEqual(banks[0]['returnNet'],'/return')
        # Different return domains cannot be merged for visual neatness.
        relations['M']['returnNet']='/isolated-return'
        banks=filter_row_banks(relations,points,{'RX':(0,0)})
        self.assertEqual([m['ref'] for m in banks[0]['members']],['A','Z'])

    def test_unavailable_or_nonrow_physical_anchors_do_not_create_a_bank(self):
        relation=lambda pin:{'kind':'signal-filter','anchor':{'ref':'RX','pad':pin},
            'return':{'ref':'RX','pad':'G'},'supplyPad':'1','returnPad':'2','returnNet':'/g'}
        relations={'P':relation('p'),'Q':relation('q')}
        self.assertEqual(filter_row_banks(relations,{('RX','p'):(1,2)},{'RX':(0,0)}),[])
        self.assertEqual(filter_row_banks(relations,{('RX','p'):(1,2),('RX','q'):(2,3)},{'RX':(0,0)}),[])

if __name__=='__main__':unittest.main()
