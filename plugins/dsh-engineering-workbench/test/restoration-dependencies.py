import sys, tempfile, unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'src/restoration'))
from dependencies import library_dependencies
import sexpdata as sx

class LibraryDependencies(unittest.TestCase):
    def test_board_library_id_must_resolve_even_when_schematic_library_is_valid(self):
        with tempfile.TemporaryDirectory() as tmp:
            base=Path(tmp);project=base/'demo.kicad_pro'
            (base/'X.pretty').mkdir()
            (base/'X.pretty/R.kicad_mod').write_text('(footprint "R")')
            (base/'fp-lib-table').write_text('(fp_lib_table (lib (name "X") (uri "${KIPRJMOD}/X.pretty")))')
            sch=sx.loads('(kicad_sch (symbol (property "Reference" "R1") (property "Footprint" "X:R")))')
            board=project.with_suffix('.kicad_pcb')
            board.write_text('(kicad_pcb (footprint "OriginalAltium:R" (property "Reference" "R1") (pad "1" smd rect)))')
            r=library_dependencies(project,sch)
            self.assertFalse(r['match'])
            self.assertFalse(r['boardFootprintAssignments'][0]['resolved'])
            board.write_text('(kicad_pcb (footprint "X:R" (property "Reference" "R1") (pad "1" smd rect)))')
            self.assertTrue(library_dependencies(project,sch)['match'])

    def test_anonymous_embedded_primitive_container_is_disclosed_but_named_missing_library_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            project=Path(tmp)/'demo.kicad_pro';board=project.with_suffix('.kicad_pcb')
            sch=sx.loads('(kicad_sch)')
            board.write_text('(kicad_pcb (footprint "" (property "Reference" "")))')
            r=library_dependencies(project,sch)
            self.assertTrue(r['match']);self.assertEqual(r['embeddedOnlyPrimitiveContainers'],1)
            board.write_text('(kicad_pcb (footprint "" (property "Reference" "R1")))')
            self.assertFalse(library_dependencies(project,sch)['match'])

    def test_symbol_library_must_parse_and_contain_the_assigned_definition(self):
        with tempfile.TemporaryDirectory() as tmp:
            base=Path(tmp)
            (base/'sym-lib-table').write_text('(sym_lib_table (lib (name "X") (uri "${KIPRJMOD}/X.kicad_sym")))')
            sch=sx.loads('(kicad_sch (symbol (lib_id "X:R") (property "Reference" "R1")))')
            for invalid in ['broken', '(kicad_symbol_lib (symbol "Other"))']:
                (base/'X.kicad_sym').write_text(invalid)
                self.assertFalse(library_dependencies(base/'demo.kicad_pro',sch)['match'])
            (base/'X.kicad_sym').write_text('(kicad_symbol_lib (symbol "R"))')
            self.assertTrue(library_dependencies(base/'demo.kicad_pro',sch)['match'])

    def test_missing_library_is_failure_even_when_shapes_are_embedded(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            (base/'sym-lib-table').write_text('(sym_lib_table (lib (name "X") (uri "${KIPRJMOD}/missing.kicad_sym")))')
            r = library_dependencies(base/'demo.kicad_pro', sx.loads('(kicad_sch (lib_symbols))'))
            self.assertFalse(r['match'])
            self.assertEqual(len(r['tableIssues']), 1)

    def test_assigned_footprint_must_resolve_inside_delivery(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp)
            sch = sx.loads('(kicad_sch (symbol (property "Reference" "R1") (property "Footprint" "X:R")))')
            self.assertFalse(library_dependencies(base/'demo.kicad_pro', sch)['match'])
            (base/'X.pretty').mkdir()
            (base/'X.pretty/R.kicad_mod').write_text('(footprint "R")')
            (base/'fp-lib-table').write_text('(fp_lib_table (lib (name "X") (uri "${KIPRJMOD}/X.pretty")))')
            self.assertTrue(library_dependencies(base/'demo.kicad_pro', sch)['match'])
            (base/'X.pretty/R.kicad_mod').write_text('(footprint "R"))')
            self.assertFalse(library_dependencies(base/'demo.kicad_pro', sch)['match'])
            (base/'fp-lib-table').write_text('(fp_lib_table (lib (name "X") (uri "${KIPRJMOD}/../X.pretty")))')
            self.assertFalse(library_dependencies(base/'demo.kicad_pro', sch)['match'])

if __name__ == '__main__': unittest.main()
