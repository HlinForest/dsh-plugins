import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'python'))
import pcbnew as p
from pcb_trace_simplification import shorten_tracks
from pcb_route_cleanup import route_metrics
def point(x,y):return p.VECTOR2I(p.FromMM(x),p.FromMM(y))
def fixture(points=((5,5),(5,9),(8,12),(12,12))):
 b=p.BOARD();b.SetCopperLayerCount(2)
 for a,c in [((0,0),(25,0)),((25,0),(25,25)),((25,25),(0,25)),((0,25),(0,0))]:
  e=p.PCB_SHAPE();e.SetShape(p.SHAPE_T_SEGMENT);e.SetLayer(p.Edge_Cuts);e.SetStart(point(*a));e.SetEnd(point(*c));e.SetWidth(p.FromMM(.05));b.Add(e)
 n=p.NETINFO_ITEM(b,'UNRELATED_SIGNAL');b.Add(n)
 for a,c in zip(points,points[1:]):track(b,n,a,c)
 return b,n
def track(b,n,a,c):
 t=p.PCB_TRACK(b);t.SetNet(n);t.SetLayer(p.F_Cu);t.SetWidth(p.FromMM(.3));t.SetStart(point(*a));t.SetEnd(point(*c));b.Add(t);return t
def pad(b,n,at):
 f=p.FOOTPRINT(b);f.SetReference('P');b.Add(f);q=p.PAD(f);q.SetNumber('1');q.SetAttribute(p.PAD_ATTRIB_SMD);q.SetShape(p.PAD_SHAPE_RECT);q.SetSize(point(1,1));q.SetPosition(point(*at));mask=p.LSET();mask.AddLayer(p.F_Cu);q.SetLayerSet(mask);q.SetNet(n);f.Add(q);return q
class Tests(unittest.TestCase):
 def test_free_detour_shortens_with_same_endpoints_and_width(self):
  b,n=fixture();before=route_metrics(b);r=shorten_tracks(b,.254,.5);after=route_metrics(b)
  self.assertGreater(r['savedLengthMm'],2);self.assertLess(after['degree2Bends'],before['degree2Bends'])
  self.assertEqual(after['shortSegmentsUnder05mm'],0)
  self.assertEqual({(t.GetWidth(),t.GetNetname(),t.GetLayer()) for t in b.GetTracks()},{(p.FromMM(.3),'UNRELATED_SIGNAL',p.F_Cu)})
 def test_foreign_pad_blocks_shortcut(self):
  b,n=fixture();other=p.NETINFO_ITEM(b,'FOREIGN');b.Add(other);pad(b,other,(8.5,8.5))
  self.assertEqual(shorten_tracks(b,.254,.5)['changes'],[])
 def test_same_net_pad_contact_cannot_be_lost(self):
  b,n=fixture();pad(b,n,(5,9))
  self.assertEqual(shorten_tracks(b,.254,.5)['changes'],[])
 def test_branch_and_locked_tracks_are_preserved(self):
  b,n=fixture();track(b,n,(5,9),(2,9));self.assertEqual(shorten_tracks(b,.254,.5)['changes'],[])
  b,n=fixture();next(iter(b.GetTracks())).SetLocked(True)
  self.assertEqual(shorten_tracks(b,.254,.5)['changes'],[])
 def test_shortening_cannot_introduce_short_fragment(self):
  b,n=fixture(((2,2),(2,8.2),(8,8.2)))
  self.assertEqual(shorten_tracks(b,.254,.5)['changes'],[])
 def test_board_cutout_blocks_shortcut(self):
  b,n=fixture()
  for a,c in [((7.5,7.5),(9.5,7.5)),((9.5,7.5),(9.5,9.5)),((9.5,9.5),(7.5,9.5)),((7.5,9.5),(7.5,7.5))]:
   e=p.PCB_SHAPE();e.SetShape(p.SHAPE_T_SEGMENT);e.SetLayer(p.Edge_Cuts);e.SetStart(point(*a));e.SetEnd(point(*c));e.SetWidth(p.FromMM(.05));b.Add(e)
  self.assertEqual(shorten_tracks(b,.254,.5)['changes'],[])
 def test_track_keepout_blocks_shortcut(self):
  b,n=fixture();zone=p.ZONE(b);zone.SetLayer(p.F_Cu);zone.SetIsRuleArea(True);zone.SetDoNotAllowTracks(True)
  outline=zone.Outline();outline.NewOutline()
  for x,y in [(7.5,7.5),(9.5,7.5),(9.5,9.5),(7.5,9.5)]:outline.Append(p.FromMM(x),p.FromMM(y))
  b.Add(zone)
  self.assertEqual(shorten_tracks(b,.254,.5)['changes'],[])
 def test_same_net_via_contact_cannot_be_lost(self):
  b,n=fixture();via=p.PCB_VIA(b);via.SetNet(n);via.SetPosition(point(5,9));via.SetWidth(p.FromMM(.6));via.SetDrill(p.FromMM(.3));b.Add(via)
  self.assertEqual(shorten_tracks(b,.254,.5)['changes'],[])
if __name__=='__main__':unittest.main()
