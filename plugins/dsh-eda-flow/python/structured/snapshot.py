"""Semantic hashes using the trial's reference-aware comparator; no finished CAD input at runtime."""
from verify import *

def snapshot(root):
    root=Path(root);p=project(root);groups={}
    for doc in ['sch','pcb']:
        for t in sorted(set(tag(v) for v in p[doc][1:]) - {'generator','generator_version','version','uuid','embedded_fonts'}):
            groups[doc+'/'+t]=[p['normalize'](v) for v in children(p[doc],t)]
    groups['library/symbols']=p['symbol_library'];groups['library/footprints']=p['footprint_library']
    groups['library/models']=[digest(f) for f in (root/'models').glob('*') if f.suffix.lower() in {'.step','.stp'}]
    data=read(next(root.glob('*.kicad_pro')));data.get('meta',{}).pop('filename',None);groups['project/settings']=[data]
    content=next(root.glob('*.kicad_dru')).read_text(encoding='utf-8')
    content='\n'.join(line for line in content.splitlines() if not line.lstrip().startswith('#'))
    def norm(x):
        if isinstance(x,list):
            if tag(x)=='rule':return ['rule','<name>',*[norm(v) for v in x[2:]]]
            return [norm(v) for v in x]
        s=str(x);m=re.fullmatch(r'([0-9.]+)(mil|mm)',s)
        return round(float(m[1])*(.0254 if m[2]=='mil' else 1),9) if m else s
    groups['project/custom_rules']=[norm(v) for v in sx.parse(content)]
    with next(root.glob('BOM_*.csv')).open(encoding='utf-8-sig',newline='') as f:rows=list(csv.DictReader(f))
    groups['bom/per_reference']=[[r.get('原位号',r.get('位号')),1,r.get('原值字符串',r.get('值')),r.get('原封装名称',r.get('原理图原封装')),*[r.get(k,'') for k in ['物料编码','物料描述','优选等级','装配类型']]] for r in rows]
    assert all(v['valid'] for v in p['associations']),'Broken schematic/PCB associations'
    assert all(v['exists'] for v in p['dependencies']),'Missing project dependencies'
    return {k:{'count':len(v),'sha256':hashlib.sha256(token(sorted(v,key=token)).encode()).hexdigest()} for k,v in groups.items()}

if __name__=='__main__':
    import argparse
    ap=argparse.ArgumentParser();ap.add_argument('--project',type=Path,required=True);ap.add_argument('--out',type=Path,required=True);a=ap.parse_args()
    write(a.out,snapshot(a.project));print('Semantic snapshot written')
