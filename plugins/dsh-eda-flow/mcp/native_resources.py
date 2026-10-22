import record_io
"""Native library snapshots. Never reconstruct symbol geometry from model output."""
import copy, hashlib, json, re
from pathlib import Path
from design_audit import child, children, library_path, lookup
from evidence_symbols import build as evidence_symbol

class Atom(str):
    pass

def parse(text):
    stack=[]; roots=[]
    for token in re.findall(r'"(?:\\.|[^"\\])*"|[()]|[^\s()]+',text):
        if token=='(':
            row=[]; (stack[-1] if stack else roots).append(row); stack.append(row)
        elif token==')':
            if not stack: raise ValueError('Unbalanced S expression')
            stack.pop()
        else:
            if not stack: raise ValueError('Unexpected token')
            stack[-1].append(json.loads(token) if token.startswith('"') else Atom(token))
    if stack or len(roots)!=1: raise ValueError('Invalid S expression')
    return roots[0]

def dump(value):
    if isinstance(value,list): return '('+' '.join(dump(x) for x in value)+')'
    if isinstance(value,Atom): return str(value)
    return json.dumps(value,ensure_ascii=False)

def sha(text): return hashlib.sha256(text.encode('utf8')).hexdigest()

def policy(req):
    file=req.get('catalogFile')
    if not file: return {'mode':'configured-library-root','symbols':None,'footprints':None}
    data=record_io.read_json(file)
    if data.get('schema')!=1 or any(not isinstance(data.get(k),list) for k in ('symbols','footprints')): raise ValueError('Invalid catalog: schema=1, symbols and footprints arrays required')
    return {**data,'mode':'allowlist','sha256':sha(Path(file).read_text(encoding='utf8'))}

def permitted(pol,kind,ident):
    ids=pol.get('symbols' if kind=='symbol' else 'footprints')
    if ids is not None and ident not in ids: raise ValueError('Outside approved catalog: '+ident)

def query(req):
    root=Path(req['libraryRoot']); pol=policy(req); kind=req['kind']; ident=req['query']
    if kind=='symbol' and ident.startswith('Evidence:'):
        permitted(pol,'symbol',ident)
        data=evidence_symbol(ident,req.get('mockEvidence',[]),root)
        return {k:v for k,v in data.items() if k!='native'}
    if kind=='search':
        # Filter BEFORE truncation: allowlisted hits must not be hidden behind public matches.
        if pol['mode']=='allowlist':
            rows=[{'kind':k,'id':s} for k,key in [('symbol','symbols'),('footprint','footprints')] for s in pol[key] if ident.casefold() in s.casefold()]
            return {'matches':rows[:60],'total':len(rows),'truncated':len(rows)>60,'policy':pol['mode']}
        return {**lookup(root,kind,ident),'policy':pol['mode']}
    permitted(pol,kind,ident)
    if kind=='symbol':
        data=symbol(root,ident)
        return {k:v for k,v in data.items() if k!='native'}
    return lookup(root,kind,ident)

def symbol(root,ident):
    file,name=library_path(root,ident,'symbol'); source=file.read_text(encoding='utf8'); ast=parse(source)
    definitions={s[1]:s for s in children(ast,'symbol')}
    def resolve(n,seen):
        if n in seen: raise ValueError('Library inheritance cycle')
        row=copy.deepcopy(definitions[n]); ext=child(row,'extends')
        if not ext: return row
        base=resolve(ext[1],seen|{n}); own=[x for x in row[2:] if not isinstance(x,list) or x[0]!='extends']
        propnames={x[1] for x in children(own,'property')}; keys={x[0] for x in own if isinstance(x,list) and x[0] not in ('property','symbol')}
        inherited=[x for x in base[2:] if not isinstance(x,list) or (x[0] not in keys and not (x[0]=='property' and x[1] in propnames))]
        return [Atom('symbol'),name]+inherited+own
    row=resolve(name,set()); row[1]=ident
    if child(row,'power') is not None: raise ValueError('Use named nets and supplied_nets instead of implicit power symbols: '+ident)
    pins=[]
    for unit in children(row,'symbol'):
        suffix=re.search(r'_(\d+)_(\d+)$',unit[1])
        if not suffix or int(suffix[1])>1 or int(suffix[2])>1: raise ValueError('Multi-unit / alternate body styles not supported yet: '+ident)
        unit[1]=name+'_'+suffix[1]+'_'+suffix[2]
        for g in unit[2:]:
            if not isinstance(g,list) or g[0] not in ('pin','rectangle','polyline','arc','circle','text'): raise ValueError('Unsupported symbol primitive: '+ident)
            if g[0]=='pin':
                if 'hide' in g or child(g,'hide') is not None and child(g,'hide')[1:]!=['no']: raise ValueError('Hidden pins require explicit support: '+ident)
                at=child(g,'at')
                if float(at[3])%90: raise ValueError('Non-orthogonal pin: '+ident)
                pins.append({'number':child(g,'number')[1],'name':child(g,'name')[1],'type':str(g[1]),'pad':child(g,'number')[1]})
    if not pins or len({p['number'] for p in pins})!=len(pins): raise ValueError('Missing/stacked pins not supported: '+ident)
    props={p[1]:p[2] for p in children(row,'property')}
    return {'id':ident,'kind':'symbol','sha256':sha(source),'native':dump(row),'pins':pins,'footprint':props.get('Footprint',''),'datasheet':props.get('Datasheet',''),'description':props.get('Description',''),'capability':'single-unit, explicit orthogonal pins, original native graphics'}

