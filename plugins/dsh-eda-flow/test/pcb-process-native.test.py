import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'python'))
import pcbnew as p
from pcb_process import assembly_sides,native_process,placement_report,add_copper

class Tests(unittest.TestCase):
    def setUp(self):
        self.b=p.BOARD();self.parts={};self.pads={}
        for name in ['/rail','/return','/separate']:
            net=p.NETINFO_ITEM(self.b,name);self.b.Add(net)
        for ref,x,kind in [('ICX',10,p.PAD_ATTRIB_SMD),('BYP',14,p.PAD_ATTRIB_SMD),('PORT',22,p.PAD_ATTRIB_PTH)]:
            fp=p.FOOTPRINT(self.b);fp.SetReference(ref);self.b.Add(fp);self.parts[ref]=fp
            for num,y,name in [('1',10,'/rail'),('2',14,'/return')]:
                layers=p.LSET.AllCuMask() if kind==p.PAD_ATTRIB_PTH else p.LSET();layers.AddLayer(p.B_Cu)
                pad=p.PAD(fp);pad.SetNumber(num);pad.SetAttribute(kind);pad.SetShape(p.PAD_SHAPE_CIRCLE);pad.SetSize(p.VECTOR2I(p.FromMM(1.6),p.FromMM(1.6)));pad.SetPosition(p.VECTOR2I(p.FromMM(x),p.FromMM(y)));pad.SetLayerSet(layers);pad.SetNet(self.b.FindNet(name));fp.Add(pad);self.pads[(ref,num)]=[pad]
        self.relation={'ref':'BYP','anchor':{'ref':'ICX','pad':'1'},'return':{'ref':'ICX','pad':'2'},'supplyPad':'1','returnPad':'2','supplyNet':'rail','returnNet':'return','maxDistanceMm':5}
    def test_native_aliases_do_not_merge_other_side_of_a_jumper(self):
        policy=native_process({'relations':[self.relation],'copperNets':[{'name':'rail','kind':'supply'},{'name':'return','kind':'return'}]},self.pads)
        self.assertEqual([z['name'] for z in policy['copperNets']],['/rail','/return'])
        self.assertTrue(placement_report(self.b,policy)['passed'])
        policy['relations'][0]['maxDistanceMm']=3
        self.assertFalse(placement_report(self.b,policy)['passed'])
    def test_assembly_is_based_on_physical_pad_types(self):
        sides,facts=assembly_sides(self.parts,{}, {'pcbSmdSide':'底面','pcbThtSide':'顶面'})
        self.assertEqual(sides,{'ICX':'B.Cu','BYP':'B.Cu','PORT':'F.Cu'})
    def test_native_zones_fill_on_only_the_selected_net_and_layer(self):
        for a,b in [((0,0),(30,0)),((30,0),(30,25)),((30,25),(0,25)),((0,25),(0,0))]:
            edge=p.PCB_SHAPE();edge.SetShape(p.SHAPE_T_SEGMENT);edge.SetLayer(p.Edge_Cuts);edge.SetStart(p.VECTOR2I(*[p.FromMM(v) for v in a]));edge.SetEnd(p.VECTOR2I(*[p.FromMM(v) for v in b]));edge.SetWidth(p.FromMM(.05));self.b.Add(edge)
        result=add_copper(self.b,{'copperNets':[{'name':'/return','kind':'return'}]},{'widthMm':30,'heightMm':25,'clearanceMm':.25,'trackWidthMm':.25,'activeLayers':['B.Cu']})
        self.assertTrue(result['filled']);self.assertGreater(result['zones'][0]['filledAreaMm2'],0)
        self.assertEqual([(z.GetNetname(),z.GetLayer()) for z in self.b.Zones()],[('/return',p.B_Cu)])
if __name__=='__main__':unittest.main()
