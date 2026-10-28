import sys,unittest,copy,tempfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'python'))
from pcb_candidate_history import request_identity,prior_candidates,write
from pcb_local_repair import compatibility_identity
import pcbnew as p

def point(x,y):return p.VECTOR2I(p.FromMM(x),p.FromMM(y))
def fixture():
 b=p.BOARD();b.SetCopperLayerCount(2);n=p.NETINFO_ITEM(b,'SIGNAL_A');b.Add(n)
 f=p.FOOTPRINT(b);f.SetReference('Q7');f.SetValue('12k');b.Add(f)
 q=p.PAD(f);q.SetNumber('1');q.SetShape(p.PAD_SHAPE_RECT);q.SetSize(point(1,2));q.SetPosition(point(2,3));q.SetAttribute(p.PAD_ATTRIB_SMD);layers=p.LSET();layers.AddLayer(p.F_Cu);q.SetLayerSet(layers);q.SetNet(n);f.Add(q)
 for a,z in [((0,0),(20,0)),((20,0),(20,10)),((20,10),(0,10)),((0,10),(0,0))]:
  edge=p.PCB_SHAPE(b);edge.SetShape(p.SHAPE_T_SEGMENT);edge.SetStart(point(*a));edge.SetEnd(point(*z));edge.SetLayer(p.Edge_Cuts);b.Add(edge)
 return b,f,q

def request(output='current'):
 return {'source':'same-stage5','output':output,'schematic':'Circuit.kicad_sch','plan':{'activeLayers':['B.Cu'],'placements':{},'allowVias':False},'process':{'relations':[{'ref':'Q7','maxMm':10}]},'components':[{'ref':'Q7','value':'12k'},{'ref':'Q8','value':'1u'}],'footprintImports':[{'ref':'Q7','pads':[1]},{'ref':'Q8','pads':[1]}]}
