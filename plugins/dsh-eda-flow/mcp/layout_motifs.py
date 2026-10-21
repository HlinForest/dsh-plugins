"""Reviewed motif recognition and rendering; no reference-specific dispatch."""
import sys
sys.dont_write_bytecode=True
import json,math,copy,subprocess,collections,hashlib
from pathlib import Path
ROOT=Path(__file__).parent
def dump(p,x):p.write_text(json.dumps(x,ensure_ascii=False,indent=2),encoding='utf8')
from wiring_policy import SERIES_GAP, TERMINAL_STUB, ARRAY_STUB
import precise_mcp as pm
import fixed_components as fc
import functional_layout as geom

def read(p): return json.loads(p.read_text(encoding='utf8'))
def pt(p): return [round(v,4) for v in p[:2]]
lib={};circuit={};parts={};netof={};netnodes={}

class Block:
    def __init__(self,name): self.name=name;self.items={};self.symbols={};self.comps={};self.routes=[];self.counter=0
    def add(self,d):
        if 'id' not in d: self.counter+=1;d['id']=f'{self.name}-{self.counter}'
        self.items[d['id']]=d
        return d
    def place(self,ref,at,angle=0):
        s,c=fc.place(parts[ref],{'at':[*at,angle]});self.symbols[s['name']]=s;self.comps[ref]=c;self.add(c)
        return c
    def pin(self,key):
        ref,num=key.rsplit('.',1);c=self.comps[ref];s=self.symbols[c['symbol']]
        return list(geom.world(c,next(p['at'] for p in s['pins'] if p['number']==num)))
    def anchor(self,ref,num,at,angle=0):
        c=self.place(ref,[0,0],angle);p=self.pin(ref+'.'+str(num));geom.shift(c,at[0]-p[0],at[1]-p[1]);return c
    def field(self,ref,positions):
        c=self.comps[ref]
        for p in c['properties']:
            if p['visible'] and p['value']:
                loc=positions.get(p['name'])
                if loc:
                    p['at']=[*loc,0]
                    p['font']['justify']=['right','top'] if c['at'][2] in (90,180) else ['left','bottom']
    def wire(self,net,*points):
        points=[pt(p) for p in points]
        for a,b in zip(points,points[1:]):
            if a==b:continue
            assert a[0]==b[0] or a[1]==b[1],(net,a,b)
            self.routes.append((net,a,b))
    def connect(self,a,b):
        assert netof[a]==netof[b],(a,b)
        self.wire(netof[a],self.pin(a),self.pin(b))
    def label(self,net,at,angle=0):
        self.add({'kind':'label','text':net,'at':[*pt(at),angle],
                  'font':{'size':[1.1,1.1],'justify':['left','bottom']}})
    def stub(self,key,length=5.08):
        ref,num=key.rsplit('.',1);c=self.comps[ref];s=self.symbols[c['symbol']]
        p=next(p for p in s['pins'] if p['number']==num);a=math.radians(p['at'][2]+c['at'][2]);d=[-round(math.cos(a)),round(math.sin(a))]
        start=self.pin(key);end=pt([start[0]+d[0]*length,start[1]+d[1]*length])
        self.wire(netof[key],start,end)
        self.label(netof[key],end,90 if d[1] else 0)
    def finish(self):
        segs=collections.defaultdict(set)
        for net,a,b in self.routes:segs[net].add(tuple(sorted((tuple(a),tuple(b)))))
        for net,ss in segs.items():
            for a,b in sorted(ss):self.add({'kind':'wire','points':[list(a),list(b)],'width':.18})
            for p in {p for s in ss for p in s}:
                dirs=set()
                for a,b in ss:
                    if geom.on(p,a,b):
                        for q in (a,b):
                            if p!=q:dirs.add((0 if p[0]==q[0] else int(math.copysign(1,q[0]-p[0])),0 if p[1]==q[1] else int(math.copysign(1,q[1]-p[1]))))
                if len(dirs)>2:self.add({'kind':'junction','at':list(p),'diameter':.7})
        pts=[]
        for item in self.items.values():
            if item['kind']=='component':
                b=geom.part_bounds(item,self.symbols[item['symbol']]);pts.extend([b[:2],b[2:]])
            elif item['kind']=='label':
                x,y=item['at'][:2];w=len(item['text'])*1.1
                pts.extend([[x-2,y-w-2],[x+2,y+2]] if item['at'][2] else [[x-1,y-3],[x+w+1,y+1]])
            elif 'points' in item:pts.extend(item['points'])
            elif 'at' in item:pts.append(item['at'][:2])
        b=geom.grow(geom.bounds(pts),3.81);self.bounds=b
        return {'id':self.name,'width':b[2]-b[0],'height':b[3]-b[1]}

