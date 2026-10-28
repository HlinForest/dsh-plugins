import sys,unittest,copy
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'python'))
import pcbnew as p
from pcb_power_routes import reserve_power_routes
from pcb_power_corridors import PowerCorridors
from pcb_trace_simplification import polygon,union,intersects

def point(x,y):return p.VECTOR2I(p.FromMM(x),p.FromMM(y))
def fixture():
 b=p.BOARD();b.SetCopperLayerCount(2)
 for a,c in [((0,0),(30,0)),((30,0),(30,25)),((30,25),(0,25)),((0,25),(0,0))]:
  e=p.PCB_SHAPE();e.SetShape(p.SHAPE_T_SEGMENT);e.SetLayer(p.Edge_Cuts);e.SetStart(point(*a));e.SetEnd(point(*c));e.SetWidth(p.FromMM(.05));b.Add(e)
 for name in ['POWER','RETURN','OTHER']:
  n=p.NETINFO_ITEM(b,name);b.Add(n)
 pads={}
 for ref,pin,at,net in [('FILTER','1',(5,6),'POWER'),('FILTER','2',(5,9),'RETURN'),('RECEIVER','p',(23,6),'POWER'),('RECEIVER','g',(23,9),'RETURN'),('BLOCK','1',(14,9),'OTHER')]:
  f=next((x for x in b.GetFootprints() if x.GetReference()==ref),None)
  if f is None:f=p.FOOTPRINT(b);f.SetReference(ref);b.Add(f)
  q=p.PAD(f);q.SetNumber(pin);q.SetAttribute(p.PAD_ATTRIB_SMD);q.SetShape(p.PAD_SHAPE_RECT);q.SetSize(point(2,4) if ref=='BLOCK' else point(1,1));q.SetPosition(point(*at));mask=p.LSET();mask.AddLayer(p.B_Cu);q.SetLayerSet(mask);q.SetNet(b.FindNet(net));f.Add(q);pads[(ref,pin)]=q
 policy={'relations':[{'ref':'FILTER','kind':'decoupling','anchor':{'ref':'RECEIVER','pad':'p'},'return':{'ref':'RECEIVER','pad':'g'},'supplyPad':'1','returnPad':'2'}]}
 plan={'activeLayers':['B.Cu'],'trackWidthMm':.3,'clearanceMm':.254}
 return b,pads,policy,plan
