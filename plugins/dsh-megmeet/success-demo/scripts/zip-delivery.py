from pathlib import Path
import json,zipfile,hashlib
root=Path(__file__).resolve().parents[2];demo=root/'success-demo'
files=json.loads((demo/'share-files.json').read_text(encoding='utf-8'))
target=root/'dsh-megmeet-success-demo-0.2.0.zip'
with zipfile.ZipFile(target,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
 for relative in files:
  file=(root/relative).resolve();assert file.is_relative_to(root),relative;z.write(file,'dsh-megmeet/'+relative)
with zipfile.ZipFile(target) as z:
 assert z.testzip() is None
 assert len(z.namelist())==len(files)
 for item in json.loads((demo/'artifact-manifest.json').read_text(encoding='utf-8'))['files']:
  assert hashlib.sha256(z.read('dsh-megmeet/'+item['file'])).hexdigest()==item['sha256'],item['file']
record={'pass':True,'file':str(target),'bytes':target.stat().st_size,'files':len(files),'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'allArchivedHashesVerified':True}
(demo/'zip-verification.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(record,ensure_ascii=False))