def recognize(library,design):
    from topology_motifs import model,fixed_kind,find_match
    host=model(library['objects'],design,fixed_kind);used=set();matches=[]
    templates=[read(p) for p in sorted((ROOT.parent/'libraries'/'motifs').glob('*.json'))]
    # Large local structures first; each instance consumes disjoint components.
    for t in sorted(templates,key=lambda t:(-len(t['pattern']['parts']),t['id'])):
        while True:
            m=find_match(t['pattern'],host,used)
            if not m:break
            used.update(m['bindings'].values());matches.append((t,m))
    if used!=set(host['parts']):
        raise ValueError('No reviewed fixed-symbol motif for: '+', '.join(sorted(set(host['parts'])-used))+'. Use native generic layout or add a reviewed template; electrical input was not changed.')
    return sorted(matches,key=lambda x:(x[0]['row'],x[0]['order'],sorted(x[1]['bindings'].values())))

def obligations(library,design):
    result=[]
    for t,m in recognize(library,design):
        for group in t['required']:
            result.append([m['bindings'][k.rsplit('.',1)[0]]+'.'+k.rsplit('.',1)[1] for k in group])
    return result

def generate(library, design, out, gap=5.08, node='node'):
    global lib,circuit,parts,netof,netnodes
    lib=library;circuit=design;parts={c['ref']:c for c in lib['objects']}
    netof={k:n['name'] for n in circuit['nets'] for k in n['nodes']}
    netnodes={n['name']:set(n['nodes']) for n in circuit['nets']}
    out.mkdir(parents=True,exist_ok=True);blocks=[];matches=recognize(library,design);rows={}
    for index,(t,m) in enumerate(matches):
        b=Block('motif'+str(index));rows.setdefault(t['row'],[]).append(b.name)
        for source in t['items']:
            item=copy.deepcopy(source)
            if item['kind']=='component':
                ref=m['bindings'][item['reference']];c=b.place(ref,item['at'][:2],item['at'][2])
                for prop in c['properties']:
                    f=item['fields'].get(prop['name'])
                    if f:
                        # Only geometry/justification is transferred. All field values,
                        # visibility, font sizes and flags remain frozen-library owned.
                        prop['at']=f['at'];prop['font']['justify']=f['font'].get('justify',[])
            else:
                if item['kind']=='label':item['text']=m['netBindings'][item['text']]
                b.add(item)
        blocks.append(b)
    dump(out/'motif-recognition.json',{'matches':[{'template':t['id'],**m} for t,m in matches],'unmatched':[]})
    refs=[r for b in blocks for r in b.comps];assert len(refs)==len(set(refs)) and set(refs)==set(parts)
    job={'gap':gap,'blocks':[b.finish() for b in blocks],'rows':[rows[k] for k in sorted(rows)]};dump(out/'elk-input.json',job)
    subprocess.run([node,str(ROOT/'pack_motifs.cjs'),str(out/'elk-input.json'),str(out/'elk-output.json')],check=True)
    packed=read(out/'elk-output.json');state={'uuid':'e27b90b3-6687-4aa0-bc93-086cc26f10d5','items':{},'symbols':{},'revision':1};state['name']='DisplayBoard_ELK_A4';state['title']='Frozen circuit - A4 / reviewed motifs + ELK'
    positions={};rowpos={r['id']:r for r in packed['page']['children']}
    for row in packed['rows']:
        rp=rowpos[row['id']]
        # Target image explicitly aligns the lower three blocks toward the right.
        right_align=max(r['width'] for r in packed['rows'])-row['width'] if row['id']=='row1' else 0
        for n in row['children']:positions[n['id']]=[rp['x']+n['x']+right_align,rp['y']+n['y']]
    boxes=[]
    for b in blocks:
        px,py=positions[b.name];dx=round((px+12.7-b.bounds[0])/1.27)*1.27;dy=round((py+10.16-b.bounds[1])/1.27)*1.27
        boxes.append({'id':b.name,'bounds':pt([b.bounds[0]+dx,b.bounds[1]+dy])+pt([b.bounds[2]+dx,b.bounds[3]+dy])})
        for item in b.items.values():
            if item['kind']=='component':geom.shift(item,dx,dy)
            elif 'points' in item:item['points']=[pt([p[0]+dx,p[1]+dy]) for p in item['points']]
            elif 'at' in item:item['at'][:2]=pt([item['at'][0]+dx,item['at'][1]+dy])
            state['items'][item['id']]=item
        state['symbols'].update(b.symbols)
    # Retain the same existing ERC supply declaration; no pin types changed.
    for i,net in enumerate(circuit['supplied_nets']):
        key=next(n['nodes'][0] for n in circuit['nets'] if n['name']==net);block=next(b for b in blocks if key.rsplit('.',1)[0] in b.comps);pos=block.pin(key);ref=f'#PWR{i+1:02}'
        state['symbols']['SupplyDeclaration']={'name':'SupplyDeclaration','pins':[{'number':'1','name':'~','at':[0,0,0],'length':0,'type':'power_out'}],'pin_names_visible':False,'pin_numbers_visible':False}
        state['items']['supply-'+net]={'id':'supply-'+net,'kind':'component','symbol':'SupplyDeclaration','reference':ref,'value':'SUPPLIED','at':pos+[0],'in_bom':False,'on_board':False,
            'properties':[{'name':k,'value':v,'at':pos,'visible':False} for k,v in [('Role','ERCHelper'),('Reference',ref),('Value','SUPPLIED'),('Footprint',''),('Datasheet','')]]}
    state.pop('page_size_mm',None);state['paper']='A4';state['portrait']=False
    errors=fc.check_frozen(state,lib,True);assert not errors,errors
    dump(out/'state.json',state);dump(out/'generation.json',{'engine':'elkjs 0.12.0 Box','gap':gap,'blocks':boxes,'freeze_errors':errors,'circuit_sha256':hashlib.sha256(json.dumps(circuit,sort_keys=True).encode()).hexdigest(),
        'scope':'Reference-independent reviewed topology motif matching. Rigid local geometry plus ELK macro packing. Unmatched fixed-symbol structures fail explicitly.'})
    (out/(state['name']+'.kicad_sch')).write_text(pm.render(state),encoding='utf8')
    (out/'Precise.kicad_sym').write_text('(kicad_symbol_lib (version 20241209) (generator "experiment") '+ '\n'.join(pm.symbol_definition(s,False) for s in state['symbols'].values())+')',encoding='utf8')
    dump(out/(state['name']+'.kicad_pro'),{'meta':{'filename':state['name']+'.kicad_pro','version':1},'net_settings':{'classes':[]}})
    (out/'sym-lib-table').write_text('(sym_lib_table (version 7) (lib (name "Precise") (type "KiCad") (uri "${KIPRJMOD}/Precise.kicad_sym") (options "") (descr "Frozen symbols")))',encoding='utf8')
    return state
