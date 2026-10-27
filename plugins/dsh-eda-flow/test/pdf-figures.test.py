import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'python'))
import pymupdf
from pdf_figures import FigureReader

class Figures(unittest.TestCase):
    def page(self):
        image=pymupdf.Pixmap(pymupdf.csRGB,pymupdf.IRect(0,0,400,160),False)
        image.clear_with(255)
        doc=pymupdf.open();page=doc.new_page(width=400,height=400)
        page.insert_text((20,30),'Application circuit and searchable text')
        page.insert_image(pymupdf.Rect(40,70,340,190),stream=image.tobytes('png'))
        return doc,page

    def test_mixed_page_keeps_ocr_separate_with_source_coordinates(self):
        doc,page=self.page();calls=[]
        def engine(pixels):
            calls.append(pixels.shape)
            return [[[[0,0],[30,0],[30,15],[0,15]],'R >= 15 kohm',.98]], [0,0,0]
        rows,warnings=FigureReader(engine=engine).extract(page,'a'*64,'other-device.pdf','Q2')
        self.assertEqual(len(calls),1);self.assertEqual(warnings,[])
        self.assertEqual(rows[0]['status'],'needs-verification')
        self.assertFalse(rows[0]['verified']);self.assertNotIn('stages',rows[0])
        self.assertEqual(rows[0]['lines'][0]['polygon'][0],[40,70])
        self.assertEqual(rows[0]['page'],1);self.assertEqual(rows[0]['binding'],'Q2')
        self.assertIn('searchable',page.get_text())

    def test_missing_engine_preserves_region_for_review(self):
        doc,page=self.page();reader=FigureReader();reader.initialized=True;reader.failure='ModuleNotFoundError'
        rows,warnings=reader.extract(page,'b'*64,'source.pdf','')
        self.assertEqual(rows[0]['status'],'ocr-unavailable')
        self.assertEqual(warnings[0]['kind'],'figure-ocr-unavailable')
        self.assertEqual(rows[0]['content'],'')

    def test_budget_does_not_silently_drop_regions(self):
        doc,page=self.page();reader=FigureReader(engine=lambda _: self.fail('over budget'),max_regions=0)
        rows,warnings=reader.extract(page,'b'*64,'source.pdf','')
        self.assertEqual(rows[0]['status'],'limit-reached')
        self.assertEqual(warnings[0]['kind'],'figure-ocr-limit')

    def test_engine_failure_is_not_source_text(self):
        doc,page=self.page()
        def broken(_):raise RuntimeError('invalid OCR')
        rows,warnings=FigureReader(engine=broken).extract(page,'b'*64,'source.pdf','')
        self.assertEqual(rows[0]['status'],'ocr-failed')
        self.assertEqual(rows[0]['lines'],[]);self.assertEqual(warnings[0]['message'],'RuntimeError')

if __name__=='__main__':unittest.main()
