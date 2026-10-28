import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'python'))
import pcbnew as p
from pcb_route_cleanup import merge_collinear_tracks,route_metrics
from pcb_trace_simplification import polygon,union,contained
def point(x,y):return p.VECTOR2I(p.FromMM(x),p.FromMM(y))
def fixture():
 b=p.BOARD();b.SetCopperLayerCount(2);n=p.NETINFO_ITEM(b,'SIGNAL');b.Add(n)
 return b,n
def track(b,n,a,z,width=.3):
 t=p.PCB_TRACK(b);t.SetNet(n);t.SetLayer(p.B_Cu);t.SetWidth(p.FromMM(width));t.SetStart(point(*a));t.SetEnd(point(*z));b.Add(t);return t
class Tests(unittest.TestCase):
 def test_exact_union_is_unchanged_while_short_fragments_disappear(self):
  b,n=fixture();track(b,n,(2,3),(2.1,3));track(b,n,(2.1,3),(2.2,3));track(b,n,(2.2,3),(8,3))
  before=union(polygon(t,p.B_Cu) for t in b.GetTracks());quality=route_metrics(b);r=merge_collinear_tracks(b)
  after=union(polygon(t,p.B_Cu) for t in b.GetTracks())
  self.assertTrue(contained(before,after));self.assertTrue(contained(after,before));self.assertEqual(r['mergedJoints'],2)
  self.assertEqual(route_metrics(b)['trackLengthMm'],quality['trackLengthMm']);self.assertEqual(route_metrics(b)['shortSegmentsUnder05mm'],0)
 def test_lock_and_width_change_are_preserved(self):
  for kind in ('locked','width'):
   b,n=fixture();a=track(b,n,(2,3),(4,3));track(b,n,(4,3),(8,3),.4 if kind=='width' else .3)
   if kind=='locked':a.SetLocked(True)
   self.assertEqual(merge_collinear_tracks(b)['mergedJoints'],0)
 def test_branch_contact_and_copper_union_survive_trunk_merge(self):
  b,n=fixture();track(b,n,(2,3),(4,3));track(b,n,(4,3),(4.01,3));branch=track(b,n,(4,3),(4,5));branch_id=branch.m_Uuid.AsString()
  before=union(polygon(t,p.B_Cu) for t in b.GetTracks());r=merge_collinear_tracks(b)
  after=union(polygon(t,p.B_Cu) for t in b.GetTracks())
  self.assertEqual(r['mergedJoints'],1);self.assertEqual(route_metrics(b)['shortSegmentsUnder05mm'],0)
  self.assertTrue(contained(before,after));self.assertTrue(contained(after,before))
  self.assertEqual(branch.m_Uuid.AsString(),branch_id)
  b.BuildConnectivity();self.assertEqual(len(list(b.GetConnectivity().GetConnectedTracks(branch))),1)
 def test_a_bend_or_backtracking_overlap_is_not_collinear_continuation(self):
  for last in ((8,3.001),(3,3)):
   b,n=fixture();track(b,n,(2,3),(4,3));track(b,n,(4,3),last)
   self.assertEqual(merge_collinear_tracks(b)['mergedJoints'],0)
if __name__=='__main__':unittest.main()
