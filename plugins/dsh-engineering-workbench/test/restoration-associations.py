import sys,unittest,tempfile
from pathlib import Path
import sexpdata as sx
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src/restoration'))
from associations import check_associations,check_object_ids,native_source_file

class Association(unittest.TestCase):
    def test_native_board_selection_uses_manifest_with_any_source_folder_and_case(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            for name in ['00_native/input_01_native_original/old.PcbDoc','00_native/new.pcbdoc']:
                file=root/name;file.parent.mkdir(parents=True,exist_ok=True);file.write_bytes(b'native')
                self.assertEqual(native_source_file(root,{'files':[{'path':name}]},'.PcbDoc'),file.resolve())

    def test_multiple_missing_or_escaping_native_boards_are_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            for paths in [[],['00_native/a.PcbDoc','00_native/b.PcbDoc'],['00_native/missing.PcbDoc'],['00_native/../../outside.PcbDoc']]:
                with self.assertRaises(ValueError):native_source_file(root,{'files':[{'path':p} for p in paths]},'.PcbDoc')

    def test_repeated_or_placeholder_ids_are_not_valid_determinism(self):
        for text in ['(board (item (uuid "<uuid>")))','(board (item (uuid "a97b7068-5a47-4498-b644-2a3a1b7507f8")) (item (uuid "a97b7068-5a47-4498-b644-2a3a1b7507f8")))']:
            self.assertFalse(check_object_ids(sx.loads(text))['match'])
        self.assertTrue(check_object_ids(sx.loads('(board (item (uuid "a97b7068-5a47-4498-b644-2a3a1b7507f8")))'))['match'])

    def test_board_path_must_point_to_sheet_and_symbol_not_footprint(self):
        native=[{'reference':'U1','raw_fields':{'UniqueID':'SOURCE'}}]
        pcb=[{'fields':{'SOURCEUNIQUEID':'\\SOURCE','SOURCEDESIGNATOR':'U1'}}]
        sch=sx.loads('(kicad_sch (uuid "sheet") (symbol (uuid "symbol") (property "Reference" "U1")))')
        for path,expected in [('/footprint/symbol',False),('/sheet/symbol',True)]:
            board=sx.loads('(kicad_pcb (footprint "L:U" (property "Reference" "U1") (path "'+path+'")))')
            result=check_associations(native,pcb,sch,board)
            self.assertEqual(result['match'],expected)
        result=check_associations(native,pcb,sch,sx.loads('(kicad_pcb)'))
        self.assertFalse(result['match'])

if __name__=='__main__':unittest.main()
