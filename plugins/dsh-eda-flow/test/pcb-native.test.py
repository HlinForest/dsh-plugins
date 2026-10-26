import sys, unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'mcp'))
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'python'))
from pcb_footprints import verify_pad_assignments, normalized_geometry, native_footprint
import math, tempfile

class Pad:
    def __init__(self,number,net):self.number=number;self.net=net
    def GetNumber(self):return self.number
    def GetNetname(self):return self.net
    def GetNetCode(self):return 1 if self.net else 0
class Footprint:
    def __init__(self,pads):self.pads=pads
    def GetReference(self):return 'X1'
    def Pads(self):return self.pads
class Board:
    def __init__(self,pads):self.pads=pads
    def GetFootprints(self):return [Footprint(self.pads)]
class Tests(unittest.TestCase):
    def test_vertex_anchor_no_longer_forms_a_disconnected_island(self):
        import pcbnew as pcb
        spec={'id':'EvidencePkg:Triangle','geometry':{'envelope':[-3,-3,3,3],'pads':[{'number':'1','type':'smd','shape':'custom','at':[2,3,270],'size':[.000001,.000001],'layers':['B.Cu'],'polygon':[[-1,-1],[-1,1],[0,0]]}]}}
        geometry,changes=normalized_geometry(spec)
        def world(pad):
            x,y,deg=pad['at'];r=math.radians(deg)
            return [(x+px*math.cos(r)+py*math.sin(r),y-px*math.sin(r)+py*math.cos(r)) for px,py in pad['polygon']]
        for old,new in zip(world(spec['geometry']['pads'][0]),world(geometry['pads'][0])):
            for a,b in zip(old,new):self.assertAlmostEqual(a,b,places=6)
        with tempfile.TemporaryDirectory() as directory:
            Path(directory,'Triangle.kicad_mod').write_text(native_footprint(spec),encoding='utf8')
            fp=pcb.FootprintLoad(directory,'Triangle')
            self.assertEqual(list(fp.Pads())[0].GetCustomShapeAsPolygon().OutlineCount(),1)
    def test_duplicate_pad_error_is_not_hidden_by_last_pad(self):
        with self.assertRaisesRegex(ValueError,'mapping changed'):
            verify_pad_assignments(Board([Pad('1','wrong'),Pad('1','A')]),{('X1','1'):'A'})
    def test_auxiliary_pad_must_not_gain_a_net(self):
        with self.assertRaisesRegex(ValueError,'Unexpected connected'):
            verify_pad_assignments(Board([Pad('1','A'),Pad('','A')]),{('X1','1'):'A'})
    def test_counts_physical_pads_without_collapsing_duplicates(self):
        self.assertEqual(verify_pad_assignments(Board([Pad('1','A'),Pad('1','A'),Pad('','')]),{('X1','1'):'A'}),2)
if __name__=='__main__':unittest.main()
