"""Independent comparison. Only this verification entry point reads the baseline."""
import argparse, copy, math, xml.etree.ElementTree as ET
from common import *

def token(x):return json.dumps(x,ensure_ascii=False,sort_keys=True,separators=(',',':'))
def compare(a,b):
    aa=collections.Counter(token(v) for v in a);bb=collections.Counter(token(v) for v in b)
    return {'equal':aa==bb,'baseline_count':sum(aa.values()),'generated_count':sum(bb.values()),
            'baseline_only':[json.loads(k) for k in (aa-bb).elements()],
            'generated_only':[json.loads(k) for k in (bb-aa).elements()]}

def project(root):
    sch=sx.loads(next(root.glob('*.kicad_sch')).read_text(encoding='utf-8'))
    pcb=sx.loads(next(root.glob('*.kicad_pcb')).read_text(encoding='utf-8'))
    symbols={prop(s)['Reference']:s for s in children(sch,'symbol')}
    libs={str(child(s,'lib_id')[1]):ref for ref,s in symbols.items()}
    identities={str(child(sch,'uuid')[1]):'schematic-root'}
    for ref,s in symbols.items():identities[str(child(s,'uuid')[1])]='symbol:'+ref
    fplibs={};models={};associations=[];dependencies=[]
    for fp in children(pcb,'footprint'):
        ref=prop(fp).get('Reference','');fplibs[str(fp[1])]='footprint:'+ref if ref else 'auxiliary-footprint'
        path=child(fp,'path')
        if ref:
            expected='/'+str(child(sch,'uuid')[1])+'/'+str(child(symbols[ref],'uuid')[1]) if ref in symbols else None
            associations.append({'ref':ref,'valid':bool(path and path[1]==expected)})
        for model in children(fp,'model'):
            path=root/str(model[1]).replace('${KIPRJMOD}/','');exists=path.is_file()
            models[str(model[1])]='model-sha256:'+digest(path) if exists else 'MISSING:'+str(model[1])
            dependencies.append({'model':str(model[1]),'exists':exists,'sha256':digest(path) if exists else None})
        path=root/(str(fp[1]).split(':')[0]+'.pretty')/(str(fp[1]).split(':')[-1]+'.kicad_mod')
        dependencies.append({'footprint':str(fp[1]),'exists':path.is_file()})
    for ref,s in symbols.items():
        fp=prop(s).get('Footprint','')
        if fp:fplibs[fp]='footprint:'+ref
    # IDs used by other records resolve to their owning object, never to a wildcard.
    for tree in [sch,pcb]:
        for item in walk(tree):
            ident=child(item,'uuid')
            if ident and ident[1] not in identities:identities[str(ident[1])]='object:'+object_key(item)
    def normalize(x,parent=''):
        if not isinstance(x,list):
            if isinstance(x,(sx.Symbol,str)):
                s=str(x)
                if s in libs:return 'library-symbol:'+libs[s]
                if s in fplibs:return fplibs[s]
                if s in models:return models[s]
                return re.sub(r'[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}',lambda m:'<'+identities.get(m[0],'UNRESOLVED:'+m[0])+'>',s)
            if isinstance(x,(int,float)):
                v=round(x,6);return int(v) if v==int(v) else v
            return x
        t=tag(x)
        if t in {'uuid','tstamp','generator','generator_version'}:return None
        if t in {'sheetfile','sheetname'}:return [t,'<current-project>']
        if t=='project':x=[x[0],'<current-project>',*x[2:]]
        if t=='hide':return ['hide','yes']
        values=[normalize(v,t) for v in x[1:]];values=[v for v in values if v is not None]
        if t in {'effects','pin_names','pin_numbers'}:values=[['hide','yes'] if v=='hide' else v for v in values]
        if t=='symbol' and values and isinstance(values[0],str) and re.search(r'_\d_\d$',values[0]):values[0]='unit'+values[0][-4:]
        # Closed polygon start vertex is arbitrary; retain every vertex and winding alternatives.
        if t=='pts' and parent in {'polyline','polygon','filled_polygon','gr_poly'} and len(values)>2 and values[0]==values[-1]:
            pts=values[:-1];candidates=[]
            for seq in (pts,list(reversed(pts))):
                for i in range(len(seq)):candidates.append(seq[i:]+seq[:i])
            values=min(candidates,key=token);values=values+[values[0]]
        if t in {'symbol','footprint','lib_symbols','effects','font','property','pad'}:
            values=[v for v in values if not isinstance(v,list)]+sorted((v for v in values if isinstance(v,list)),key=token)
        return [t]+values
    ids=[]
    def collect(x,parent=None):
        if not isinstance(x,list):return
        if tag(x)=='uuid':
            if x[1]!=parent:ids.append(str(x[1]))
            return
        dim=child(x,'uuid') if tag(x)=='dimension' else None
        for v in x:collect(v,dim[1] if dim and tag(v)=='gr_text' else parent)
    collect(sch);collect(pcb)
    assert len(ids)==len(set(ids)),'Duplicate object UUIDs in '+str(root)
    def normalize_lib(tree):
        tree=copy.deepcopy(tree)
        if tag(tree)=='kicad_symbol_lib':
            prefix=next(root.glob('*.kicad_sym')).stem
            for s in children(tree,'symbol'):s[1]=prefix+':'+str(s[1])
        elif tag(tree)=='footprint':
            prefix=next(root.glob('*.pretty')).stem;tree[1]=prefix+':'+str(tree[1])
        return normalize(tree)
    symfile=next(root.glob('*.kicad_sym'));symlib=sx.loads(symfile.read_text(encoding='utf-8'))
    symlib_normal=normalize_lib(symlib)
    library_symbols=[v for v in symlib_normal[1:] if isinstance(v,list) and v[0]=='symbol']
    embedded_symbols=[normalize(v) for v in child(sch,'lib_symbols')[1:]]
    assert compare(library_symbols,embedded_symbols)['equal'],'External symbol library differs from embedded symbols'
    footprint_library=[normalize_lib(sx.loads(p.read_text(encoding='utf-8'))) for p in next(root.glob('*.pretty')).glob('*.kicad_mod')]
    return {'sch':sch,'pcb':pcb,'normalize':normalize,'associations':associations,'dependencies':dependencies,'symbols':symbols,
            'symbol_library':library_symbols,'footprint_library':footprint_library}

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--baseline',type=Path,required=True);ap.add_argument('--project',type=Path,required=True);ap.add_argument('--out',type=Path,required=True);a=ap.parse_args()
    old=project(a.baseline);new=project(a.project);results={}
    def bom(root):
        file=next(root.glob('BOM_*.csv'))
        with file.open(encoding='utf-8-sig',newline='') as f:rows=list(csv.DictReader(f))
        return [[r.get('原位号',r.get('位号')),1,r.get('原值字符串',r.get('值')),r.get('原封装名称',r.get('原理图原封装')),
                 *[r.get(k,'') for k in ['物料编码','物料描述','优选等级','装配类型']]] for r in rows]
    results['bom/per_reference']=compare(bom(a.baseline),bom(a.project))
    results['library/symbols']=compare(old['symbol_library'],new['symbol_library'])
    results['library/footprints']=compare(old['footprint_library'],new['footprint_library'])
    for doc in ['sch','pcb']:
        tags=sorted(set(tag(v) for v in old[doc][1:]+new[doc][1:]) - {'generator','generator_version','version','uuid','embedded_fonts'})
        for t in tags:
            results[doc+'/'+t]=compare([old['normalize'](v) for v in children(old[doc],t)],[new['normalize'](v) for v in children(new[doc],t)])
    # Per-reference split distinguishes visible shapes, physical properties, and source metadata.
    for doc,t in [('pcb','footprint'),('sch','symbol')]:
        aa={prop(v).get('Reference',''):v for v in children(old[doc],t) if prop(v).get('Reference','')}
        bb={prop(v).get('Reference',''):v for v in children(new[doc],t) if prop(v).get('Reference','')}
        for ref in sorted(set(aa)|set(bb)):
            av=aa.get(ref,[]);bv=bb.get(ref,[])
            for kind in sorted(set(tag(v) for v in av[2:]+bv[2:]) - {'uuid'}):
                result=compare([old['normalize'](v) for v in children(av,kind)],[new['normalize'](v) for v in children(bv,kind)])
                if not result['equal']:results[f'detail/{doc}/{ref}/{kind}']=result
    assoc=old['associations']+new['associations'];deps=old['dependencies']+new['dependencies']
    def project_settings(root):
        data=json.loads(next(root.glob('*.kicad_pro')).read_text(encoding='utf-8'));data.get('meta',{}).pop('filename',None);return data
    results['project/settings']=compare([project_settings(a.baseline)],[project_settings(a.project)])
    def custom_rules(root):
        def norm(x):
            if isinstance(x,list):
                if tag(x)=='rule':return ['rule','<rule-display-name>',*[norm(v) for v in x[2:]]]
                return [norm(v) for v in x]
            s=str(x);m=re.fullmatch(r'([0-9.]+)(mil|mm)',s)
            return round(float(m[1])*(.0254 if m[2]=='mil' else 1),9) if m else s
        content=next(root.glob('*.kicad_dru')).read_text(encoding='utf-8')
        content='\n'.join(line for line in content.splitlines() if not line.lstrip().startswith('#'))
        return [norm(v) for v in sx.parse(content)]
    results['project/custom_rules']=compare(custom_rules(a.baseline),custom_rules(a.project))
    results['library/models']=compare([digest(p) for p in (a.baseline/'models').glob('*') if p.suffix.lower() in {'.step','.stp'}],[digest(p) for p in (a.project/'models').glob('*') if p.suffix.lower() in {'.step','.stp'}])
    output={'baseline':str(a.baseline),'generated':str(a.project),'comparisons':results,
        'association_checks':{'equal':all(v['valid'] for v in assoc),'baseline':old['associations'],'generated':new['associations']},
        'dependencies':{'equal':all(v['exists'] for v in deps),'baseline':old['dependencies'],'generated':new['dependencies']},
        'normalization':'Runtime generator/schema names and project/library renaming normalized. UUID references resolve to owning objects. Numbers rounded to 1 nm; polygon cyclic start and winding normalized, vertices retained. Geometry and metadata differences remain explicit.'}
    write(a.out,output)
    print(json.dumps({'matched_categories':[k for k,v in results.items() if v['equal']],'different_categories':{k:[len(v['baseline_only']),len(v['generated_only'])] for k,v in results.items() if not v['equal']},'associations':output['association_checks']['equal'],'dependencies':output['dependencies']['equal']},ensure_ascii=False))

if __name__=='__main__':main()
