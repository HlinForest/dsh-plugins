"""Single-sheet native KiCad compiler, with ELK routing and independent read-back gates."""
import sys
sys.dont_write_bytecode=True
import collections, copy, csv, json, math, subprocess, uuid, os, itertools, re
from datetime import date
from pathlib import Path
import xml.etree.ElementTree as ET
from wiring_policy import label_reserve, layer_spacing
import native_resources as nr
from design_audit import child, children
from native_schematic import parse as read_native
import functional_layout as geom
import fixed_components as fc
from controlled_layout import export

A=nr.Atom
def io_path(p):
    """Use extended Windows paths for nested workflow evidence as well as CAD."""
    p=os.path.abspath(p)
    if os.name=='nt' and not p.startswith('\\\\?\\'):
        p='\\\\?\\UNC\\'+p[2:] if p.startswith('\\\\') else '\\\\?\\'+p
    return Path(p)
def read(p): return json.loads(io_path(p).read_text(encoding='utf8'))
def write(p,v):
    p=io_path(p);p.parent.mkdir(parents=True,exist_ok=True)
    p.write_text(json.dumps(v,ensure_ascii=False,indent=2),encoding='utf8')
def uid(): return str(uuid.uuid4())
def form(key,*args): return [A(key),*args]
def snap(x): return round(round(float(x)/1.27)*1.27,4)

def number(x): return A(str(round(float(x),4)))
def at(x,y,angle=None): return form('at',number(x),number(y),*([number(angle)] if angle is not None else []))
def replace(row,key,value):
    for i,x in enumerate(row):
        if isinstance(x,list) and x[0]==key: row[i]=value;return
    row.append(value)

HELPER='(symbol "Host:SupplyDeclaration" (pin_names hide) (pin_numbers hide) (in_bom no) (on_board no) (symbol "SupplyDeclaration_1_1" (pin power_out line (at 0 0 0) (length 0) (name "~" (effects (font (size 1.27 1.27)))) (number "1" (effects (font (size 1.27 1.27)))))))'

def pack_groups(groups,width,height,gap,row_breaks=()):
    """Prefer aligned reading rows; retain bounded packing for tight pages."""
    boxes=[{'id':g['id'],'width':p['width'],'height':p['height']} for g,p in groups]
    if not boxes:return {'width':0,'height':0,'children':[]}
    # Minimize occupied height over contiguous rows in the requested order.
    # A shortest-column placement scatters later groups into unrelated gaps.
    rows=[(0,[])]
    for end in range(1,len(boxes)+1):
        candidates=[]
        for start in range(end):
            if any(start<b<end for b in row_breaks):continue
            row=boxes[start:end]
            if rows[start] is None or sum(b['width'] for b in row)+gap*(len(row)-1)>width:continue
            old,prior=rows[start]
            candidates.append((old+(gap if start else 0)+max(b['height'] for b in row),prior+[row]))
        rows.append(min(candidates,key=lambda v:(round(v[0],4),tuple(-len(row) for row in v[1]))) if candidates else None)
    if rows[-1] is not None and rows[-1][0]<=height:
        placed=[];y=0;used_width=0
        for row in rows[-1][1]:
            x=0
            for box in row:
                placed.append({**box,'x':x,'y':y});x+=box['width']+gap
            used_width=max(used_width,x-gap)
            y+=max(b['height'] for b in row)+gap
        return {'width':used_width,'height':rows[-1][0],'children':placed}
    if row_breaks:return None
    rank={b['id']:i for i,b in enumerate(boxes)}
    orders=itertools.islice(itertools.permutations(boxes),10000) if len(boxes)<=8 else [sorted(boxes,key=lambda b:-b['height']),boxes]
    best=None
    for order in orders:
        placed=[]
        for box in order:
            options=[]
            for y in sorted({0,*[p['y']+p['height']+gap for p in placed]}):
                for x in sorted({0,*[p['x']+p['width']+gap for p in placed]}):
                    if x+box['width']>width or y+box['height']>height:continue
                    if any(x<p['x']+p['width']+gap-.001 and x+box['width']+gap>p['x']+.001 and y<p['y']+p['height']+gap-.001 and y+box['height']+gap>p['y']+.001 for p in placed):continue
                    if any(((y,x)<(p['y'],p['x'])) != (rank[box['id']]<rank[p['id']]) for p in placed):continue
                    options.append((y,x))
            if not options:break
            y,x=min(options);placed.append({**box,'x':x,'y':y})
        else:
            w=max(p['x']+p['width'] for p in placed);h=max(p['y']+p['height'] for p in placed)
            by_id={p['id']:p for p in placed}
            score=tuple((by_id[b['id']]['y'],by_id[b['id']]['x']) for b in boxes)+(h,w)
            if best is None or score<best[0]:best=(score,{'width':w,'height':h,'children':placed})
    return best[1] if best else None

def validate(d):
    pins={c['ref']+'.'+p['number'] for c in d['components'] for p in c['pins']}
    members=[k for n in d['nets'] for k in n['nodes']]+d['nc']
    names=[n['name'] for n in d['nets']]
    if len(members)!=len(set(members)) or set(members)!=pins: raise ValueError('Every pin must belong to exactly one net or NC')
    if len(names)!=len(set(names)) or any(not n or n.startswith('/') or '${' in n or '\n' in n for n in names): raise ValueError('Single-sheet net names must be unique, literal and not start with /')
    if set(d.get('supplied_nets',[]))-set(names) or len(d.get('supplied_nets',[]))!=len(set(d.get('supplied_nets',[]))): raise ValueError('Invalid supplied_nets')
    group={k:i for i,n in enumerate(d['nets']) for k in n['nodes']};group.update({k:len(d['nets'])+i for i,k in enumerate(d['nc'])})
    for f in d.get('functions',[]):
        for c in f['checks']:
            gs=[group.get(k) for k in c['nodes']]
            if None in gs or not (len(set(gs))==1 if c['kind']=='connected' else len(set(gs))==len(gs)): raise ValueError('Function condition contradicts design: '+f['requirementId'])

def document(resources,instances,paper='A4',extras=None,rootid=None):
    return [A('kicad_sch'),form('version',A('20260101')),form('generator','dsh_controlled_native'),form('uuid',rootid or uid()),form('paper',paper),
            form('title_block',form('title',resources.get('title','Circuit design')),form('date',date.today().isoformat()),form('rev','1'),form('comment',A('1'),'Simulated specification input' if any(r.get('simulated') for r in resources.get('mockEvidence',[])) else 'Natural-language and PDF input')),
            form('lib_symbols',*[nr.parse(v['native']) for v in resources['symbols'].values()],*([nr.parse(HELPER)] if extras and any(x[0]=='symbol' for x in extras) else [])),*instances,*(extras or [])]

