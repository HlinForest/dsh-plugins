import sys,unittest,tempfile
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'python'))
from schematic_targets import selection_map
class Tests(unittest.TestCase):
 def test_uses_rotated_native_symbol_and_only_selected_unit(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);sch=root/'Circuit.kicad_sch';svg=root/'Circuit.svg'
   sch.write_text('(kicad_sch (lib_symbols (symbol "Any:Part" (symbol "Part_1_1" (rectangle (start -2 1) (end 2 -1))) (symbol "Part_2_1" (rectangle (start -40 40) (end 40 -40))))) (symbol (lib_id "Any:Part") (at 100 50 90) (unit 1) (uuid "one") (property "Reference" "RX" (at 100 45 0)) (property "Value" "12k" (at 100 55 0))))')
   svg.write_text('<svg viewBox="0 0 297 210"/>')
   result=selection_map(sch,svg);target=result['targets'][0]
   self.assertEqual(target['ref'],'RX');self.assertEqual(result['viewBox'],[0,0,297,210])
   self.assertEqual([round(x,2) for x in target['regions'][0]],[98.3,47.3,101.7,52.7])
   self.assertNotIn('placements',result)
 def test_power_flags_are_not_selectable_and_mirrors_keep_field_targets(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);sch=root/'Circuit.kicad_sch';svg=root/'Circuit.svg'
   sch.write_text('(kicad_sch (lib_symbols (symbol "Any:Part" (symbol "Part_1_1" (rectangle (start -2 1) (end 2 -1))))) (symbol (lib_id "Any:Part") (at 10 10 0) (unit 1) (uuid "one") (mirror x) (property "Reference" "R-any" (at 10 7 0))) (symbol (lib_id "Any:Part") (at 10 10 0) (property "Reference" "#PWR01" (at 10 7 0))))')
   svg.write_text('<svg viewBox="0 0 297 210"/>')
   targets=selection_map(sch,svg)['targets'];self.assertEqual(len(targets),1);self.assertEqual(len(targets[0]['regions']),1)
if __name__=='__main__':unittest.main()
