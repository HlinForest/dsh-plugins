"""A receiver filter must be able to leave the wrong side of its owner."""
import sys,unittest,copy,math
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'python'))
from pcb_compaction import compact

def scenario():
    return {'boardMm':[36,32], 'componentGapMm':.5,'clearanceMm':.254,
        'parts':[{'ref':'RECEIVER','fixed':True,'boundsMm':[10,10,22,20], 'obstacles':[{'kind':'body','layer':'B.Cu','boxMm':[10,10,22,20]}]},
                 {'ref':'FILTER','boundsMm':[15,5,17,7], 'obstacles':[{'kind':'body','layer':'B.Cu','boxMm':[15,5,17,7]}]}],
        'nets':[{'name':'/receiver/input','terminals':[{'ref':'RECEIVER','atMm':[16,20]},{'ref':'FILTER','atMm':[16,7]}]}],
        'relations':[{'ref':'FILTER','owner':'RECEIVER','padPairsMm':[[[16,7],[16,20]]],'weight':20}],
        'reorderParts':['FILTER']}

class Tests(unittest.TestCase):
    def test_filter_can_cross_owner_separation_order(self):
        s=scenario();original=copy.deepcopy(s);r=compact(s)
        self.assertTrue(r.get('acceptedProxyImprovement'),r)
        dx,dy=r['translations']['FILTER']
        self.assertGreaterEqual(5+dy,20.5,'still trapped on the wrong side of receiver')
        self.assertLess(math.hypot(dx,7+dy-20),3)
        self.assertEqual(r['translations']['RECEIVER'],[0,0]);self.assertEqual(s,original)
    def test_reordering_never_overrides_hard_power_distance(self):
        s=scenario();s['relations'][0]['maxDistanceMm']=3.0;r=compact(s)
        self.assertTrue(r['translations'],r)
        dx,dy=r['translations']['FILTER'];self.assertLessEqual(math.hypot(dx,7+dy-20),3.0000001)
    def test_default_keeps_order_and_unknown_reference_is_rejected(self):
        s=scenario();s.pop('reorderParts');r=compact(s)
        self.assertLess(7+r['translations'].get('FILTER',[0,0])[1],10)
        s['reorderParts']=['MISSING']
        with self.assertRaises(ValueError):compact(s)
    def test_permutation_and_hierarchical_net_names(self):
        s=scenario();s['priorityNets']=['/receiver/input'];a=compact(s)
        s['parts'].reverse();b=compact(s);self.assertEqual(a['translations'],b['translations'])
        s['priorityNets']=['receiver/input'];c=compact(s)
        self.assertLess(c['beforeProxyCost'],a['beforeProxyCost'])
if __name__=='__main__':unittest.main()