def instance(c,resource,x=0,y=0,rotation=0):
    s=nr.parse(resource['native']); properties=copy.deepcopy(children(s,'property')); values={'Reference':c['ref'],'Value':c['value'],'Footprint':c['footprint'],'MPN':c['mpn'],'DesignId':c['id']}
    values.update({field:c[key] for key,field in [('originalFootprint','OriginalFootprint'),('materialCode','MaterialCode'),('materialDescription','MaterialDescription'),('assemblyType','AssemblyType'),('objectRole','ObjectRole')] if key in c})
    for name,value in values.items():
        p=next((p for p in properties if p[1]==name),None)
        if p is None:
            p=form('property',name,value,at(0,0,0),form('effects',form('font',form('size',number(1.27),number(1.27))),*([form('hide',A('yes'))] if name not in ('Reference','Value') else [])));properties.append(p)
        p[2]=value
    return form('symbol',form('lib_id',c['librarySymbol']),at(x,y,rotation),form('unit',A('1')),form('in_bom',A('yes' if c['in_bom'] else 'no')),form('on_board',A('yes' if c['on_board'] else 'no')),form('dnp',A('yes' if c['dnp'] else 'no')),form('uuid',uid()),*properties)

def visible(p):
    hidden=lambda r: 'hide' in r or child(r,'hide') is not None and child(r,'hide')[1:]!=['no']
    return not hidden(p) and not hidden(child(p,'effects',[]))
def wire(a,b): return form('wire',form('pts',form('xy',number(a[0]),number(a[1])),form('xy',number(b[0]),number(b[1]))),form('stroke',form('width',number(.18)),form('type',A('default'))),form('uuid',uid()))
def connected_label_point(pos,direction,routes,preferred):
    distances=[]
    for a,b in routes:
        if not geom.on(pos,a,b):continue
        for q in (a,b):
            delta=[q[0]-pos[0],q[1]-pos[1]]
            along=delta[0]*direction[0]+delta[1]*direction[1]
            cross=delta[0]*direction[1]-delta[1]*direction[0]
            if along>0 and abs(cross)<.0001:distances.append(along)
    if not distances:raise ValueError('No outward wire supports net label at '+str(pos))
    distance=min(preferred,max(distances))
    return [round(pos[i]+direction[i]*distance,4) for i in (0,1)]

def split_wire_vertices(routes):
    """Materialize T connections; leave interior/interior crossings unconnected."""
    segments={tuple(sorted((tuple(a),tuple(b)))) for a,b in routes if a!=b}
    vertices={p for edge in segments for p in edge};result=set()
    for a,b in segments:
        points=sorted(p for p in vertices if geom.on(p,a,b))
        result.update(tuple(sorted((p,q))) for p,q in zip(points,points[1:]) if p!=q)
    return result

def supply_helpers(d):
    outputs={c['ref']+'.'+p['number'] for c in d['components'] for p in c['pins'] if p['type']=='power_out'}
    return {f'#PWR{i+1:02}':name for i,name in enumerate(d.get('supplied_nets',[])) if not outputs.intersection(next(n['nodes'] for n in d['nets'] if n['name']==name))}
def same_net_terminals(d):
    """A two-terminal part explicitly on one net uses two named stubs.
    Do not draw a misleading extra bypass loop around the fitted component.
    Both pins remain in the native netlist and independent topology audit.
    """
    netof={pin:n['name'] for n in d['nets'] for pin in n['nodes']}
    result=set()
    for c in d['components']:
        pins=[c['ref']+'.'+p['number'] for p in c['pins']]
        if len(pins)==2 and pins[0] in netof and netof.get(pins[1])==netof[pins[0]]:result.update(pins)
    return result
def label(name,p,d,angle=0):
    just='right' if d[0]<0 else 'left'
    return form('label',name,at(*p,angle),form('effects',form('font',form('size',number(1),number(1))),form('justify',A(just),A('bottom'))),form('uuid',uid()))

def required_visual_groups(d,resources):
    """Keep evidenced functional circuits intact instead of hiding wires in labels."""
    if not resources or not resources.get('mockEvidence'):return []
    comps={c['ref']:c for c in d['components']};same=same_net_terminals(d);result=[]
    kind=lambda c:resources['symbols'].get(c.get('librarySymbol'),{}).get('appearance',{}).get('kind')
    netof={p:n for n in d['nets'] for p in n['nodes']}
    for hub in d['components']:
        if len(hub['pins'])<=2:continue
        branches=set()
        for pin in hub['pins']:
            if pin['type']!='output':continue
            for key in netof.get(hub['ref']+'.'+pin['number'],{}).get('nodes',[]):
                ref=key.rsplit('.',1)[0];c=comps[ref]
                if len(c['pins'])==2 and kind(c) in ('specified-resistor','resistor') and key not in same:branches.add(ref)
        if len(branches)>=3:result.append({hub['ref'],*branches})
        if kind(hub) in ('specified-receiver','infrared-receiver'):
            adjacent=set()
            for pin in hub['pins']:
                if pin['name'].upper() in ('GND','VSS','SGND'):continue
                for key in netof.get(hub['ref']+'.'+pin['number'],{}).get('nodes',[]):
                    ref=key.rsplit('.',1)[0];c=comps[ref]
                    if len(c['pins'])==2 and kind(c) in ('specified-resistor','specified-capacitor','resistor','capacitor') and key not in same:adjacent.add(ref)
            if adjacent:result.append({hub['ref'],*adjacent})
    process={c['ref'] for c in d['components'] if c.get('objectRole')=='process'}
    if len(process)>1:result.append(process)
    return result

def normalize_layout(layout,d,resources=None):
    allowed={'template','paper','gapMm','groups','rotations'}
    if set(layout)-allowed or layout.get('template')!='generic-v1' or layout.get('paper') not in ('A4-landscape','A3-landscape'): raise ValueError('Invalid presentation-only layout')
    gap=layout.get('gapMm',7.62)
    if not isinstance(gap,(int,float)) or not 3.81<=gap<=25.4: raise ValueError('Invalid gapMm')
    refs=[c['ref'] for c in d['components']]
    groups=layout.get('groups')
    from functional_groups import groups as functional_groups
    suggested=functional_groups(d,resources or {})
    if not groups and suggested:groups=suggested
    if not groups:
        groups=[{'id':'block'+str(i),'title':b['blockId'],'references':list(b['bindings'].values())} for i,b in enumerate((resources or {}).get('blocks',d.get('blockInstances',[])))]
        used={r for g in groups for r in g['references']}
        if set(refs)-used:groups.append({'id':'circuit','title':'Circuit','references':[r for r in refs if r not in used]})
    if any(set(g)-{'id','title','references'} or not isinstance(g.get('id'),str) or not isinstance(g.get('title'),str) or not g.get('references') for g in groups): raise ValueError('Invalid visual groups')
    listed=[r for g in groups for r in g['references']]
    if len(set(g['id'] for g in groups))!=len(groups) or len(listed)!=len(set(listed)) or set(listed)!=set(refs): raise ValueError('Visual groups must cover every component exactly once')
    groupof={r:g['id'] for g in groups for r in g['references']}
    for circuit in required_visual_groups(d,resources):
        if len({groupof[r] for r in circuit})!=1:raise ValueError('Keep this functional circuit in one visual group; do not replace its wires with labels: '+', '.join(sorted(circuit)))
    for b in d.get('blockInstances',[]):
        if len({groupof[r] for r in b['bindings'].values()})!=1:raise ValueError('A frozen design block cannot be split across visual groups')
    connected=[{k.rsplit('.',1)[0] for k in n['nodes']} for n in d['nets'] if len({k.rsplit('.',1)[0] for k in n['nodes']})>1]
    if connected and not any(len({groupof[r] for r in rs})<len(rs) for rs in connected):raise ValueError('All-label layout rejected: keep a connected functional circuit together')
    rotations=layout.get('rotations',{})
    if set(rotations)-set(refs) or any(v not in (0,90,180,270) for v in rotations.values()): raise ValueError('Invalid component rotations')
    return {**layout,'gapMm':gap,'groups':groups,'rotations':rotations}

