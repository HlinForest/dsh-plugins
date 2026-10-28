import unittest,sys,copy,math
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'python'))
from pcb_compaction import compact

def part(ref,x,y,side='B.Cu',fixed=False):
 return {'ref':ref,'fixed':fixed,'boundsMm':[x-1,y-1,x+1,y+1],'obstacles':[{'kind':'body','layer':side,'boxMm':[x-1,y-1,x+1,y+1]}]}
def example():
 return {'boardMm':[40,30],'clearanceMm':.254,'componentGapMm':.5,'parts':[part('SOURCE',5,5,fixed=True),part('LOAD',30,20),part('FILTER',25,20)],
 'nets':[{'name':'A','terminals':[{'ref':'SOURCE','atMm':[6,5]},{'ref':'FILTER','atMm':[24,20]}]}, {'name':'B','terminals':[{'ref':'FILTER','atMm':[26,20]},{'ref':'LOAD','atMm':[29,20]}]}],
 'relations':[{'ref':'FILTER','owner':'LOAD','padPairsMm':[[[26,20],[29,20]]],'maxDistanceMm':5}]}
class Tests(unittest.TestCase):
 def test_joint_cost_improves_without_moving_mechanical_datum(self):
  s=example();before=copy.deepcopy(s);r=compact(s)
  self.assertTrue(r['acceptedProxyImprovement'],r);self.assertLess(r['afterProxyCost'],r['beforeProxyCost'])
  self.assertEqual(r['translations']['SOURCE'],[0,0]);self.assertEqual(s,before)
  a=r['translations']['FILTER'];b=r['translations']['LOAD'];self.assertLessEqual(math.hypot(26+a[0]-29-b[0],a[1]-b[1]),5+1e-8)
  boxes=[(p['ref'],[p['boundsMm'][i]+r['translations'][p['ref']][i%2] for i in range(4)]) for p in s['parts']]
  for i,(an,a) in enumerate(boxes):
   for bn,b in boxes[i+1:]:self.assertTrue(a[2]+.5<=b[0] or b[2]+.5<=a[0] or a[3]+.5<=b[1] or b[3]+.5<=a[1],(an,bn,a,b))
 def test_opposite_side_body_can_overlap_but_through_pad_cannot(self):
  s=example();s['parts'][1]=part('LOAD',30,20,side='F.Cu');s['relations']=[]
  s['parts'][1]['obstacles'].append({'kind':'pad','layer':'B.Cu','boxMm':[29.5,19.5,30.5,20.5]})
  r=compact(s);self.assertTrue(r['acceptedProxyImprovement'],r)
  load=r['translations']['LOAD'];fil=r['translations']['FILTER'];a=[29.5+load[0],19.5+load[1],30.5+load[0],20.5+load[1]];b=[24+fil[0],19+fil[1],26+fil[0],21+fil[1]]
  self.assertTrue(a[2]+.3<=b[0] or b[2]+.3<=a[0] or a[3]+.3<=b[1] or b[3]+.3<=a[1])
 def test_infeasible_keeps_original_and_never_returns_unchecked_translations(self):
  s=example()
  for p in s['parts']:p['fixed']=True
  s['relations'][0]['maxDistanceMm']=1
  r=compact(s);self.assertEqual(r['translations'],{});self.assertEqual(r['status'],'INFEASIBLE')
 def test_existing_power_copper_cannot_be_occupied_by_a_moved_signal_pad(self):
  s=example();s['staticCopper']=[{'layer':'B.Cu','net':'POWER','boxMm':[7,3,11,7]}]
  s['parts'][2]['copperPads']=[{'layer':'B.Cu','net':'A','boxMm':[24,19,26,21]}]
  r=compact(s);self.assertTrue(r.get('acceptedProxyImprovement'),r);self.assertEqual(r['translations']['SOURCE'],[0,0])
  dx,dy=r['translations']['FILTER'];a=[24+dx,19+dy,26+dx,21+dy];b=[7,3,11,7];gap=.254
  self.assertTrue(a[2]+gap<=b[0] or b[2]+gap<=a[0] or a[3]+gap<=b[1] or b[3]+gap<=a[1],(a,b))
 def test_permutation_does_not_change_the_physical_solution(self):
  s=example();a=compact(s);s['parts'].reverse();s['nets'].reverse();b=compact(s);self.assertEqual(a['translations'],b['translations'])
if __name__=='__main__':unittest.main()
