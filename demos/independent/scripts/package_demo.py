from pathlib import Path
import zipfile,json,hashlib

ROOT=Path(__file__).resolve().parents[1];REPO=ROOT.parents[1]
OUT=REPO/'output';(OUT/'packages').mkdir(parents=True,exist_ok=True)
PDF=OUT/'pdf/DSH三个插件独立演示手册.pdf'
DEST=OUT/'packages/DSH三个插件独立演示材料包.zip'
top='DSH三个插件独立演示/'
items=[]
for p in ROOT.rglob('*'):
    if not p.is_file():continue
    rel=p.relative_to(ROOT)
    if any(s in ['.runtime','__pycache__','current','catalog','packages'] for s in rel.parts) or p.name=='.gitignore':continue
    if p.suffix not in ['.py','.ps1','.cmd','.txt','.json','.xml','.csv','.png','.kicad_sch','.kicad_pro','.kicad_pcb']:continue
    items.append((p,str(rel).replace('\\','/')))
items.append((PDF,PDF.name))
for name in ['dsh-megmeet-0.2.0.tgz','dsh-pcb-review-0.1.1.tgz','dsh-schematic-sync-0.1.0.tgz','dsh-engineering-workbench-0.2.0.tgz']:
    items.append((REPO/'dist'/name,'packages/'+name))
catalog=REPO/'plugins/dsh-megmeet/success-demo/snapshots/catalog.v2.json'
items.append((catalog,'01-selection/catalog/snapshots/catalog.v2.json'))
for s in json.loads(catalog.read_text(encoding='utf-8'))['sources']:
    p=(catalog.parent/s['file']).resolve();assert hashlib.sha256(p.read_bytes()).hexdigest()==s['sha256']
    items.append((p,'01-selection/catalog/materials/'+p.name))
assert len({name for _,name in items})==len(items)
with zipfile.ZipFile(DEST,'w',zipfile.ZIP_DEFLATED,compresslevel=7) as z:
    for p,name in items:z.write(p,top+name)
    sums='\n'.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+name for p,name in items)+'\n'
    z.writestr(top+'SHA256SUMS.txt',sums.encode('utf-8'))
with zipfile.ZipFile(DEST) as z:
    assert z.testzip() is None
    assert not any('/.runtime/' in n or '/__pycache__/' in n for n in z.namelist())
    assert z.read(top+PDF.name)==PDF.read_bytes()
print(json.dumps({'zip':str(DEST),'files':len(items)+1,'bytes':DEST.stat().st_size,'sha256':hashlib.sha256(DEST.read_bytes()).hexdigest()},ensure_ascii=False))
