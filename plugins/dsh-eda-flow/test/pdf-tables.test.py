"""Preserve datasheet column meaning through the actual PDF extractor."""
import sys,tempfile,unittest
from pathlib import Path
import pymupdf as fitz
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'python'))
from extract_pdf import extract

def table_pdf(path,rows):
    doc=fitz.open();page=doc.new_page(width=600,height=430)
    page.insert_text((30,30),'Electrical characteristics: VDD=5V, ambient 25 C.')
    xs=[30,150,215,280,345,410,570];top=65;step=40
    for y in [top+i*step for i in range(len(rows)+1)]:page.draw_line((xs[0],y),(xs[-1],y))
    for x in xs:page.draw_line((x,top),(x,top+len(rows)*step))
    for i,row in enumerate(rows):
        for j,value in enumerate(row):page.insert_text((xs[j]+5,top+i*step+23),value,fontsize=10)
    page.insert_text((30,top+len(rows)*step+30),'Absolute maximum ratings are specified separately.')
    doc.save(path)

class PdfTables(unittest.TestCase):
    def test_min_typ_max_keep_shared_unit_and_test_condition(self):
        with tempfile.TemporaryDirectory() as directory:
            file=Path(directory)/'driver.pdf'
            table_pdf(file,[['Parameter','Min','Typ','Max','Unit','Test conditions'],['Output current','10','18','29','mA','VO=2V'],['Input current','-1','','1','uA','VIN=0V']])
            result=extract(file,file.name,'driver')
        rows=[r for r in result['records'] if r['sourceType']=='pdf-table-extraction']
        self.assertEqual(len(rows),1,'The plain text path loses a separately citable column/row relationship')
        table=rows[0]
        self.assertIn('Min=10 mA',table['content']);self.assertIn('Typ=18 mA',table['content'])
        self.assertIn('Max=29 mA',table['content']);self.assertIn('Test conditions=VO=2V',table['content'])
        self.assertIn('Min=-1 uA',table['content']);self.assertNotIn('Typ=0',table['content'])
        self.assertEqual(table['page'],1);self.assertEqual(table['sourceSha256'],result['sha256'])
        self.assertEqual(table['table']['rows'][1],['Output current','10','18','29','mA','VO=2V'])
        self.assertIn('VDD=5V',table['content'])
        self.assertIn('Absolute maximum ratings',result['records'][0]['content'])
        self.assertEqual(result['pages'],1);self.assertEqual(result['tableCount'],1)

    def test_ambiguous_unit_does_not_become_a_supported_scalar(self):
        with tempfile.TemporaryDirectory() as directory:
            file=Path(directory)/'mixed.pdf'
            table_pdf(file,[['Parameter','Min','Typ','Max','Unit','Test conditions'],['Gain','2','4','8','mA/V','5V supply']])
            result=extract(file,file.name,'amplifier')
        row=next(r for r in result['records'] if r['sourceType']=='pdf-table-extraction')
        self.assertIn('Typ=4;',row['content']);self.assertNotIn('Typ=4 mA',row['content'])

    def test_table_does_not_replace_original_page_or_invent_units(self):
        with tempfile.TemporaryDirectory() as directory:
            file=Path(directory)/'mechanical.pdf'
            table_pdf(file,[['Dimension','Min','Typ','Max','Note','Conditions'],['Width','2','','4','mm','body only']])
            result=extract(file,file.name,'part')
        self.assertTrue(result['readable']);self.assertEqual(result['unreadablePages'],[])
        self.assertIn('Electrical characteristics',result['records'][0]['content'])
        row=next(r for r in result['records'] if r['sourceType']=='pdf-table-extraction')
        self.assertIn('Min=2;',row['content']);self.assertNotIn('Min=2 mm',row['content'])

if __name__=='__main__':unittest.main()
