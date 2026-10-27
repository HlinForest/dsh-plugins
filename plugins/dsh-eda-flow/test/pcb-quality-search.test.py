"""Search orchestration regression; real-board acceptance is a separate run."""
import copy,sys,tempfile,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'python'))
import pcb_flow as flow
from unittest.mock import patch
class Tests(unittest.TestCase):
 def exercise(self,second):
  with tempfile.TemporaryDirectory() as temp:
   out=Path(temp)/'runs/a/result';out.mkdir(parents=True)
   req={'output':str(out),'plan':{'componentGapMm':.5},'process':{'relations':[{}]}}
   original=copy.deepcopy(req);calls=[]
   def build(candidate):
    calls.append(copy.deepcopy(candidate));dest=Path(candidate['output'])
    if len(calls)==2 and second=='exception':raise RuntimeError('solver unavailable')
    failed=len(calls)==2 and second in ('disconnected','recover')
    length=400 if len(calls)>=2 else 500
    result={'drc':{'passed':not failed,'errors':int(failed),'warnings':0,'unconnected':int(failed),'parity':0},
     'routingQuality':{'trackLengthMm':length,'shortSegmentsUnder05mm':1,'degree2Bends':80 if len(calls)>=2 else 90}}
    (dest/'project').mkdir();(dest/'project/selected.txt').write_text(str(len(calls)))
    (dest/'project/drc.rpt').write_text('[unconnected_items]: Missing connection\n    Pad [ARBITRARY_SIGNAL]\n' if failed and second=='recover' else '')
    flow.write(dest/'pcb-result.json',result)
    for name in ['placement-result.json','placement-order.json','signal-filter-placement.json','copper-route-cleanup.json','jumper-routing-abstractions.json','jumper-routing-removal.json','process-result.json','copper-result.json']:flow.write(dest/name,{})
   with patch.object(flow,'build',build):flow.generate_with_refinement(req)
   result=flow.read(out/'pcb-result.json')
   self.assertEqual(req,original)
   self.assertEqual(len(calls),3 if second=='recover' else 2)
   if second=='recover':self.assertEqual(calls[2]['optimizationFeedback']['nets'],['ARBITRARY_SIGNAL'])
   self.assertEqual(calls[1]['placementOptimization'],'coupled-compaction')
   self.assertEqual(result['drc']['passed'],True)
   self.assertEqual((out/'project/selected.txt').read_text(),'3' if second=='recover' else '2' if second=='better' else '1')
   self.assertEqual(len(result['layoutAttempts']),len(calls))
 def test_failed_net_is_fed_back_without_changing_topology(self):self.exercise('recover')
 def test_completed_candidate_kept_on_disconnection(self):self.exercise('disconnected')
 def test_completed_candidate_kept_on_solver_failure(self):self.exercise('exception')
 def test_actual_better_complete_candidate_selected(self):self.exercise('better')
 def test_unconnected_branch_triggers_joint_related_placement(self):
  with tempfile.TemporaryDirectory() as temp:
   out=Path(temp)/'runs/a/result';out.mkdir(parents=True)
   req={'output':str(out),'plan':{'componentGapMm':.5},'process':{'relations':[{}]}};original=copy.deepcopy(req);calls=[]
   def build(candidate):
    calls.append(copy.deepcopy(candidate));dest=Path(candidate['output']);(dest/'project').mkdir()
    repaired=candidate.get('placementOptimization')=='coupled-critical'
    result={'drc':{'passed':repaired,'errors':int(not repaired),'warnings':0,'unconnected':int(not repaired),'parity':0},
            'routingQuality':{'trackLengthMm':410,'shortSegmentsUnder05mm':1,'degree2Bends':70}}
    (dest/'project/drc.rpt').write_text('' if repaired else '[unconnected_items]: Missing connection\n    Pad [/receiver/input]\n')
    flow.write(dest/'pcb-result.json',result)
    for name in ['placement-result.json','placement-order.json','signal-filter-placement.json','copper-route-cleanup.json','jumper-routing-abstractions.json','jumper-routing-removal.json','process-result.json','copper-result.json']:flow.write(dest/name,{})
   with patch.object(flow,'build',build):flow.generate_with_refinement(req)
   self.assertEqual(req,original);self.assertEqual(len(calls),2)
   self.assertEqual(calls[1]['placementOptimization'],'coupled-critical')
   self.assertEqual(calls[1]['optimizationFeedback']['nets'],['/receiver/input'])
   self.assertEqual(calls[1]['plan'],calls[0]['plan'])
   self.assertTrue(flow.read(out/'pcb-result.json')['drc']['passed'])
if __name__=='__main__':unittest.main()
