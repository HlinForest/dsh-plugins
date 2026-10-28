"""Audit actual PDF glyphs for KiCad active-low pin/label notation."""
import sys, tempfile, unittest
from pathlib import Path
import pymupdf

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'mcp'))
from fixed_components import audit_layout

class PdfTextAudit(unittest.TestCase):
    def check_label(self, source, rendered):
        with tempfile.TemporaryDirectory() as name:
            folder=Path(name)
            doc=pymupdf.open()
            page=doc.new_page(width=500,height=400)
            page.insert_text((100,100),rendered)
            doc.save(str(folder/'label.pdf'))
            doc.close()
            state={'items':{'label':{'id':'label','kind':'label','text':source,'at':[100*25.4/72,100*25.4/72]}},'symbols':{}}
            return audit_layout(folder,state,str(folder/'label.pdf'))

    def test_active_low_markup_is_not_a_missing_glyph(self):
        result=self.check_label('~{RESET}','RESET')
        self.assertEqual(result['status'],'passed',result['errors'])

    def test_actual_missing_active_low_name_still_fails(self):
        result=self.check_label('~{RESET}','OTHER')
        self.assertIn('PDF missing visible text label',result['errors'])

    def test_literal_braces_are_not_silently_removed(self):
        result=self.check_label('{RESET}','RESET')
        self.assertIn('PDF missing visible text label',result['errors'])

if __name__=='__main__':unittest.main()