def snapshot(req,design):
    if req.get('mockEvidence') and design.get('blockInstances'):raise ValueError('Mock specification flow forbids frozen CAD block inputs')
    root=Path(req['libraryRoot']); pol=policy(req); symbols={}; footprints={}; components=design['components']
    for c in components:
        ident=c['librarySymbol']; permitted(pol,'symbol',ident)
        if ident not in symbols: symbols[ident]=evidence_symbol(ident,req.get('mockEvidence',[]),root) if ident.startswith('Evidence:') else symbol(root,ident)
        trip=lambda ps:sorted((p['number'],p['name'],p['type'],p['pad']) for p in ps)
        if trip(symbols[ident]['pins'])!=trip(c['pins']): raise ValueError(c['ref']+': pins differ from native library')
        fp=c['footprint']
        if c['on_board'] and not fp and not req.get('mockEvidence'): raise ValueError(c['ref']+': on-board component requires a verified footprint before freeze')
        if fp:
            permitted(pol,'footprint',fp)
            if fp not in footprints:
                file,_=library_path(root,fp,'footprint'); data=lookup(root,'footprint',fp)
                footprints[fp]={**data,'native':file.read_text(encoding='utf8')}
            if {p['pad'] for p in c['pins']}!={p['number'] for p in footprints[fp]['pads']}: raise ValueError(c['ref']+': footprint pad mapping mismatch')
    blocks=[];used=set(); netof={key:n['name'] for n in design['nets'] for key in n['nodes']}
    blockroot=Path(__file__).parent.parent/'libraries'/'blocks'
    for inst in design.get('blockInstances',[]):
        if set(inst)!={'blockId','version','bindings','netBindings'} or not re.fullmatch(r'[a-z0-9-]+',inst['blockId']):raise ValueError('Invalid block instance')
        block=json.loads((blockroot/(inst['blockId']+'.json')).read_text(encoding='utf8'))
        if inst['version']!=block['version']:raise ValueError('Design block version mismatch')
        bindings=inst['bindings'];nets=inst['netBindings'];bdesign=block['design'];brefs={c['ref'] for c in bdesign['components']}
        if set(bindings)!=brefs or len(set(bindings.values()))!=len(bindings) or used.intersection(bindings.values()):raise ValueError('Invalid or overlapping block bindings')
        if set(nets)!={n['name'] for n in bdesign['nets']} or len(set(nets.values()))!=len(nets):raise ValueError('Block network binding merges distinct nets')
        used.update(bindings.values())
        for bc in bdesign['components']:
            dc=next((c for c in components if c['ref']==bindings[bc['ref']]),None)
            if dc is None or any(dc.get(k)!=bc[k] for k in ('librarySymbol','footprint','value','mpn','pins','dnp','in_bom','on_board')):raise ValueError('Block material or pin definition changed')
        for n in bdesign['nets']:
            for key in n['nodes']:
                r,p=key.rsplit('.',1)
                if netof.get(bindings[r]+'.'+p)!=nets[n['name']]:raise ValueError('Block electrical topology changed')
        for key in bdesign['nc']:
            r,p=key.rsplit('.',1)
            if bindings[r]+'.'+p not in design['nc']:raise ValueError('Block NC changed')
        fragment=(blockroot/block['fragment']).resolve()
        if not fragment.is_relative_to(blockroot.resolve()):raise ValueError('Block path escapes library')
        native=fragment.read_text(encoding='utf8')
        if sha(native)!=block['fragmentSha256']:raise ValueError('Design block fragment changed')
        ast=parse(native)
        for s in children(child(ast,'lib_symbols',[]),'symbol'):
            if s[1] not in symbols or s!=parse(symbols[s[1]]['native']):raise ValueError('Block uses different symbol revision: '+s[1])
        blocks.append({**inst,'native':native,'width':block['width'],'height':block['height'],'origin':block['origin'],'validation':block['validation'],'limitations':block['limitations']})
    return {'title':req.get('title','Circuit design'),'schema':2,'kind':'native-kicad','policy':pol,'symbols':symbols,'footprints':footprints,'components':components,'blocks':blocks,'mockEvidence':req.get('mockEvidence',[]),'deferredFootprints':[c['ref'] for c in components if c['on_board'] and not c['footprint']],'scope':'Schematic only; mock sources retain simulated markers. Missing footprints are deferred, never manufacturing-ready.' if req.get('mockEvidence') else 'Library and pad identity, not manufacturer ratings or production qualification'}
