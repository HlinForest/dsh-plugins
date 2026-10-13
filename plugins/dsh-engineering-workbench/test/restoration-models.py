import hashlib,json,struct,sys,tempfile,unittest
from pathlib import Path
import sexpdata as sx
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'src/restoration'))
from models import check_model_assets,body_component_index

class Models(unittest.TestCase):
    def test_repeated_instances_need_correct_asset_at_each_native_position(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);inp=root/'input';project=root/'out/p.kicad_pro';project.parent.mkdir()
            def save(name,data):
                p=inp/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(data),encoding='utf-8')
            prefix='02_extracted/native_pcb/'
            body=bytes([12])+struct.pack('<I',32)+bytes(32)
            stream=inp/(prefix+'streams/bodies.bin');stream.parent.mkdir(parents=True);stream.write_bytes(body+body)
            records=[]
            for i in range(2):
                records.append({'index':i,'offset':i*len(body),'length':32,'fields':{'MODEL.2D.X':str(i*10)+'mil','MODEL.2D.Y':'0mil','MODELID':str(i),'MODEL.NAME':str(i)+'.step'}})
                (project.parent/(str(i)+'.step')).write_bytes(bytes([i]))
            save(prefix+'ComponentBodies6_Data.records.json',{'records':records})
            save(prefix+'Components6_Data.records.json',{'records':[{'fields':{'SOURCEDESIGNATOR':'J1','X':'0mil','Y':'0mil','ROTATION':'0','LAYER':'TOP'}}]})
            save(prefix+'stream_index.json',{'streams':[{'source_locator':'ComponentBodies6/Data','output':prefix+'streams/bodies.bin'}]})
            save('04_assets/native_models/manifest.json',[{'metadata':{'ID':str(i)},'sha256':hashlib.sha256(bytes([i])).hexdigest()} for i in range(2)])
            board='(kicad_pcb (footprint "J" (property "Reference" "J1") (model "${KIPRJMOD}/0.step" (offset (xyz 0 0 0))) (model "${KIPRJMOD}/1.step" (offset (xyz .254 0 0)))))'
            self.assertTrue(check_model_assets(inp,project,sx.loads(board))['match'])
            wrong=board.replace('/1.step','/0.step')
            self.assertFalse(check_model_assets(inp,project,sx.loads(wrong))['match'])
            moved=board.replace('xyz .254','xyz .354')
            self.assertFalse(check_model_assets(inp,project,sx.loads(moved))['match'])

    def test_truncated_body_header_is_rejected(self):
        with self.assertRaises(ValueError):body_component_index(bytes(10),{'offset':0,'length':32})

if __name__=='__main__':unittest.main()
