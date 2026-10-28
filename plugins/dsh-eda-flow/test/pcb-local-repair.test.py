import sys,unittest,copy
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'python'))
import pcbnew as p
from pcb_local_repair import copper_networks,eligible_filters

def point(x,y):return p.VECTOR2I(p.FromMM(x),p.FromMM(y))
def fixture():
 b=p.BOARD();b.SetCopperLayerCount(2);n=p.NETINFO_ITEM(b,'ARBITRARY_RETURN');b.Add(n)
 for ref,x in [('A',2),('B',8)]:
  f=p.FOOTPRINT(b);f.SetReference(ref);b.Add(f);q=p.PAD(f);q.SetNumber('1');q.SetShape(p.PAD_SHAPE_RECT);q.SetSize(point(1,1));q.SetPosition(point(x,3));q.SetAttribute(p.PAD_ATTRIB_SMD);layers=p.LSET();layers.AddLayer(p.B_Cu);q.SetLayerSet(layers);q.SetNet(n);f.Add(q)
 return b,n

class Tests(unittest.TestCase):
 def test_same_net_and_zone_outline_do_not_prove_connectivity(self):
  b,n=fixture();z=p.ZONE(b);z.SetLayer(p.B_Cu);z.SetNet(n);poly=z.Outline();poly.NewOutline()
  for x,y in [(0,0),(12,0),(12,8),(0,8)]:poly.Append(p.FromMM(x),p.FromMM(y))
  b.Add(z);audit=copper_networks(b,p.B_Cu)
  self.assertFalse(audit['allPhysicalPadNetworksConnected']);self.assertEqual(len(audit['networks'][0]['connectedPadGroups']),2)
 def test_actual_track_unites_physical_pad_islands(self):
  b,n=fixture();t=p.PCB_TRACK(b);t.SetStart(point(2,3));t.SetEnd(point(8,3));t.SetWidth(p.FromMM(.3));t.SetLayer(p.B_Cu);t.SetNet(n);b.Add(t)
  self.assertTrue(copper_networks(b,p.B_Cu)['allPhysicalPadNetworksConnected'])
  t.SetNetCode(0);self.assertFalse(copper_networks(b,p.B_Cu)['allPhysicalPadNetworksConnected'])
 def test_filters_require_declared_role_and_cannot_move_fixed_or_power_parts(self):
  audit={'networks':[{'allPhysicalPadsConnected':False,'connectedPadGroups':[{'members':[{'ref':'X'}]},{'members':[{'ref':'Y'},{'ref':'Z'}]}]}]}
  req={'components':[{'ref':'X','electricalRole':'interface-filter'}],'plan':{},'process':{}}
  self.assertEqual(eligible_filters(req,audit),['X'])
  req['plan']['placements']={'X':{}};self.assertEqual(eligible_filters(req,audit),[])
  req['plan']={};req['process']['relations']=[{'ref':'X'}];self.assertEqual(eligible_filters(req,audit),[])
  req['process']={};req['components'][0]['electricalRole']='storage';self.assertEqual(eligible_filters(req,audit),[])

if __name__=='__main__':unittest.main()
