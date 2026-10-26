import unittest,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'python'))
import pcbnew as p
from pcb_route_cleanup import remove_filled_tracks,trace_polygon,covered,filled_copper
from pcb_process import add_copper

class Tests(unittest.TestCase):
    def test_removes_only_whole_same_net_copper_covered_by_actual_fill(self):
        b=p.BOARD();net=p.NETINFO_ITEM(b,'/plane');b.Add(net)
        other=p.NETINFO_ITEM(b,'/other');b.Add(other)
        point=lambda x,y:p.VECTOR2I(p.FromMM(x),p.FromMM(y))
        for a,c in [((0,0),(30,0)),((30,0),(30,20)),((30,20),(0,20)),((0,20),(0,0))]:
            e=p.PCB_SHAPE();e.SetShape(p.SHAPE_T_SEGMENT);e.SetLayer(p.Edge_Cuts);e.SetStart(point(*a));e.SetEnd(point(*c));e.SetWidth(p.FromMM(.05));b.Add(e)
        for i,x in enumerate([5,20]):
            f=p.FOOTPRINT(b);f.SetReference('PORT_'+str(i));b.Add(f)
            pad=p.PAD(f);pad.SetNumber('1');pad.SetAttribute(p.PAD_ATTRIB_SMD);pad.SetShape(p.PAD_SHAPE_RECT);pad.SetSize(point(2,2));pad.SetPosition(point(x,10));layers=p.LSET();layers.AddLayer(p.B_Cu);pad.SetLayerSet(layers);pad.SetNet(net);f.Add(pad)
        def track(a,c,n,locked=False):
            t=p.PCB_TRACK(b);t.SetStart(point(*a));t.SetEnd(point(*c));t.SetWidth(p.FromMM(.3));t.SetLayer(p.B_Cu);t.SetNet(n);t.SetLocked(locked);b.Add(t);return t
        redundant=track((5,10),(20,10),net);locked=track((5,11),(20,11),net,True);signal=track((5,15),(20,15),other)
        add_copper(b,{'copperNets':[{'name':'/plane','kind':'return'}]},{'widthMm':30,'heightMm':20,'clearanceMm':.254,'trackWidthMm':.3,'activeLayers':['B.Cu']})
        before=trace_polygon(redundant);r=remove_filled_tracks(b)
        self.assertEqual(r['removedSegments'],1);self.assertEqual(len(list(b.GetTracks())),2)
        self.assertTrue(covered(before,filled_copper(b,{(net.GetNetCode(),p.B_Cu)})[(net.GetNetCode(),p.B_Cu)]))
        self.assertTrue(any(t.IsLocked() for t in b.GetTracks()));self.assertTrue(any(t.GetNetname()=='/other' for t in b.GetTracks()))
    def test_pad_copper_removes_only_contained_same_net_same_layer_unlocked_tracks(self):
        import gc
        from pcb_route_cleanup import remove_pad_tracks,route_metrics
        b=p.BOARD();n=p.NETINFO_ITEM(b,'/signal');b.Add(n);other=p.NETINFO_ITEM(b,'/other');b.Add(other)
        point=lambda x,y:p.VECTOR2I(p.FromMM(x),p.FromMM(y))
        f=p.FOOTPRINT(b);b.Add(f);pad=p.PAD(f);pad.SetAttribute(p.PAD_ATTRIB_SMD);pad.SetShape(p.PAD_SHAPE_RECT);pad.SetSize(point(2,2));pad.SetPosition(point(5,5));layers=p.LSET();layers.AddLayer(p.B_Cu);pad.SetLayerSet(layers);pad.SetNet(n);f.Add(pad)
        def track(a,c,net=n,layer=p.B_Cu,locked=False):
            t=p.PCB_TRACK(b);t.SetStart(point(*a));t.SetEnd(point(*c));t.SetWidth(p.FromMM(.3));t.SetLayer(layer);t.SetNet(net);t.SetLocked(locked);b.Add(t);return t
        track((4.8,5),(5,5));track((5,5),(5.2,5.2))
        track((5.5,5),(6.2,5));track((4.8,5),(5,5),net=other);track((4.8,5),(5,5),layer=p.F_Cu);track((4.8,5),(5,5),locked=True)
        r=remove_pad_tracks(b);gc.collect()
        self.assertEqual(r['removedSegments'],2);self.assertEqual(route_metrics(b)['segments'],4)
        self.assertTrue(r['copperCoveragePreserved']);self.assertEqual(len(b.GetFootprints()),1)
        self.assertTrue(any(t.IsLocked() for t in b.GetTracks()))

    def test_zone_outline_alone_never_authorizes_deletion(self):
        b=p.BOARD();n=p.NETINFO_ITEM(b,'/n');b.Add(n);t=p.PCB_TRACK(b);t.SetNet(n);t.SetLayer(p.B_Cu);t.SetWidth(p.FromMM(.3));t.SetStart(p.VECTOR2I(1000000,1000000));t.SetEnd(p.VECTOR2I(3000000,1000000));b.Add(t)
        z=p.ZONE(b);z.SetNet(n);z.SetLayer(p.B_Cu);poly=z.Outline();poly.NewOutline()
        for x,y in [(0,0),(4000000,0),(4000000,4000000),(0,4000000)]:poly.Append(x,y)
        b.Add(z);self.assertEqual(remove_filled_tracks(b)['removedSegments'],0)

if __name__=='__main__':unittest.main()
