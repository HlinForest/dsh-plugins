import sys, tempfile, unittest, copy
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'mcp'))
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'python'))
import pcbnew as p
import pcb_footprints as f

def pad(number='1',kind='smd',paste=True):
 return {'number':number,'type':kind,'shape':'rect','at':[0,0,0],'size':[2,2],'drill':[1,1] if kind=='thru_hole' else [0,0],'layers':['*.Cu','*.Mask'] if kind=='thru_hole' else ['F.Cu','F.Mask']+(['F.Paste'] if paste else [])}
def spec(pads):return {'id':'EvidencePkg:FP_Test','ref':'Q27','geometry':{'envelope':[-2,-2,2,2],'pads':pads}}
def load(s):
 with tempfile.TemporaryDirectory() as folder:
  Path(folder,'FP_Test.kicad_mod').write_text(f.native_footprint(s),encoding='utf8')
  fp=p.FootprintLoad(folder,'FP_Test')
  fp.SetReference(s['ref']);fp.SetFPID(p.LIB_ID('EvidencePkg','FP_Test'))
  return fp
class Tests(unittest.TestCase):
 def test_paste_bearing_electrical_pads_export_as_smd(self):
  self.assertTrue(load(spec([pad()])).GetAttributes() & p.FP_SMD)
 def test_plated_terminal_with_duplicate_copper_is_through_hole(self):
  fp=load(spec([pad(kind='thru_hole'),pad(paste=False),pad(number='')]))
  self.assertTrue(fp.GetAttributes() & p.FP_THROUGH_HOLE)
  self.assertFalse(fp.GetAttributes() & p.FP_SMD)
 def test_copper_only_and_unnumbered_features_do_not_imply_machine_assembly(self):
  for pads in [[pad(paste=False)],[pad(number='')],[]]:
   self.assertFalse(load(spec(pads)).GetAttributes() & (p.FP_SMD|p.FP_THROUGH_HOLE))
 def test_revalidated_history_refreshes_only_assembly_bits_and_is_idempotent(self):
  s=spec([pad()]);b=p.BOARD();fp=load(s);b.Add(fp)
  fp.SetAttributes(p.FP_EXCLUDE_FROM_POS_FILES|p.FP_DNP);fp.SetPosition(p.VECTOR2I(12000000,34000000));fp.SetValue('not a display board')
  before=(fp.GetPosition().x,fp.GetPosition().y,fp.GetValue(),[(q.GetNumber(),q.GetPosition().x,q.GetPosition().y) for q in fp.Pads()])
  report=f.synchronize_imported_assembly(b,[s])
  self.assertEqual(fp.GetAttributes(),p.FP_SMD|p.FP_EXCLUDE_FROM_POS_FILES|p.FP_DNP)
  self.assertEqual(before,(fp.GetPosition().x,fp.GetPosition().y,fp.GetValue(),[(q.GetNumber(),q.GetPosition().x,q.GetPosition().y) for q in fp.Pads()]))
  self.assertEqual(report[0]['after'],'smd');self.assertFalse(f.synchronize_imported_assembly(b,[s]))
 def test_conflicting_native_import_is_rejected_before_any_mutation(self):
  s=spec([pad()]);b=p.BOARD();fp=load(s);b.Add(fp);fp.SetAttributes(0)
  other=copy.deepcopy(s);other['ref']='MISSING'
  with self.assertRaises(ValueError):f.synchronize_imported_assembly(b,[s,other])
  self.assertEqual(fp.GetAttributes(),0)
if __name__=='__main__':unittest.main()