def elk(graph,out,name,node):
    ip=out/(name+'-input.json');op=out/(name+'-output.json');write(ip,graph)
    p=subprocess.run([node,str(Path(__file__).with_name('pack_generic.cjs')),str(ip),str(op)],capture_output=True,text=True,timeout=90)
    if p.returncode: raise ValueError('ELK: '+p.stderr[-2000:])
    result=read(op)
    if graph.get('layoutOptions',{}).get('elk.algorithm')=='layered' and graph.get('edges'):
        from constraint_placement import compact
        result=compact(result,graph.get("grid",1.27))
        write(ip,result)
        routed=subprocess.run([node,str(Path(__file__).with_name('route_avoid.mjs')),str(ip),str(op)],capture_output=True,text=True,timeout=90)
        if routed.returncode:raise ValueError('libavoid: '+routed.stderr[-2000:])
        result=read(op)
    return result

def generate(resources,d,out,layout,node):
    layout=normalize_layout(layout,d,resources); write(out/'layout-plan.json',layout)
    paper=layout['paper'].split('-')[0];size={'A4':(297,210),'A3':(420,297)}[paper]
    comps={c['ref']:c for c in d['components']}; parts={}; specs={}; pinmap={}; netof={k:n['name'] for n in d['nets'] for k in n['nodes']}
    named_returns=same_net_terminals(d)
    if any(s.get('drawingRules') for s in resources['symbols'].values()):
        named_returns |= {k for n in d['nets'] if re.fullmatch(r'(?:[ASDP]?GND|GROUND|0)',n['name'],re.I) for k in n['nodes']}
    localfile=out/'native-library-reference.txt'
    base=[instance(c,resources['symbols'][c['librarySymbol']],rotation=layout['rotations'].get(c['ref'],0)) for c in d['components']]
    localfile.write_text(nr.dump(document(resources,base,paper)),encoding='utf8');_,state=read_native(localfile)
    # Choose a placement grid compatible with every intrinsic pin coordinate.
    # Never snap a library pin independently from its symbol.
    quantum=12700
    locally_routed=set(); wired_pins=set()
    for group in layout['groups']:
        for net in d['nets']:
            members=[key for key in net['nodes'] if key.rsplit('.',1)[0] in group['references'] and key not in named_returns]
            if len(members)>1:
                locally_routed.update(key.rsplit('.',1)[0] for key in members);wired_pins.update(members)
    for component in d['components']:
        if component['ref'] not in locally_routed:continue
        for pin in state['symbols'][component['librarySymbol']]['pins']:
            for coordinate in pin['at'][:2]:quantum=math.gcd(quantum,abs(round(coordinate*10000)))
    step=quantum/10000 if quantum else 1.27
    snap=lambda value:round(round(float(value)/step)*step,4)
    # Include real pin extents and reserved fields/labels in each ELK obstacle.
    for c,raw in zip(d['components'],base):
        item=next(v for v in state['items'].values() if v.get('reference')==c['ref']);sym=state['symbols'][item['symbol']];ref=c['ref']
        b=geom.part_bounds(item,sym,False);props=children(raw,'property');shown=[p for p in props if visible(p) and p[2]]
        # Put fields to the right, below horizontal pins; vertical exits remain clear.
        fy=b[3]+5.08;fx=b[2]+2.54
        if len(sym['pins'])==2 and abs(b[3]-b[1])>abs(b[2]-b[0]):fy=-1.27
        for j,p in enumerate(shown):
            angle=layout['rotations'].get(ref,0)
            replace(p,'at',at(fx,fy+j*2.54,angle%180))
            justify=('right','top') if angle in (90,180) else ('left','bottom')
            eff=child(p,'effects');replace(eff,'justify',form('justify',*(A(v) for v in justify)))
        width=max([len(p[2])*1.15 for p in shown]+[0]); low=[min(b[0]-2.54,-2.54),b[1]-2.54];high=[max(b[2]+2.54,fx+width+2.54),max(b[3]+2.54,fy+len(shown)*2.54)]
        ports=[]
        for pin in sym['pins']:
            key=ref+'.'+pin['number'];pos=list(geom.world(item,pin['at']));angle=math.radians(pin['at'][2]+layout['rotations'].get(ref,0));direction=[-round(math.cos(angle)),round(math.sin(angle))]
            # Reserve a complete outward label inside the node for every terminal.
            textlen=3.81 if key in wired_pins else label_reserve(netof.get(key,''))
            if direction[0]<0:low[0]=min(low[0],pos[0]-textlen)
            if direction[0]>0:high[0]=max(high[0],pos[0]+textlen)
            if direction[1]<0:low[1]=min(low[1],pos[1]-(3.81 if key in wired_pins else 10.16));high[0]=max(high[0],pos[0]+textlen)
            if direction[1]>0:high[1]=max(high[1],pos[1]+(3.81 if key in wired_pins else 10.16));high[0]=max(high[0],pos[0]+textlen)
            pinmap[key]={'pos':pos,'direction':direction}
        low=[math.floor(v/step)*step for v in low];high=[math.ceil(v/step)*step for v in high]
        for pin in sym['pins']:
            key=ref+'.'+pin['number'];p=pinmap[key];dx,dy=p['direction'];x,y=p['pos'];endpoint=[low[0] if dx<0 else high[0] if dx>0 else x,low[1] if dy<0 else high[1] if dy>0 else y];p['port']=endpoint
            side='WEST' if dx<0 else 'EAST' if dx>0 else 'NORTH' if dy<0 else 'SOUTH'
            ports.append({'id':key,'x':endpoint[0]-low[0],'y':endpoint[1]-low[1],'width':0,'height':0,'layoutOptions':{'elk.port.side':side}})
        parts[ref]=raw;specs[ref]={'id':ref,'width':high[0]-low[0],'height':high[1]-low[1],'ports':ports,'layoutOptions':{'elk.portConstraints':'FIXED_POS'},'_low':low}
    from driver_inputs import ground_island
    groups=[];required=[];reused=set()
    for index,g in enumerate(layout['groups']):
        refs=set(g['references']);edges=[]
        block=next((b for b in resources.get('blocks',[]) if set(b['bindings'].values())==refs),None)
        if block:
            if any(layout['rotations'].get(r,0) for r in refs):raise ValueError('Native design block owns its internal rotations; omit per-component rotation')
            bast=nr.parse(block['native']);ox,oy=block['origin'];placed={'id':g['id'],'width':block['width'],'height':block['height'],'children':[],'edges':[],'nativeExtras':[]}
            for raw in children(bast,'symbol'):
                ps={p[1]:p for p in children(raw,'property')};oldref=ps['Reference'][2];ref=block['bindings'][oldref];c=comps[ref];pa=child(raw,'at');x,y,angle=map(float,pa[1:]);reused.add(ref)
                for key,value in [('Reference',ref),('DesignId',c['id'])]:ps[key][2]=value
                for p in ps.values():
                    ppos=child(p,'at');ppos[1]=number(float(ppos[1])-x);ppos[2]=number(float(ppos[2])-y)
                raw[:]=[v for v in raw if not isinstance(v,list) or v[0]!='instances'];replace(raw,'uuid',form('uuid',uid()))
                parts[ref]=raw;specs[ref]['_low']=[0,0];layout['rotations'][ref]=angle
                placed['children'].append({'id':ref,'x':x-ox,'y':y-oy})
                sym=state['symbols'][c['librarySymbol']]
                for pin in sym['pins']:
                    key=ref+'.'+pin['number'];pinmap[key]['pos']=list(geom.world({'at':[0,0,angle]},pin['at']))
            for raw in bast:
                if isinstance(raw,list) and raw[0] in ('wire','junction','label','no_connect'):
                    if raw[0]=='label':raw[1]=block['netBindings'][raw[1]]
                    replace(raw,'uuid',form('uuid',uid()));placed['nativeExtras'].append(raw)
            placed['blockOrigin']=[ox,oy];groups.append((g,placed));continue
        # Explicit same-net links are individual fitted parts, not a bus diagram.
        # Stack them in the requested order with named stubs on both ends.
        if all(len(comps[r]['pins'])==2 and all(r+'.'+p['number'] in named_returns for p in comps[r]['pins']) for r in refs):
            placed={'id':g['id'],'children':[],'edges':[]};row_y=10.16;max_width=0
            for ref in g['references']:
                spec=specs[ref]
                keys=[ref+'.'+p['number'] for p in comps[ref]['pins']]
                points=[pinmap[k]['pos'] for k in keys]
                if all(pinmap[k]['direction'][1]==0 for k in keys) and abs(points[0][1]-points[1][1])<.001:
                    left=min(p[0] for p in points);right=max(p[0] for p in points);y=points[0][1]
                    shown=[p for p in children(parts[ref],'property') if visible(p) and p[2]]
                    end=right+2.54
                    for j,prop in enumerate(shown):
                        x=left if j==0 else end
                        replace(prop,'at',at(x,y-2.54,layout['rotations'].get(ref,0)%180))
                        replace(child(prop,'effects'),'justify',form('justify',*(A(v) for v in (('right','top') if layout['rotations'].get(ref,0) in (90,180) else ('left','bottom')))))
                        if j:end+=len(prop[2])*1.15+2.54
                    spec['_low']=[min(spec['_low'][0],left-7.62),y-5.08]
                    spec['width']=max(right+7.62,end)-spec['_low'][0]
                    spec['height']=7.62
                placed['children'].append({'id':ref,'x':5.08,'y':row_y})
                row_y+=spec['height']+layout['gapMm'];max_width=max(max_width,spec['width'])
            placed.update(width=max_width+10.16,height=row_y+5.08)
            groups.append((g,placed));continue
        island=ground_island(d,resources,g['references'])
        for n in d['nets']:
            members=[k for k in n['nodes'] if k.rsplit('.',1)[0] in refs and k not in named_returns]
            if len(members)>1:
                for subset in ([k for k in members if k in island],[k for k in members if k not in island]):
                    if len(subset)>1:required.append(subset)
                # Star tree is a presentation graph; frozen hypernet stays immutable.
                for a,b in zip(members,members[1:]):
                    if pinmap[a]['direction'][0]<pinmap[b]['direction'][0]:a,b=b,a
                    edges.append({'id':'e'+str(len(edges)),'sources':[a],'targets':[b]})
        from receiver_layout import place as place_receiver
        receiver=place_receiver(g,d,resources,specs,pinmap,layout['gapMm'],parts)
        if receiver is not None:
            named_returns.difference_update(k for n in d['nets'] if re.fullmatch(r'(?:[ASDP]?GND|GROUND|0)',n['name'],re.I) for k in n['nodes'] if k.rsplit('.',1)[0] in refs)
            groups.append((g,receiver));continue
        from shunt_layout import place as place_shunts
        shunts=place_shunts(g,d,resources,specs,pinmap,layout['gapMm'])
        if shunts is not None:
            groups.append((g,shunts));continue
        from series_pair import place as place_series_pair
        series = place_series_pair(g,d,specs,pinmap,layout['gapMm'])
        if series is not None:
            groups.append((g,series));continue
        # A hub with independent two-terminal series branches can use its pin rows
        # directly. Derive the pattern from topology, never reference/net names.
        hubs=[r for r in refs if len(comps[r]['pins'])>2]
        bank=[]
        sinks=[r for r in hubs if all(p['type']=='passive' for p in comps[r]['pins'])]
        drivers=[r for r in hubs if sum(p['type']=='output' for p in comps[r]['pins'])>=3]
        sink=sinks[0] if len(hubs)==2 and len(sinks)==1 and len(drivers)==1 else None
        if (len(hubs)==1 or sink) and len(refs)>=4:
            hub=drivers[0] if sink else hubs[0]
            for r in refs-set(hubs):
                if len(comps[r]['pins'])!=2:break
                pairs=[(a,b) for net in d['nets'] for a in net['nodes'] if a.startswith(hub+'.') for b in net['nodes'] if b.startswith(r+'.')]
                if len(pairs)!=1:
                    if not sink:continue
                    break
                hp,rp=pairs[0]
                direction=pinmap[hp]['direction']
                if direction not in ([1,0],[-1,0]) or pinmap[rp]['direction']!=[-direction[0],0]:
                    if not sink:continue
                    break
                if sink and direction!=[1,0]:break
                bank.append((r,hp,rp))
            else:
                if sink and len(bank)==len(refs)-len(hubs):
                    offsets=[];valid=True
                    for r,hp,rp in bank:
                        other=next(r+'.'+p['number'] for p in comps[r]['pins'] if r+'.'+p['number']!=rp)
                        targets=[k for net in d['nets'] if other in net['nodes'] for k in net['nodes'] if k.startswith(sink+'.')]
                        if len(targets)!=1 or pinmap[targets[0]]['direction']!=[-1,0]:valid=False;break
                        offsets.append(pinmap[hp]['pos'][1]-pinmap[rp]['pos'][1]+pinmap[other]['pos'][1]-pinmap[targets[0]]['pos'][1])
                    if valid and offsets and max(offsets)-min(offsets)<=.001:
                        for net in d['nets']:
                            for a in [k for k in net['nodes'] if k.startswith(hub+'.')]:
                                for b in [k for k in net['nodes'] if k.startswith(sink+'.')]:
                                    if pinmap[a]['direction']!=[1,0] or pinmap[b]['direction']!=[-1,0] or abs(pinmap[a]['pos'][1]-pinmap[b]['pos'][1]-offsets[0])>.001:valid=False
                    else:valid=False
                    if not valid:bank=[]
                if len(bank)==len(refs)-len(hubs) or not sink and len(bank)>=3:
                    bank_refs=set(hubs)|{r for r,_,_ in bank}
                    # Fields sit above/below the resistor, freeing the row below.
                    places={hub:[0,0]};segments=[]
                    for r,hp,rp in bank:
                        px,py=pinmap[hp]['pos'];rx,ry=pinmap[rp]['pos']
                        side=pinmap[hp]['direction'][0]
                        places[r]=[px+side*17.78-rx,py-ry]
                        raw=parts[r];shown=[p for p in children(raw,'property') if visible(p) and p[2]]
                        for j,prop in enumerate(shown):
                            # Explicit left anchors leave a readable gap between
                            # reference and value instead of centering two fields
                            # whose widths can overlap (e.g. R2 and 47R/0805).
                            label_x=-5.08 if j==0 else -5.08+len(shown[0][2])*1.15+2.54
                            replace(prop,'at',at(label_x,-2.54,layout['rotations'].get(r,0)%180))
                            eff=child(prop,'effects');replace(eff,'justify',form('justify',*(A(v) for v in (('right','top') if layout['rotations'].get(r,0) in (90,180) else ('left','bottom')))))
                        specs[r]['_low']=[-7.62,-2.54];specs[r]['width']=30.48;specs[r]['height']=5.08
                        segments.append(([px,py],[px+side*17.78,py]))
                    if sink:
                        sinkpaths=[];valid=True
                        for r,hp,rp in bank:
                            other=next(r+'.'+p['number'] for p in comps[r]['pins'] if r+'.'+p['number']!=rp)
                            pairs=[k for net in d['nets'] if other in net['nodes'] for k in net['nodes'] if k.startswith(sink+'.')]
                            if len(pairs)!=1 or pinmap[pairs[0]]['direction']!=[-1,0]:valid=False;break
                            sinkpaths.append((other,pairs[0]))
                        offsets=[places[a.split('.')[0]][1]+pinmap[a]['pos'][1]-pinmap[b]['pos'][1] for a,b in sinkpaths]
                        if not valid or not offsets or max(offsets)-min(offsets)>.001:raise ValueError('Series bank sink pin rows must align; revise functional pin presentation')
                        sx=max(places[a.split('.')[0]][0]+pinmap[a]['pos'][0]-pinmap[b]['pos'][0]+17.78 for a,b in sinkpaths);sy=offsets[0];places[sink]=[sx,sy]
                        for a,b in sinkpaths:
                            px,py=pinmap[a]['pos'];rx,ry=places[a.split('.')[0]];qx,qy=pinmap[b]['pos'];segments.append(([px+rx,py+ry],[qx+sx,qy+sy]))
                        for net in d['nets']:
                            aa=[k for k in net['nodes'] if k.startswith(hub+'.')];bb=[k for k in net['nodes'] if k.startswith(sink+'.')]
                            for a in aa:
                                for b in bb:
                                    px,py=pinmap[a]['pos'];qx,qy=pinmap[b]['pos']
                                    if abs(py-qy-sy)>.001:raise ValueError('Direct bank rows must align')
                                    segments.append(([px,py],[qx+sx,qy+sy]))
                    lowx=min(places[r][0]+specs[r]['_low'][0] for r in bank_refs)-5.08
                    lowy=min(places[r][1]+specs[r]['_low'][1] for r in bank_refs)-10.16
                    highx=max(places[r][0]+specs[r]['_low'][0]+specs[r]['width'] for r in bank_refs)+5.08
                    highy=max(places[r][1]+specs[r]['_low'][1]+specs[r]['height'] for r in bank_refs)+5.08
                    placed={'id':g['id'],'width':highx-lowx,'height':highy-lowy,
                        'children':[{'id':r,'x':places[r][0]+specs[r]['_low'][0]-lowx,'y':places[r][1]+specs[r]['_low'][1]-lowy} for r in bank_refs],
                        'edges':[{'sections':[{'startPoint':{'x':a[0]-lowx,'y':a[1]-lowy},'endPoint':{'x':b[0]-lowx,'y':b[1]-lowy}}]} for a,b in segments]}
                    if bank_refs!=refs:
                        from driver_decoupling import surround as decoupling
                        from driver_inputs import surround as input_shunts
                        from standard_hub import surround as standard_hub
                        integrated=standard_hub(placed,g['references'],d,resources,specs,pinmap,layout['gapMm'],parts)
                        if integrated is None:
                            integrated=input_shunts(placed,g['references'],d,resources,specs,pinmap,layout['gapMm'],parts)
                            if integrated is None:integrated=decoupling(placed,g['references'],d,resources,specs,pinmap,layout['gapMm'],parts)
                            if integrated is not None:
                                named_returns.difference_update(k for n in d['nets'] if re.fullmatch(r'(?:[ASDP]?GND|GROUND|0)',n['name'],re.I) for k in n['nodes'] if k.rsplit('.',1)[0] in refs)
                        if integrated is not None:placed=integrated
                        else:
                            from series_surround import surround
                            placed=surround(placed,g['references'],specs,pinmap,edges,layout['gapMm'],lambda graph:elk(graph,out,'group-'+str(index)+'-surround',node))
                    groups.append((g,placed));continue
        # Generic routing uses local ground labels; already resolved local motifs
        # retain their intentional short ground rails.
        grounds={k for n in d['nets'] if re.fullmatch(r'(?:[ASDP]?GND|GROUND|0)',n['name'],re.I) for k in n['nodes'] if k.rsplit('.',1)[0] in refs}
        if any(resources['symbols'][comps[r]['librarySymbol']].get('drawingRules') for r in refs):
            # Shared supply rails connect functional blocks by name. Routing a
            # long supply loop through a signal block obscures the signal path.
            for net in d['nets']:
                owners={k.rsplit('.',1)[0] for k in net['nodes']}
                if net['name'] in d.get('supplied_nets',[]) and owners-refs:
                    grounds.update(k for k in net['nodes'] if k.rsplit('.',1)[0] in refs)
        edges=[e for e in edges if not grounds.intersection(e['sources']+e['targets'])]
        required=[nodes for nodes in required if not set(nodes)<=grounds]
        named_returns.update(grounds)
        graph={'id':g['id'],'grid':step,'layoutOptions':{'elk.algorithm':'layered','elk.direction':'RIGHT','elk.edgeRouting':'ORTHOGONAL','elk.spacing.nodeNode':str(layout['gapMm']),'elk.layered.spacing.nodeNodeBetweenLayers':str(layer_spacing(layout['gapMm'])),'elk.padding':'[top=10,left=5,bottom=5,right=5]'},'children':[{k:v for k,v in specs[r].items() if not k.startswith('_')} for r in g['references']],'edges':edges}
        # ELK defaults use pixel-sized gaps; our graph units are millimetres.
        # Explicit clearances also bound self loops on same-net jumper pins.
        graph['layoutOptions'].update({'elk.spacing.componentComponent':str(layout['gapMm']), 'elk.spacing.edgeNode':'2.54', 'elk.spacing.edgeEdge':'2.54', 'elk.spacing.portPort':'2.54', 'elk.layered.spacing.edgeNodeBetweenLayers':'2.54', 'elk.layered.spacing.edgeEdgeBetweenLayers':'2.54', 'elk.spacing.nodeSelfLoop':'3.81'})
        if not edges:
            graph['layoutOptions']={'elk.algorithm':'box','elk.box.packingMode':'SIMPLE','elk.aspectRatio':'2.5','elk.spacing.nodeNode':str(layout['gapMm']),'elk.padding':'[top=10,left=5,bottom=5,right=5]'}
        placed=elk(graph,out,'group-'+str(index),node);groups.append((g,placed))
    packed=elk({'id':'page','layoutOptions':{'elk.algorithm':'box','elk.box.packingMode':'SIMPLE','elk.aspectRatio':str((size[0]-20)/(size[1]-55)),'elk.spacing.nodeNode':str(layout['gapMm']),'elk.padding':'[top=0,left=0,bottom=0,right=0]'},'children':[{'id':g['id'],'width':p['width'],'height':p['height']} for g,p in groups]},out,'page',node)
    # Keep active functional circuits above display/link/process groups.
    # This is a semantic row boundary, not a saved page coordinate.
    row_breaks=[]
    if resources.get('mockEvidence'):
        active=[any(sum(p['type']=='output' for p in comps[r]['pins'])>=3 or resources['symbols'][comps[r]['librarySymbol']].get('appearance',{}).get('kind') in ('specified-receiver','infrared-receiver') for r in g['references']) for g,_ in groups]
        if len(active)>2 and active[:2]==[True,True] and not any(active[2:]):row_breaks=[2]
    alternative=pack_groups(groups,size[0]-20,size[1]-55,layout['gapMm'],row_breaks)
    if row_breaks and alternative is None:raise ValueError('Functional rows do not fit; enlarge the page or revise group spacing')
    # Preserve the model's functional reading order across all groups. Area-only
    # packing can put ancillary process marks ahead of the main circuit.
    if alternative:packed=alternative
    if packed['width']>size[0]-20 or packed['height']>size[1]-55: raise ValueError(f'Layout needs {packed["width"]:.1f} x {packed["height"]:.1f} mm; select A3 or revise visual groups')
    write(out/'page-placement.json',packed)
    origins={g['id']:[10+g['x'],15+g['y']] for g in packed['children']}; extras=[];routes=[];positions={};rootid=uid();label_overrides={}
    for g,placed in groups:
        gx,gy=origins[g['id']]
        for item in placed.get('netLabels',[]):
            label_overrides[g['id'],item['net']]=([snap(gx+item['pos'][0]),snap(gy+item['pos'][1])],item['direction'])
        extras.append(form('text',g['title'],at(gx+2,gy+4,0),form('effects',form('font',form('size',number(1.5),number(1.5))),form('justify',A('left'),A('bottom'))),form('uuid',uid())))
        for n in placed['children']:
            ref=n['id'];raw=parts[ref];low=specs[ref]['_low'];tx=gx+n['x']-low[0];ty=gy+n['y']-low[1];positions[ref]=[tx,ty]
            replace(raw,'at',at(tx if ref in reused else snap(tx),ty if ref in reused else snap(ty),layout['rotations'].get(ref,0)))
            for p in children(raw,'property'):
                pa=child(p,'at');pa[1]=number(float(pa[1])+(tx if ref in reused else snap(tx)));pa[2]=number(float(pa[2])+(ty if ref in reused else snap(ty)))
            raw.append(form('instances',form('project','Circuit',form('path','/'+rootid,form('reference',ref),form('unit',A('1'))))))
        for edge in placed.get('edges',[]):
            for section in edge.get('sections',[]):
                points=[section['startPoint'],*section.get('bendPoints',[]),section['endPoint']]
                route=[[snap(gx+p['x']),snap(gy+p['y'])] for p in points];routes.extend(zip(route,route[1:]))
        for raw in placed.get('nativeExtras',[]):
            ox,oy=placed['blockOrigin']
            if raw[0]=='wire':
                pts=children(child(raw,'pts'),'xy');routes.extend(([round(float(a[1])-ox+gx,4),round(float(a[2])-oy+gy,4)],[round(float(b[1])-ox+gx,4),round(float(b[2])-oy+gy,4)]) for a,b in zip(pts,pts[1:]))
            else:
                p=child(raw,'at');p[1]=number(float(p[1])-ox+gx);p[2]=number(float(p[2])-oy+gy);extras.append(raw)
    routed_endpoints={tuple(v) for route in routes for v in route}
    from driver_inputs import ground_island
    filter_returns=set().union(*(ground_island(d,resources,g['references']) for g in layout['groups']))
    finalpins={};labelled=set();groupof={r:g['id'] for g in layout['groups'] for r in g['references']}
    for key,p in pinmap.items():
        ref=key.rsplit('.',1)[0];tx,ty=positions[ref];pos=[round(p['pos'][0]+snap(tx),4),round(p['pos'][1]+snap(ty),4)];end=[snap(p['port'][0]+tx),snap(p['port'][1]+ty)];finalpins[key]=pos
        if ref in reused:
            finalpins[key]=[round(p['pos'][0]+tx,4),round(p['pos'][1]+ty,4)]
            continue
        if key in d['nc']:extras.append(form('no_connect',at(*pos),form('uuid',uid())));continue
        dx,dy=p['direction'];lp=[round(pos[0]+dx*3.81,4),round(pos[1]+dy*7.62,4)]
        # A terminal without a local route stops at its label, never at an open tail.
        if tuple(pos) not in routed_endpoints:
            if tuple(end) not in routed_endpoints:end=lp
            routes.append((pos,end))
        marker=(groupof[ref],netof[key],key if key in named_returns else 'input-filter-ground' if key in filter_returns else '')
        if marker not in labelled:
            lp=connected_label_point(pos,p['direction'],routes,3.81 if dx else 7.62)
            lp,direction=label_overrides.get((groupof[ref],netof[key]),(lp,p['direction']))
            if not direction[0]:
                # Put vertical-pin labels on the clearer side of their wire.
                width=max(2.54,len(netof[key])*1.15)
                def crossings(side):
                    lo,hi=(lp[0]+.15,lp[0]+width) if side>0 else (lp[0]-width,lp[0]-.15)
                    return sum(1 for a,b in routes if (a[0]==b[0] and lo<a[0]<hi and min(a[1],b[1])<lp[1]-.15 and max(a[1],b[1])>lp[1]-1.65) or (a[1]==b[1] and lp[1]-1.65<a[1]<lp[1]-.15 and min(a[0],b[0])<hi and max(a[0],b[0])>lo))
                if crossings(-1)<crossings(1):direction=[-1,0]
            dense_vertical=not p['direction'][0] and sum(1 for other,q in pinmap.items() if other.rsplit('.',1)[0]==ref and q['direction']==p['direction'])>1
            extras.append(label(netof[key],lp,direction,90 if dense_vertical else 0));labelled.add(marker)
    # All route endpoints are explicit vertices; KiCad decides connectivity from actual geometry.
    unique=split_wire_vertices(routes)
    extras.extend(wire(a,b) for a,b in sorted(unique))
    degree=collections.Counter(p for segment in unique for p in segment)
    junctions={p for p,count in degree.items() if count>=3}
    junctions.update(tuple(pos) for pos in finalpins.values() if sum(geom.on(pos,a,b) for a,b in unique)>1)
    for pos in sorted(junctions):extras.append(form('junction',at(*pos),form('diameter',number(0)),form('color',A('0'),A('0'),A('0'),A('0')),form('uuid',uid())))
    for helper_ref,net in supply_helpers(d).items():
        pos=finalpins[next(n['nodes'][0] for n in d['nets'] if n['name']==net)]
        props=[form('property',k,v,at(*pos,0),form('effects',form('font',form('size',number(1.27),number(1.27))),form('hide',A('yes')))) for k,v in [('Reference',helper_ref),('Value','SUPPLIED'),('Footprint',''),('Role','ERCHelper')]]
        extras.append(form('symbol',form('lib_id','Host:SupplyDeclaration'),at(*pos,0),form('unit',A('1')),form('in_bom',A('no')),form('on_board',A('no')),form('dnp',A('no')),form('uuid',uid()),*props))
    (out/'Circuit.kicad_sch').write_text(nr.dump(document(resources,list(parts.values()),paper,extras,rootid)),encoding='utf8')
    write(out/'Circuit.kicad_pro',{});write(out/'required-wires.json',required)
    for ident,fp in resources['footprints'].items():
        lib,name=ident.split(':');file=out/'footprints'/(lib+'.pretty')/(name+'.kicad_mod');file.parent.mkdir(parents=True,exist_ok=True);file.write_text(fp['native'],encoding='utf8')
    libs=sorted({s.split(':')[0] for s in resources['footprints']})
    (out/'fp-lib-table').write_text('(fp_lib_table '+''.join(f'(lib (name {json.dumps(lib)})(type "KiCad")(uri "${{KIPRJMOD}}/footprints/{lib}.pretty")(options "")(descr "Frozen resources"))' for lib in libs)+')',encoding='utf8')
    # Self-contained library snapshot enables opening/editing on another machine.
    slibs={}
    if d.get('supplied_nets'):
        helper=nr.parse(HELPER);helper[1]='SupplyDeclaration';slibs['Host']=[helper]
    for ident,s in resources['symbols'].items():
        lib,name=ident.split(':');row=nr.parse(s['native']);row[1]=name;slibs.setdefault(lib,[]).append(row)
    for lib,syms in slibs.items():
        folder=out/'symbols';folder.mkdir(exist_ok=True);(folder/(lib+'.kicad_sym')).write_text(nr.dump(form('kicad_symbol_lib',form('version',A('20241209')),form('generator','dsh'),*syms)),encoding='utf8')
    (out/'sym-lib-table').write_text('(sym_lib_table '+''.join(f'(lib (name {json.dumps(lib)})(type "KiCad")(uri "${{KIPRJMOD}}/symbols/{lib}.kicad_sym")(options "")(descr "Frozen resources"))' for lib in slibs)+')',encoding='utf8')
    return layout