class Tests(unittest.TestCase):
 def test_filter_row_can_reserve_signal_stub_without_inventing_a_return_wire(self):
  b,pads,policy,plan=fixture()
  policy['relations'][0].update({'kind':'signal-filter','routeRoles':['anchor']})
  corridors=PowerCorridors(b,policy,plan)
  corridors.placed('FILTER',{'FILTER':None,'RECEIVER':None})
  self.assertEqual([r['role'] for r in corridors.reports[0]['routes']],['anchor'])
  self.assertTrue(corridors.reports[0]['routes'][0]['adopted'])
  self.assertEqual({t.GetNetname() for t in b.GetTracks()},{'POWER'})
  self.assertTrue(all(t.IsLocked() for t in b.GetTracks()))
  corridors.release_generated_locks()
  self.assertTrue(all(not t.IsLocked() for t in b.GetTracks()))

 def test_routes_both_halves_around_real_foreign_copper_without_moving_pads(self):
  b,pads,policy,plan=fixture();before={key:(q.GetPosition().x,q.GetPosition().y,q.GetNetname()) for key,q in pads.items()}
  r=reserve_power_routes(b,policy,plan)
  self.assertTrue(all(x['adopted'] for x in r['routes']))
  ground=next(x for x in r['routes'] if x['role']=='return');self.assertLess(ground['newLengthMm'],25);self.assertGreater(ground['newLengthMm'],18)
  self.assertEqual(before,{key:(q.GetPosition().x,q.GetPosition().y,q.GetNetname()) for key,q in pads.items()})
  for track in b.GetTracks():
   self.assertTrue(track.IsLocked());self.assertEqual(track.GetLayer(),p.B_Cu);self.assertEqual(track.GetWidth(),p.FromMM(.3))
   foreign=union(polygon(q,p.B_Cu,p.FromMM(.254)) for q in pads.values() if q.GetNetCode()!=track.GetNetCode())
   self.assertFalse(intersects(polygon(track,p.B_Cu),foreign))
  b.BuildConnectivity();con=b.GetConnectivity()
  for pin,owner in [('1','p'),('2','g')]:
   pending=[pads[('FILTER',pin)]];seen=set()
   while pending:
    item=pending.pop();uid=item.m_Uuid.AsString()
    if uid in seen:continue
    seen.add(uid);pending.extend(con.GetConnectedTracks(item));pending.extend(con.GetConnectedPads(item))
   self.assertIn(pads[('RECEIVER',owner)].m_Uuid.AsString(),seen)
 def test_refuses_new_connections_across_distinct_nets(self):
  b,pads,policy,plan=fixture();pads[('RECEIVER','g')].SetNet(b.FindNet('OTHER'))
  with self.assertRaisesRegex(ValueError,'nets differ'):reserve_power_routes(b,policy,plan)
  self.assertEqual(len(list(b.GetTracks())),0)
 def test_never_invents_relations_or_an_active_layer(self):
  b,pads,policy,plan=fixture()
  self.assertEqual(reserve_power_routes(b,{},plan)['routes'],[])
  plan['activeLayers']=['F.Cu','B.Cu'];self.assertEqual(reserve_power_routes(b,policy,plan)['routes'],[])
  self.assertEqual(len(list(b.GetTracks())),0)
 def test_track_keepout_is_preserved(self):
  b,pads,policy,plan=fixture();z=p.ZONE(b);z.SetLayer(p.B_Cu);z.SetIsRuleArea(True);z.SetDoNotAllowTracks(True);poly=z.Outline();poly.NewOutline()
  for x,y in [(10,3),(18,3),(18,14),(10,14)]:poly.Append(p.FromMM(x),p.FromMM(y))
  b.Add(z);r=reserve_power_routes(b,policy,plan)
  self.assertTrue(all(row['adopted'] for row in r['routes']))
  for track in b.GetTracks():self.assertFalse(intersects(polygon(track,p.B_Cu),poly))
 def test_unreachable_route_reports_failure_not_already_connected(self):
  b,pads,policy,plan=fixture()
  pads[('BLOCK','1')].SetSize(point(2,30));pads[('BLOCK','1')].SetPosition(point(14,12))
  policy['routeRoles']=['anchor']
  r=reserve_power_routes(b,policy,plan);row=r['routes'][0]
  self.assertFalse(row['adopted']);self.assertEqual(len(list(b.GetTracks())),0)
  self.assertNotEqual(row['search'],'already connected')
  self.assertIn(row['search'],['no path within bounded search','terminal cannot reach routing lattice'])
 def test_compares_actual_routes_to_existing_tree_instead_of_first_reachable_target(self):
  b,pads,policy,plan=fixture();policy['routeRoles']=['anchor']
  pads[('BLOCK','1')].SetPosition(point(8,6));pads[('BLOCK','1')].SetSize(point(2,10))
  for a,z in [((23,6),(10,6)),((10,6),(10,15))]:
   t=p.PCB_TRACK(b);t.SetStart(point(*a));t.SetEnd(point(*z));t.SetWidth(p.FromMM(.3));t.SetLayer(p.B_Cu);t.SetNet(b.FindNet('POWER'));b.Add(t)
  r=reserve_power_routes(b,policy,plan);row=r['routes'][0]
  self.assertTrue(row['adopted']);self.assertTrue(row['joinsExistingTree'])
  self.assertEqual(row['pathMm'][-1],[10.0,15.0])
 def test_explicit_physical_pad_cannot_silently_select_a_nearer_duplicate(self):
  b,pads,policy,plan=fixture();policy['routeRoles']=['anchor'];policy['joinExistingTree']=False
  original=pads[('RECEIVER','p')];duplicate=p.PAD(original.GetParentFootprint());duplicate.SetNumber('p');duplicate.SetAttribute(p.PAD_ATTRIB_SMD);duplicate.SetShape(p.PAD_SHAPE_RECT);duplicate.SetSize(point(1,1));duplicate.SetPosition(point(9,6));duplicate.SetLayerSet(original.GetLayerSet());duplicate.SetNet(original.GetNet());original.GetParentFootprint().Add(duplicate)
  policy['relations'][0]['anchor']['_physicalUuid']=original.m_Uuid.AsString()
  row=reserve_power_routes(b,policy,plan)['routes'][0]
  self.assertTrue(row['adopted']);self.assertEqual(row['pathMm'][-1],[23,6])
if __name__=='__main__':unittest.main()
