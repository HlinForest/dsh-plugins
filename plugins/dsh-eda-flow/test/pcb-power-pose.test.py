import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'python'))
import pcbnew as p
from pcb_power_pose import PowerPoseScore
def v(x,y):return p.VECTOR2I(p.FromMM(x),p.FromMM(y))
def fixture():
 b=p.BOARD();b.SetCopperLayerCount(2)
 for a,z in [((0,0),(30,0)),((30,0),(30,25)),((30,25),(0,25)),((0,25),(0,0))]:
  e=p.PCB_SHAPE();e.SetShape(p.SHAPE_T_SEGMENT);e.SetLayer(p.Edge_Cuts);e.SetStart(v(*a));e.SetEnd(v(*z));e.SetWidth(p.FromMM(.05));b.Add(e)
 for name in ['P','G','X']:b.Add(p.NETINFO_ITEM(b,name))
 fps={}
 for ref,pos,rows in [('OWNER',(20,12),[('p',(20,9),'P',(.8,1)),('g',(20,15),'G',(.8,1))]),('CAP',(0,0),[('1',(-.6,0),'P',(.7,.7)),('2',(.6,0),'G',(.7,.7))]),('OBSTACLE',(16,12),[('1',(16,12),'X',(1,12))])]:
  fp=p.FOOTPRINT(b);fp.SetReference(ref);fp.SetPosition(v(*pos));b.Add(fp);fps[ref]=fp
  for pin,at,net,size in rows:
   q=p.PAD(fp);q.SetNumber(pin);q.SetAttribute(p.PAD_ATTRIB_SMD);q.SetShape(p.PAD_SHAPE_RECT);q.SetSize(v(*size));q.SetPosition(v(*at));layers=p.LSET();layers.AddLayer(p.B_Cu);q.SetLayerSet(layers);q.SetNet(b.FindNet(net));fp.Add(q)
 relation={'ref':'CAP','kind':'decoupling','anchor':{'ref':'OWNER','pad':'p'},'return':{'ref':'OWNER','pad':'g'},'supplyPad':'1','returnPad':'2'}
 plan={'activeLayers':['B.Cu'],'trackWidthMm':.3,'clearanceMm':.254}
 def move(ref,x,y,angle,side):fps[ref].SetOrientationDegrees(angle);fps[ref].SetPosition(v(x,y));return fps[ref]
 return b,fps,relation,plan,move
class Tests(unittest.TestCase):
 def test_actual_obstacle_path_can_override_a_cheaper_airwire_candidate_without_leaving_copper(self):
  b,fps,rel,plan,move=fixture();parts={f.GetReference():[(q.GetPosition().x,q.GetPosition().y,q.GetNetname()) for q in f.Pads()] for f in b.GetFootprints() if f.GetReference()!='CAP'}
  s=PowerPoseScore(b,{'relations':[rel]},plan,fps);out=s.score('CAP',[(0,12,12,0),(100,24,12,0)],rel,move,'B.Cu')
  self.assertEqual(min(out)[1],24);self.assertEqual(len(list(b.GetTracks())),0)
  self.assertEqual(parts,{f.GetReference():[(q.GetPosition().x,q.GetPosition().y,q.GetNetname()) for q in f.Pads()] for f in b.GetFootprints() if f.GetReference()!='CAP'})
  self.assertTrue(all(c['bothPathsFound'] for c in s.reports[0]['candidates']))
 def test_does_not_apply_single_layer_proxy_to_multilayer_design(self):
  b,fps,rel,plan,move=fixture();plan['activeLayers']=['F.Cu','B.Cu'];choices=[(0,12,12,0)]
  s=PowerPoseScore(b,{'relations':[rel]},plan,fps);self.assertEqual(s.score('CAP',choices,rel,move,'B.Cu'),choices);self.assertEqual(s.reports,[])
 def test_probe_exception_removes_temporary_tracks(self):
  from unittest.mock import patch
  import pcb_power_pose as module
  b,fps,rel,plan,move=fixture()
  def fail(board,*args):
   t=p.PCB_TRACK(board);t.SetStart(v(2,2));t.SetEnd(v(3,2));t.SetWidth(p.FromMM(.3));t.SetLayer(p.B_Cu);t.SetNet(b.FindNet('P'));board.Add(t)
   raise RuntimeError('native probe interrupted')
  with patch.object(module,'reserve_power_routes',fail):
   with self.assertRaises(RuntimeError):PowerPoseScore(b,{},plan,fps).score('CAP',[(0,24,12,0)],rel,move,'B.Cu')
  self.assertEqual(len(list(b.GetTracks())),0)
 def test_release_only_generated_locks_after_routing(self):
  from pcb_power_corridors import PowerCorridors
  b,fps,rel,plan,move=fixture();move('CAP',24,12,0,'B.Cu')
  unrelated=p.PCB_TRACK(b);unrelated.SetStart(v(2,2));unrelated.SetEnd(v(3,2));unrelated.SetWidth(p.FromMM(.3));unrelated.SetLayer(p.B_Cu);unrelated.SetNet(b.FindNet('X'));unrelated.SetLocked(True);b.Add(unrelated)
  c=PowerCorridors(b,{'relations':[rel]},plan);c.placed('CAP',{'OWNER':(20,12),'CAP':(24,12)})
  result=c.release_generated_locks()
  self.assertGreater(result['reservedSegments'],0);self.assertEqual(result['releasedGeneratedLocks'],result['reservedSegments'])
  self.assertEqual([t.m_Uuid.AsString() for t in b.GetTracks() if t.IsLocked()],[unrelated.m_Uuid.AsString()])
if __name__=='__main__':unittest.main()