def audit(resources,d,out,layout):
    ast,state=read_native(out/'Circuit.kicad_sch');errors=[];expected={c['ref']:c for c in d['components']};comps=[c for c in state['items'].values() if c['kind']=='component'];actual={c['reference']:c for c in comps};helpers=supply_helpers(d)
    if len(actual)!=len(comps) or set(actual)!=set(expected)|set(helpers):errors.append('Native component set changed')
    # Compare the COMPLETE source AST, not a lossy reconstruction via the writer.
    native={s[1]:s for s in children(child(ast,'lib_symbols',[]),'symbol')}
    for ident,s in resources['symbols'].items():
        if native.get(ident)!=nr.parse(s['native']):errors.append('Native symbol AST changed: '+ident)
    if set(native)!=set(resources['symbols'])|({'Host:SupplyDeclaration'} if helpers else set()):errors.append('Unexpected embedded symbols')
    for ref,c in expected.items():
        item=actual.get(ref)
        if not item:continue
        props={p['name']:p['value'] for p in item['properties']}
        if item['symbol']!=c['librarySymbol'] or item.get('mirror'):errors.append('Symbol identity changed: '+ref)
        for k,v in {'Reference':ref,'Value':c['value'],'Footprint':c['footprint'],'MPN':c['mpn'],'DesignId':c['id']}.items():
            if props.get(k)!=v:errors.append('Material property changed: '+ref+'.'+k)
        if any(item[k]!=c[k] for k in ('dnp','in_bom','on_board')):errors.append('Assembly flags changed: '+ref)
        source=instance(c,resources['symbols'][c['librarySymbol']])
        raw=next(x for x in children(ast,'symbol') if any(p[1]=='Reference' and p[2]==ref for p in children(x,'property')))
        def field_contract(p):
            p=copy.deepcopy(p);p[:]=[x for x in p if not isinstance(x,list) or x[0]!='at']
            eff=child(p,'effects',[]);eff[:]=[x for x in eff if not isinstance(x,list) or x[0]!='justify']
            return p
        before={p[1]:field_contract(p) for p in children(source,'property')};after={p[1]:field_contract(p) for p in children(raw,'property')}
        if before!=after or len(children(raw,'property'))!=len(after):errors.append('Property visibility, font or metadata changed: '+ref)
    pins={c['reference']+'.'+p['number']:geom.world(c,p['at']) for c in comps for p in state['symbols'][c['symbol']]['pins']}
    xml=ET.parse(out/'actual.net.xml').getroot();observed=collections.Counter();names={};nc=set();helpernets={}
    for n in xml.findall('./nets/net'):
        members=[]
        for x in n.findall('node'):
            ref=x.get('ref');key=ref+'.'+x.get('pin')
            if ref in helpers:helpernets[ref]=n.get('name','').removeprefix('/');continue
            members.append(key)
            if 'no_connect' in x.get('pintype',''):nc.add(key)
        if members:observed[frozenset(members)]+=1;names[frozenset(members)]=n.get('name','').removeprefix('/')
    wanted=collections.Counter(frozenset(n['nodes']) for n in d['nets']);wanted.update(frozenset([p]) for p in d['nc'])
    if wanted!=observed:errors.append('Actual KiCad net partitions changed')
    if nc!=set(d['nc']):errors.append('Actual KiCad NC set changed')
    for n in d['nets']:
        if names.get(frozenset(n['nodes']))!=n['name']:errors.append('Actual net name changed: '+n['name'])
    markers=[i['at'] for i in state['items'].values() if i['kind']=='no_connect']
    if len(markers)!=len(d['nc']) or any(not any(math.dist(pins[k],m)<.0002 for m in markers) for k in d['nc']):errors.append('NC markers changed')
    physical,segs=geom.physical_graph(state)
    for ref,net in helpers.items():
        c=actual.get(ref,{})
        # KiCad omits #PWR virtual symbols from its XML. Bind the helper through
        # actual wire connectivity to ordinary pins whose nets were read back.
        attached={names.get(frozenset(n['nodes'])) for n in d['nets'] if any(physical.get(k,k)==physical.get(ref+'.1') for k in n['nodes'])}
        if attached!={net} or ref in helpernets and helpernets[ref]!=net or c.get('in_bom',True) or c.get('on_board',True) or c.get('symbol')!='Host:SupplyDeclaration' or native.get('Host:SupplyDeclaration')!=nr.parse(HELPER):errors.append('Supply declaration changed: '+ref)
    # Derive obligations from frozen topology and the host-validated plan, never a model report.
    required=[]
    from driver_inputs import ground_island
    for g in layout['groups']:
        island=ground_island(d,resources,g['references'])
        for n in d['nets']:
            if re.fullmatch(r'(?:[ASDP]?GND|GROUND|0)',n['name'],re.I):continue
            if (n['name'] in d.get('supplied_nets',[])
                and any(resources['symbols'][c['librarySymbol']].get('drawingRules') for c in d['components'] if c['ref'] in g['references'])
                and any(k.rsplit('.',1)[0] not in g['references'] for k in n['nodes'])):
                # Cross-block supplies may use labels; their complete net
                # partition and exact name are independently verified above.
                continue
            members=[k for k in n['nodes'] if k.rsplit('.',1)[0] in g['references'] and k not in same_net_terminals(d)]
            # Check each physical return rail separately; actual KiCad XML
            # above must still prove both rails belong to the expected net.
            for subset in ([k for k in members if k in island],[k for k in members if k not in island]):
                if len(subset)>1:required.append(subset)
    for members in required:
        if len({physical.get(k,k) for k in members})!=1:errors.append('Required local wires missing: '+str(members))
    for ident,fp in resources['footprints'].items():
        lib,name=ident.split(':');p=out/'footprints'/(lib+'.pretty')/(name+'.kicad_mod')
        if not p.exists() or nr.sha(p.read_text(encoding='utf8'))!=nr.sha(fp['native']):errors.append('Frozen footprint changed: '+ident)
    pdf=fc.audit_layout(out,state,str(out/'Circuit.pdf'));errors+=pdf['errors'];write(out/'pdf-geometry.json',pdf)
    w,h={'A4-landscape':(297,210),'A3-landscape':(420,297)}[layout['paper']]
    if state['page_size_mm']!=[w,h] or child(ast,'paper')[1]!=layout['paper'].split('-')[0] or 'portrait' in child(ast,'paper'):errors.append('Page size changed')
    bodies=[]
    for c in comps:
        if c['reference'] in helpers:continue
        b=geom.part_bounds(c,state['symbols'][c['symbol']]);body=geom.body_bounds(c,state['symbols'][c['symbol']])
        if b[0]<10-.001 or b[1]<10-.001 or b[2]>w-10+.001 or b[3]>h-45+.001:errors.append('Outside reserved drawing area: '+c['reference'])
        if body:
            for ref,other in bodies:
                if min(body[2],other[2])-max(body[0],other[0])>.1 and min(body[3],other[3])-max(body[1],other[1])>.1:errors.append('Symbol body overlap: '+ref+' / '+c['reference'])
            bodies.append((c['reference'],body))
    erc=read(out/'erc.json');viol=[v for s in erc['sheets'] for v in s['violations']];ec=sum(v['severity']=='error' for v in viol);wc=sum(v['severity']=='warning' for v in viol)
    if ec:errors.append('ERC errors: '+str(ec))
    fields=['Reference','Value','Footprint','MPN','DesignId','OriginalFootprint','MaterialCode','MaterialDescription','AssemblyType','ObjectRole','DNP','OnBoard']
    with (out/'bom.csv').open('w',encoding='utf-8-sig',newline='') as f:
        writer=csv.DictWriter(f,fieldnames=fields);writer.writeheader()
        for c in comps:
            if c['in_bom']:
                p={p['name']:p['value'] for p in c['properties']};writer.writerow({k:p.get(k,'') for k in fields[:-2]}|{'DNP':c['dnp'],'OnBoard':c['on_board']})
    report={'status':'failed' if errors else 'passed','errors':errors,'symbols':len(expected),'pins':sum(len(c['pins']) for c in d['components']),'nets':len(d['nets']),'nc':sorted(nc),'erc':{'errors':ec,'warnings':wc,'violations':viol},'layout':{'pageMm':[w,h],'localWireGroups':len(required),'textOverlaps':len(pdf.get('collisions',[])),'wireBodyCrossings':len(pdf.get('wireBodyCrossings',[])),'wireTextCrossings':len(pdf.get('wireTextCrossings',[])),'bodyTextOverlaps':len(pdf.get('bodyTextOverlaps',[]))},'scope':'Single-sheet native symbols; actual netlist and PDF checks; electrical ratings, procurement and physical performance require review.'}
    write(out/'audit.json',report);write(out/'readback.json',{'components':comps,'pins':pins,'pinDetails':{c['reference']+'.'+p['number']:{'name':p['name'],'type':p['type']} for c in comps for p in state['symbols'][c['symbol']]['pins']},'nets':d['nets'] if wanted==observed else [],'nc':sorted(nc)})
    return report

