import json,subprocess,sys,tempfile,unittest,hashlib
from pathlib import Path
import pymupdf

class Intake(unittest.TestCase):
    def run_intake(self,root,stage,inputs):
        out=root/str(stage);out.mkdir();req={'stage':stage,'output':str(out),'inputs':inputs}
        request=root/'request.json';request.write_text(json.dumps(req),encoding='utf-8')
        r=subprocess.run([sys.executable,str(Path(__file__).parents[1]/'python/intake.py'),str(request)],capture_output=True)
        self.assertEqual(r.returncode,0,r.stderr.decode(errors='replace'));return out/'prepared'
    def test_pdf_pages_bindings_and_hash_preserved(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);pdf=root/'part.pdf';doc=pymupdf.open();doc.new_page().insert_text((50,50),'Part ABC supply 3.3V');doc.new_page().insert_text((50,50),'Pin 1 GND');doc.save(pdf);doc.close()
            out=self.run_intake(root,3,{'datasheets':[{'path':str(pdf),'mpn':'ABC','binding':'U1'}]})
            data=json.loads(next((out/'datasheets').glob('*.json')).read_text(encoding='utf-8'))
            self.assertEqual([p['page'] for p in data['pages']],[1,2]);self.assertIn('Pin 1',data['pages'][1]['text']);self.assertEqual(data['sha256'],hashlib.sha256(pdf.read_bytes()).hexdigest());self.assertEqual(data['binding'],'U1')
    def test_tsd_not_treated_as_extracted(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);src=root/'source.SchDoc';src.write_bytes(b'%TSD-Header-##test')
            out=self.run_intake(root,2,{'schematic':str(src)})
            data=json.loads((out/'intake.json').read_text(encoding='utf-8'));self.assertTrue(any('TSD' in g for g in data['gaps']));self.assertFalse((out/'native-extraction.json').exists());self.assertEqual(src.read_bytes(),b'%TSD-Header-##test')
    def test_frozen_archive_carries_full_default_inputs(self):
        import zipfile
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);out=root/'out';out.mkdir();bundle=root/'default-inputs';bundle.mkdir();(bundle/'facts.json').write_text('{"x":1}')
            (out/'result.json').write_text('{"summary":"test"}')
            request=root/'request.json';request.write_text(json.dumps({'output':str(out),'inputsBundle':str(bundle),'dependencies':{},'stage':7}))
            subprocess.run([sys.executable,str(Path(__file__).parents[1]/'python/archive.py'),str(request)],check=True)
            with zipfile.ZipFile(out/'frozen-evidence.zip') as z:
                self.assertEqual(z.read('default-inputs/facts.json'),b'{"x":1}');self.assertIn('steps/7/result.json',z.namelist())

if __name__=='__main__':unittest.main()
