import copy,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
sys.path[:0]=[str(Path(__file__).resolve().parents[1]/'python'),str(Path(__file__).resolve().parents[1]/'mcp')]
import pcb_flow
from record_io import write_json

class Tests(unittest.TestCase):
 def test_complete_incumbent_does_not_suppress_repair_of_joint_filter_candidate(self):
  with tempfile.TemporaryDirectory() as temporary:
   out=Path(temporary)/'a'/'b'/'c'/'out';out.mkdir(parents=True)
   request={'output':str(out),'plan':{'componentGapMm':.5,'activeLayers':['B.Cu']},'process':{}}
   filters={r:{'ref':r,'kind':'signal-filter','anchor':{'ref':'receiver','pad':pin},'return':{'ref':'receiver','pad':'g'},'returnNet':'/return'} for r,pin in [('filter-a','a'),('filter-b','b')]}
   built=[];repaired=[];selected=[]
   def build(candidate):
    kind=candidate.get('placementOptimization','greedy');built.append(kind);folder=Path(candidate['output']);(folder/'project').mkdir(exist_ok=True)
    joint=kind=='filter-banks'
    drc={'violations':0,'unconnected':2 if joint else 0,'parity':0,'errors':2 if joint else 0,'warnings':0,'passed':not joint}
    quality={'trackLengthMm':370 if joint else 442,'shortSegmentsUnder05mm':0 if joint else 3,'degree2Bends':55 if joint else 70}
    write_json(folder/'pcb-result.json',{'drc':drc,'routingQuality':quality})
    write_json(folder/'signal-filter-placement.json',filters)
    (folder/'project/drc.rpt').write_text('[unconnected_items]: missing [/control]\n** End **',encoding='utf8')
   def repair(candidate,result):
    repaired.append(candidate['placementOptimization']);result=copy.deepcopy(result)
    result['drc'].update({'unconnected':0,'errors':0,'passed':True})
    result['routingQuality'].update({'trackLengthMm':406,'degree2Bends':60})
    result['localRepair']={'adopted':True}
    return result
   def publish(request,best,*args,**kwargs):
    if not kwargs.get('checkpoint'):selected.append(best)
   with patch.object(pcb_flow,'build_candidate',build),patch.object(pcb_flow,'prior_candidates',return_value=[]),patch.object(pcb_flow,'repair_selected',repair),patch.object(pcb_flow,'publish_candidate',publish):
    pcb_flow.generate_with_refinement(request)
   self.assertEqual(built,['greedy','filter-banks','coupled-compaction'])
   self.assertEqual(repaired,['filter-banks'])
   self.assertEqual(selected[0][0]['placementOptimization'],'filter-banks')
   self.assertTrue(selected[0][1]['drc']['passed'])
   self.assertEqual(selected[0][1]['routingQuality']['trackLengthMm'],406)

 def test_unavailable_physical_bank_preserves_general_compaction(self):
  for bank_failure in [False,True]:
   with self.subTest(bank_failure=bank_failure),tempfile.TemporaryDirectory() as temporary:
    out=Path(temporary)/'a'/'b'/'c'/'out';out.mkdir(parents=True)
    request={'output':str(out),'plan':{'componentGapMm':.5,'activeLayers':['B.Cu']},'process':{}}
    filters={r:{'ref':r,'kind':'signal-filter','anchor':{'ref':'receiver','pad':pin},'return':{'ref':'receiver','pad':'g'},'returnNet':'/return'} for r,pin in [('filter-a','a'),('filter-b','b')]}
    built=[];selected=[]
    def build(candidate):
     kind=candidate.get('placementOptimization','greedy');built.append(kind);folder=Path(candidate['output']);(folder/'project').mkdir(exist_ok=True)
     if kind=='filter-banks' and bank_failure:raise ValueError('no legal joint placement')
     compact=kind=='coupled-compaction'
     result={'drc':{'violations':0,'unconnected':0,'parity':0,'errors':0,'warnings':0,'passed':True},'routingQuality':{'trackLengthMm':400 if compact else 442,'shortSegmentsUnder05mm':0,'degree2Bends':60}}
     write_json(folder/'pcb-result.json',result);write_json(folder/'signal-filter-placement.json',filters)
     write_json(folder/'filter-bank-placement.json',{'banks':[],'reason':'physical pads do not form a row'})
    def publish(request,best,*args,**kwargs):
     if not kwargs.get('checkpoint'):selected.append(best)
    with patch.object(pcb_flow,'build_candidate',build),patch.object(pcb_flow,'prior_candidates',return_value=[]),patch.object(pcb_flow,'publish_candidate',publish):
     pcb_flow.generate_with_refinement(request)
    self.assertEqual(built,['greedy','filter-banks','coupled-compaction'])
    self.assertEqual(selected[0][0]['placementOptimization'],'coupled-compaction')

if __name__=='__main__':unittest.main()