def main(req):
    op=req['operation']
    if op=='lookup':return nr.query(req)
    if op=='lookup-batch':
        queries=req.get('queries',[])
        if not isinstance(queries,list) or len(queries)>200:raise ValueError('Invalid batch size')
        return {'symbols':[nr.query({**req,'kind':'symbol','query':q}) for q in queries]}
    d=read(req['design']) if isinstance(req['design'],str) else req['design'];validate(d)
    if op=='snapshot':
        resources=nr.snapshot(req,d);write(req['snapshot'],resources);return {'status':'passed','symbols':len(resources['symbols']),'components':len(d['components']),'policy':resources['policy'],'scope':resources['scope']}
    resources=read(req['library']);out=Path(req['output']).resolve()
    from topology_motifs import native_matches
    resources=copy.deepcopy(resources)
    detected=native_matches(resources,d)
    # Explicit visual grouping remains authoritative; only reuse exact groups.
    if req['layout'].get('groups'):
        detected=[b for b in detected if any(set(g['references'])==set(b['bindings'].values()) for g in req['layout']['groups'])]
    def compatible_rotation(b):
        for raw in children(nr.parse(b['native']),'symbol'):
            oldref=next(p[2] for p in children(raw,'property') if p[1]=='Reference')
            ref=b['bindings'][oldref];angle=float(child(raw,'at')[3])
            if ref in req['layout'].get('rotations',{}) and req['layout']['rotations'][ref]!=angle:return False
        return True
    detected=[b for b in detected if compatible_rotation(b)]
    resources['blocks']=resources.get('blocks',[])+detected
    if os.name=='nt' and not str(out).startswith('\\\\?\\'):out=Path('\\\\?\\'+str(out))
    out.mkdir(parents=True,exist_ok=True)
    requested=copy.deepcopy(req['layout'])
    from symbol_orientation import defaults as orientation_defaults
    requested['rotations']={**orientation_defaults(d,resources),**requested.get('rotations',{})}
    # Automatically recognized rigid motifs own their internal rotations.
    for b in detected:
        for r in b['bindings'].values():requested.get('rotations',{}).pop(r,None)
    layout=normalize_layout(requested,d,resources)
    write(out/'motif-recognition.json',{'matches':[{k:v for k,v in b.items() if k!='native'} for b in detected],'unmatched':[c['ref'] for c in d['components'] if not any(c['ref'] in b['bindings'].values() for b in resources['blocks'])]})
    if op=='generate':generate(resources,d,out,layout,req.get('node','node'))
    elif op!='verify':raise ValueError('Unsupported operation')
    export(out,req['cli'],out/'Circuit.kicad_sch');return audit(resources,d,out,layout)

if __name__=='__main__':
    try:write(sys.argv[2],main(read(sys.argv[1])))
    except Exception as e:write(sys.argv[2],{'status':'failed','errors':[str(e)]});raise