class Tests(unittest.TestCase):
 def test_operational_paths_and_import_order_do_not_change_identity(self):
  a=request();b=copy.deepcopy(a);b['output']='another-run';b['cli']='other-kicad';b['footprintImports'].reverse();b['components'].reverse();self.assertEqual(request_identity(a),request_identity(b))
 def test_changed_inputs_or_constraints_disallow_reuse(self):
  a=request()
  for change in [lambda b:b.update(source='changed-stage5'),lambda b:b['components'][0].update(value='47k'),lambda b:b['plan'].update(placements={'Q7':{'xMm':2}}),lambda b:b['plan'].update(activeLayers=['F.Cu']),lambda b:b['process']['relations'][0].update(maxMm=5),lambda b:b['footprintImports'][0].update(pads=[2])]:
   b=copy.deepcopy(a);change(b);self.assertNotEqual(request_identity(a),request_identity(b))
 def test_only_matching_completed_sibling_candidates_are_found(self):
  with tempfile.TemporaryDirectory() as temp:
   base=Path(temp);current=request(str(base/'new'));(base/'new').mkdir()
   for name,passed,value in [('good',True,'12k'),('failed',False,'12k'),('changed',True,'47k')]:
    folder=base/name;(folder/'project').mkdir(parents=True);(folder/'project/Circuit.kicad_pcb').write_text('native check happens next')
    req=copy.deepcopy(current);req['output']=str(folder);req['components'][0]['value']=value;write(folder/'pcb-request.json',req);write(folder/'pcb-result.json',{'drc':{'passed':passed,'warnings':0}})
   self.assertEqual([row[0].name for row in prior_candidates(current)],['good'])
 def test_generated_pose_can_change_without_becoming_a_fixed_constraint(self):
  b,f,q=fixture();before=compatibility_identity(b);f.SetOrientationDegrees(90);f.SetPosition(point(11,7));self.assertEqual(before,compatibility_identity(b))
 def test_locked_or_explicit_poses_must_match(self):
  for locked in (True,False):
   b,f,q=fixture();f.SetLocked(locked);refs=() if locked else ('Q7',);before=compatibility_identity(b,refs);f.SetPosition(point(5,5));self.assertNotEqual(before,compatibility_identity(b,refs))
 def test_native_value_net_and_pad_geometry_must_match(self):
  for kind in ('value','net','pad','side'):
   b,f,q=fixture();before=compatibility_identity(b)
   if kind=='value':f.SetValue('47k')
   elif kind=='net':n=p.NETINFO_ITEM(b,'SIGNAL_B');b.Add(n);q.SetNet(n)
   elif kind=='pad':q.SetSize(point(2,2))
   else:f.Flip(point(0,0),False)
   self.assertNotEqual(before,compatibility_identity(b))
 def test_native_outline_must_match(self):
  b,f,q=fixture();before=compatibility_identity(b)
  for edge in b.GetDrawings():edge.Move(point(2,0))
  self.assertNotEqual(before,compatibility_identity(b))
 def test_complete_history_moves_search_to_bounded_quality_and_survives_failed_new_routes(self):
  from unittest.mock import patch
  import pcb_flow
  def result(passed):
   return {'drc':{'passed':passed,'violations':0,'unconnected':0 if passed else 1,'parity':0,'errors':0 if passed else 1,'warnings':0},'routingQuality':{'trackLengthMm':50 if passed else 20,'shortSegmentsUnder05mm':2 if passed else 0,'degree2Bends':10 if passed else 2},'process':{}}
  with tempfile.TemporaryDirectory() as temp:
   base=Path(temp);out=base/'steps/6/current';out.mkdir(parents=True);req=request(str(out));calls=[];checkpoint_at_followup=[]
   def populate(candidate,record):
    folder=Path(candidate['output']);(folder/'project').mkdir(parents=True,exist_ok=True);(folder/'project/drc.rpt').write_text('[unconnected_items]:\n  [SIGNAL_A]\n')
    for name in ['placement-result','placement-order','signal-filter-placement','copper-route-cleanup','jumper-routing-abstractions','jumper-routing-removal','process-result','copper-result']:write(folder/(name+'.json'),[] if name=='signal-filter-placement' else {})
    write(folder/'pcb-result.json',record)
   def build(candidate):
    if calls:checkpoint_at_followup.append((out/'pcb-result.json').exists() and pcb_flow.read(out/'pcb-result.json')['drc']['passed'])
    calls.append(candidate);populate(candidate,result(False))
   def prepare(request,fresh,previous,record,destination):
    candidate=copy.deepcopy(request);candidate['output']=str(destination);record=result(True);record['localRepair']={'adopted':True};populate(candidate,record);return (candidate,record),{'compatible':True,'accepted':True}
   with patch.object(pcb_flow,'build_candidate',side_effect=build),patch.object(pcb_flow,'prior_candidates',return_value=[(base/'prior',result(True))]),patch.object(pcb_flow,'prepare_candidate',side_effect=prepare),patch.object(pcb_flow,'repair_selected',side_effect=lambda req,result:result):
    pcb_flow.generate_with_refinement(req)
   final=pcb_flow.read(out/'pcb-result.json')
   self.assertTrue(final['drc']['passed']);self.assertEqual(final['selectedCandidateSource']['kind'],'revalidated-generated-history')
   self.assertEqual(len(calls),3);self.assertEqual(calls[1]['placementOptimization'],'coupled-compaction')
   self.assertEqual(final['routingQuality']['trackLengthMm'],50)
   self.assertTrue(all(checkpoint_at_followup),'complete board must be saved before another native candidate starts')
 def test_native_candidate_failure_is_reported_without_ending_orchestrator(self):
  import pcb_flow
  with tempfile.TemporaryDirectory() as temp:
   folder=Path(temp);req={'output':str(folder),'source':str(folder/'absent-source')}
   with self.assertRaisesRegex(RuntimeError,'原生布局候选进程退出'):
    pcb_flow.build_candidate(req)
   log=pcb_flow.read(folder/'candidate-process.json')
   self.assertNotEqual(log['exitCode'],0);self.assertFalse(log['timedOut'])
   self.assertIn('FileNotFoundError',log['stderr']);self.assertFalse((folder/'pcb-result.json').exists())
if __name__=='__main__':unittest.main()
