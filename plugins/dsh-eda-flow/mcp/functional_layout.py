"""Functional schematic composition from MODEL-authored groups and nets.

Independent implementation inspired by Konnect's place/wire/render/review workflow.
No reference page, functionalPolicy, source netlist, or design-specific wiring is read.
Frozen bodies/pins/fields are instantiated through fixed_components.place.
"""
import collections
import copy
import heapq
import math
import xml.etree.ElementTree as ET

import fixed_components as frozen

GRID = 1.27


def r(v):
    return round(v, 4)


def point(p):
    return tuple(r(v) for v in p[:2])


def world(c, p):
    a = math.radians(c['at'][2] if len(c['at']) > 2 else 0)
    # Match KiCad's independent 100 nm rounding of local and instance coordinates.
    x, y = (r(v) for v in p[:2])
    return point([r(c['at'][0]) + x*round(math.cos(a)) - y*round(math.sin(a)),
                  r(c['at'][1]) - x*round(math.sin(a)) - y*round(math.cos(a))])


def bounds(points):
    return [min(p[0] for p in points), min(p[1] for p in points),
            max(p[0] for p in points), max(p[1] for p in points)]


def grow(b, d):
    return [b[0]-d, b[1]-d, b[2]+d, b[3]+d]


def body_bounds(c, s):
    pts = []
    for g in s.get('graphics', []):
        if g['kind'] == 'text':
            continue
        pts.extend(g.get('points', []))
        pts.extend(g[k] for k in ('start', 'mid', 'end') if k in g)
        if g['kind'] == 'circle':
            x, y = g['center']; radius = g['radius']
            pts.extend([[x-radius,y-radius],[x+radius,y+radius]])
    return bounds([world(c, p) for p in pts]) if pts else None


def text_box(text, at, font):
    size = font.get('size', [1.27,1.27])
    width = sum(1 if ord(ch)>255 else .72 for ch in text)*size[0]
    return [at[0]-.4,at[1]-size[1]*1.4-.4,at[0]+width+.5,at[1]+.4]


def part_bounds(c, s, fields=True):
    pts = [world(c,p['at']) for p in s['pins']]
    b = body_bounds(c,s)
    if b: pts.extend([b[:2],b[2:]])
    if fields:
        for p in c['properties']:
            if p.get('visible',True) and p['value']:
                t = text_box(p['value'],p['at'],p.get('font',{}))
                pts.extend([t[:2],t[2:]])
    return bounds(pts or [c['at'][:2]])


def shift(c, x, y):
    c['at'][:2] = [r(c['at'][0]+x),r(c['at'][1]+y)]
    for p in c['properties']:
        p['at'][:2] = [r(p['at'][0]+x),r(p['at'][1]+y)]


def on(p, a, b):
    return abs((p[0]-a[0])*(b[1]-a[1])-(p[1]-a[1])*(b[0]-a[0])) < .0001 and all(min(a[i],b[i])-.0001 <= p[i] <= max(a[i],b[i])+.0001 for i in (0,1))


def intersects(a,b,box):
    if a[0] == b[0]:
        return box[0]<a[0]<box[2] and max(min(a[1],b[1]),box[1])<min(max(a[1],b[1]),box[3])
    return box[1]<a[1]<box[3] and max(min(a[0],b[0]),box[0])<min(max(a[0],b[0]),box[2])


def validate_plan(lib, plan):
    parts = {c['ref']:c for c in lib['objects'] if c['pins']}
    refs = [ref for g in plan['groups'] for col in g['columns'] for ref in col]
    if len(refs)!=len(set(refs)) or set(refs)!=set(parts):
        raise ValueError('Groups must contain every electrical reference exactly once; missing='+str(sorted(set(parts)-set(refs)))+' extra='+str(sorted(set(refs)-set(parts))))
    ids=[g['id'] for g in plan['groups']]
    if len(ids)!=len(set(ids)): raise ValueError('Duplicate functional group id')
    if len(plan['groups'])<2: raise ValueError('Use at least two meaningful functional groups')
    allpins={ref+'.'+p['number'] for ref,c in parts.items() for p in c['pins']}
    nodes=[p for n in plan['nets'] for p in n['nodes']]+plan.get('nc',[])
    if len(nodes)!=len(set(nodes)) or set(nodes)!=allpins:
        raise ValueError('Every frozen pin must occur exactly once in nets or nc; missing='+str(sorted(allpins-set(nodes)))+' extra='+str(sorted(set(nodes)-allpins))+' duplicates='+str([p for p,n in collections.Counter(nodes).items() if n>1]))
    names=[n['name'] for n in plan['nets']]
    if len(names)!=len(set(names)) or any(len(n['nodes'])<2 for n in plan['nets']):
        raise ValueError('Net names must be unique and nets must have at least two pins; use nc for intentional unconnected pins')
    if set(plan.get('supplied_nets',[]))-set(names): raise ValueError('Unknown supplied net')
    if set(plan.get('rotations',{}))-set(parts): raise ValueError('Unknown rotated part')
    return parts


class Router:
    """Orthogonal visibility grid; bends and net endpoints cannot be crossings."""
    def __init__(self, box, obstacles, leads):
        self.box=box;self.obstacles=obstacles;self.blocked={};self.edges={};self.nodes={}
        xs={r(box[0]),r(box[2])};ys={r(box[1]),r(box[3])}
        for i in range(math.ceil(box[0]/GRID),math.floor(box[2]/GRID)+1):xs.add(r(i*GRID))
        for i in range(math.ceil(box[1]/GRID),math.floor(box[3]/GRID)+1):ys.add(r(i*GRID))
        for _,a,b in leads:xs.update([a[0],b[0]]);ys.update([a[1],b[1]])
        self.x=sorted(xs);self.y=sorted(ys);self.xi={v:i for i,v in enumerate(self.x)};self.yi={v:i for i,v in enumerate(self.y)}
        for net,a,b in leads:self.occupy(net,[a,b])

    def idx(self,p):return (self.xi[p[0]],self.yi[p[1]])
    def pos(self,p):return (self.x[p[0]],self.y[p[1]])
    def edge(self,a,b):return tuple(sorted((a,b)))

    def occupy(self,net,path):
        for a,b in zip(path,path[1:]):
            ia,ib=self.idx(a),self.idx(b);axis=1 if ia[1]==ib[1] else 2
            seq=[(i,ia[1]) for i in range(min(ia[0],ib[0]),max(ia[0],ib[0])+1)] if axis==1 else [(ia[0],i) for i in range(min(ia[1],ib[1]),max(ia[1],ib[1])+1)]
            for u,v in zip(seq,seq[1:]):self.edges[self.edge(u,v)]=net
            for u in seq:
                d=self.nodes.setdefault(u,{})
                d[net]=d.get(net,0)|axis
        # A crossing at a polyline bend/end would silently join nets in KiCad.
        for p in path:self.nodes.setdefault(self.idx(p),{})[net]=3

    def route(self,net,start,end):
        si,ei=self.idx(start),self.idx(end)
        initial=(*si,0);q=[(0,0,initial)];cost={initial:0};prev={};target=None
        while q:
            _,g,u=heapq.heappop(q)
            if g>cost.get(u,float('inf')):continue
            if u[:2]==ei:target=u;break
            x,y,oldaxis=u
            for nx,ny in [(x-1,y),(x+1,y),(x,y-1),(x,y+1)]:
                if not (0<=nx<len(self.x) and 0<=ny<len(self.y)):continue
                axis=1 if ny==y else 2;a=(x,y);b=(nx,ny);edge=self.edge(a,b)
                occupant=self.edges.get(edge)
                if occupant is not None and occupant!=net:continue
                others=[v for k,v in self.nodes.get(a,{}).items() if k!=net]
                if others and (oldaxis not in (0,axis) or any(v&axis for v in others)):continue
                if any(v&axis for k,v in self.nodes.get(b,{}).items() if k!=net):continue
                if edge not in self.blocked:
                    pa,pb=self.pos(a),self.pos(b)
                    self.blocked[edge]=any(intersects(pa,pb,box) for box in self.obstacles)
                if self.blocked[edge]:continue
                dist=abs(self.x[nx]-self.x[x])+abs(self.y[ny]-self.y[y])
                ng=g+dist+(4 if oldaxis not in (0,axis) else 0)+(8 if others else 0)
                v=(nx,ny,axis)
                if ng>=cost.get(v,float('inf')):continue
                cost[v]=ng;prev[v]=u
                h=abs(self.x[nx]-end[0])+abs(self.y[ny]-end[1])
                heapq.heappush(q,(ng+h,ng,v))
        if target is None:
            blocked_ends=[{'point':p,'obstacle':b} for p in (start,end) for b in self.obstacles if b[0]<p[0]<b[2] and b[1]<p[1]<b[3]]
            raise ValueError('No readable route for '+net+' between '+str(start)+' and '+str(end)+'; regroup/reorder columns or increase spacing; endpoint conflicts='+str(blocked_ends))
        path=[];u=target
        while True:
            path.append(self.pos(u[:2]))
            if u==initial:break
            u=prev[u]
        path.reverse();simple=[path[0]]
        for i,p in enumerate(path[1:-1],1):
            if not ((path[i-1][0]==p[0]==path[i+1][0]) or (path[i-1][1]==p[1]==path[i+1][1])):simple.append(p)
        simple.append(path[-1]);self.occupy(net,simple)
        return simple


def compose_candidate(state,lib,plan):
    parts=validate_plan(lib,plan);state=copy.deepcopy(state)
    state['items']={};state['symbols']={};state['paper']='A3';state['portrait']=False
    groups=[];rotations=plan.get('rotations',{});spacing=plan.get('spacing',1.0)
    # Geometry-sized columns. AI chooses functional order, never page coordinates.
    for spec in plan['groups']:
        columns=[]
        for refs in spec['columns']:
            entries=[]
            for ref in refs:
                s,c=frozen.place(parts[ref],{'at':[0,0,rotations.get(ref,0)]})
                # Horizontal text is readable regardless of the symbol rotation.
                for p in c['properties']:
                    p['at'][2]=c['at'][2]%180
                    p['font']['justify']=['right','top'] if c['at'][2] in (90,180) else ['left','bottom']
                if all((p['at'][2]+c['at'][2])%180==90 for p in s['pins']):
                    b=part_bounds(c,s,False)
                    fields=[p for p in c['properties'] if p.get('visible',True) and p['value']]
                    for j,p in enumerate(fields):
                        p['at']=[b[2]+2.54,(b[1]+b[3])/2+(j-(len(fields)-1)/2)*2.54,c['at'][2]%180]
                b=part_bounds(c,s);entries.append((s,c,b))
            columns.append(entries)
        widths=[max(b[2]-b[0] for _,_,b in col)+18*spacing for col in columns]
        heights=[sum(b[3]-b[1]+8*spacing for _,_,b in col) for col in columns]
        width=sum(widths)+20*spacing;height=max(heights)+24*spacing
        group={'id':spec['id'],'title':spec['title'],'w':width,'h':height,'parts':[]}
        x=10*spacing
        for col,cw,ch in zip(columns,widths,heights):
            y=16*spacing+(max(heights)-ch)/2
            for s,c,b in col:
                shift(c,x-b[0]+(cw-(b[2]-b[0]))/2,y-b[1])
                state['symbols'][s['name']]=s;state['items'][c['id']]=c;group['parts'].append(c['reference'])
                y+=b[3]-b[1]+8*spacing
            x+=cw
        if spec.get('_motif') == 'pin_banks':
            # Arrange two-pin branches on the actual sides of a passive multi-pin
            # symbol. No source sheet positions or electrical policy is consulted.
            hub=spec['_hub']; hc=state['items'][parts[hub]['id']]
            hs=state['symbols'][hc['symbol']]
            shift(hc,-hc['at'][0],-hc['at'][1])
            banks=collections.defaultdict(list)
            for ref in group['parts']:
                if ref==hub:continue
                matches=[]
                for net in plan['nets']:
                    hp=[n.rsplit('.',1)[1] for n in net['nodes'] if n.rsplit('.',1)[0]==hub]
                    rp=[n.rsplit('.',1)[1] for n in net['nodes'] if n.rsplit('.',1)[0]==ref]
                    if len(hp)==len(rp)==1:matches.append((hp[0],rp[0]))
                if len(matches)!=1:raise ValueError('Ambiguous pin-bank branch')
                hn,rn=matches[0];hp=next(p for p in hs['pins'] if p['number']==hn)
                pos=world(hc,hp['at']);angle=(hp['at'][2]+hc['at'][2])%360
                if angle not in (90,270):raise ValueError('Pin-bank hub must have top/bottom pins')
                banks[angle].append((pos[0],pos[1],ref,rn))
            for angle,bank in banks.items():
                bank.sort();center=(bank[0][0]+bank[-1][0])/2
                for index,(_,py,ref,rn) in enumerate(bank):
                    c=state['items'][parts[ref]['id']];s=state['symbols'][c['symbol']]
                    p=next(p for p in s['pins'] if p['number']==rn);at=world(c,p['at'])
                    x=center+(index-(len(bank)-1)/2)*7.62
                    y=py+(-7.62 if angle==270 else 7.62)
                    shift(c,x-at[0],y-at[1])
        if spec.get('_motif') == 'parallel_rails':
            # Align the actual pin terminals, not unequal text bounding boxes.
            next_x=10
            for ref in group['parts']:
                c=state['items'][parts[ref]['id']];s=state['symbols'][c['symbol']]
                top=min(world(c,p['at'])[1] for p in s['pins'])
                b=part_bounds(c,s)
                shift(c,next_x-b[0],20-top)
                next_x=part_bounds(c,s)[2]+7.62
        if spec.get('_motif'):
            bs=[part_bounds(state['items'][parts[ref]['id']],state['symbols'][state['items'][parts[ref]['id']]['symbol']]) for ref in group['parts']]
            b=bounds([p for box in bs for p in (box[:2],box[2:])])
            for ref in group['parts']:shift(state['items'][parts[ref]['id']],10-b[0],16-b[1])
            group['w']=b[2]-b[0]+20;group['h']=b[3]-b[1]+28
        groups.append(group)
    # Bottom-left packing fills space beside short blocks before opening a row.
    placed=[]
    def flow_order(g):
        sources=sum(sum(p['type']=='output' for p in parts[ref]['pins'])>=2 and any(p['type']=='power_out' for p in parts[ref]['pins']) for ref in g['parts'])
        control=any(any(p['type']=='input' for p in parts[ref]['pins']) and sum(p['type']=='output' for p in parts[ref]['pins'])>=3 for ref in g['parts'])
        return (0 if sources else 1 if control else 2,-g['h'])
    for group in sorted(groups,key=flow_order):
        xs=[14]+[g['box'][2]+7 for g in placed]
        ys=[14]+[g['box'][3]+7 for g in placed]
        options=[]
        for y in ys:
            for x in xs:
                right=x+group['w'];bottom=y+group['h']
                if right>405 or bottom>240:continue
                if any(x<g['box'][2]+7 and right+7>g['box'][0] and y<g['box'][3]+7 and bottom+7>g['box'][1] for g in placed):continue
                options.append((y,x))
        if not options:raise ValueError('Functional groups do not fit A3; reduce spacing or rebalance columns')
        y,x=min(options)
        placed.append(group)
        group['box']=[r(x),r(y),r(x+group['w']),r(y+group['h'])]
        for ref in group['parts']:
            c=state['items'][parts[ref]['id']];shift(c,x,y)
            # Snap only the NEW instance origin, never the frozen local pin geometry.
            # Text-derived column widths must not move otherwise aligned pins off-grid.
            shift(c,round(c['at'][0]/GRID)*GRID-c['at'][0],round(c['at'][1]/GRID)*GRID-c['at'][1])
    def add(item):state['items'][item['id']]=item
    for g in groups:
        b=g['box']
        add({'id':'group-'+g['id'],'kind':'rectangle','start':b[:2],'end':b[2:],'width':.15,'stroke_type':'dash'})
        add({'id':'title-'+g['id'],'kind':'text','text':g['title'],'at':[b[0]+3,b[1]+5],
             'font':{'size':[1.8,1.8],'face':'SimSun','bold':True,'justify':['left','bottom']}})
    # Process marks are not electrical functions and have no routing influence.
    x,y=16,max(g['box'][3] for g in groups)+14
    process_bottom=y
    for source in [c for c in lib['objects'] if not c['pins']]:
        s,c=frozen.place(source,{'at':[0,0]});b=part_bounds(c,s);w=b[2]-b[0];h=b[3]-b[1]
        if x+w>394:x=16;y+=16
        if y+h>282:raise ValueError('Process objects overflow the drawing area')
        shift(c,x-b[0],y-b[1]);x+=w+8
        state['symbols'][s['name']]=s;add(c)
        process_bottom=max(process_bottom,y+h)
    state['page_size_mm']=[420,min(297,math.ceil((process_bottom+27)/10)*10)]
    pinmap={};pin_net={p:n['name'] for n in plan['nets'] for p in n['nodes']}
    for ref,c0 in parts.items():
        c=state['items'][c0['id']];s=state['symbols'][c['symbol']]
        for p in s['pins']:
            a=math.radians(p['at'][2]+c['at'][2]);direction=(-round(math.cos(a)),round(math.sin(a)))
            pos=world(c,p['at']);pinmap[ref+'.'+p['number']]={'pos':pos,'direction':direction}
    routes=[];net_groups=collections.defaultdict(list)
    for group in groups:
        refs=set(group['parts']);nodes={k:p for k,p in pinmap.items() if k.rsplit('.',1)[0] in refs}
        obstacles=[]
        for ref in refs:
            c=state['items'][parts[ref]['id']];s=state['symbols'][c['symbol']];b=body_bounds(c,s)
            if b:obstacles.append(grow(b,.55))
            for p in c['properties']:
                if p.get('visible',True) and p['value']:obstacles.append(text_box(p['value'],p['at'],p.get('font',{})))
        local=[];leads=[]
        for net in plan['nets']:
            members=[n for n in net['nodes'] if n in nodes]
            if not members:continue
            net_groups[net['name']].append(group['id']);local.append((net['name'],members))
            for key in members:
                p=nodes[key];d=p['direction'];pos=p['pos']
                # Fan-out length is geometric and independent of original coordinates.
                # 2.54 mm remains visibly connected while leaving clearance between
                # neighbouring vertical parts after instance snapping to the grid.
                length=2.54
                escape=point([pos[0]+d[0]*length,pos[1]+d[1]*length]);p['escape']=escape
                leads.append((net['name'],pos,escape))
        # Add one label per net in each block, placed away from pin annotations.
        # For local nets a label is an annotation; it does not replace any wire.
        for net,members in local:
            original = next(n for n in plan['nets'] if n['name']==net)
            if len(members)==len(original['nodes']) and net not in plan.get('supplied_nets',[]) and net.upper() not in ('GND','SGND','AGND','DGND'):
                continue
            candidates=[]
            for key in members:
                p=nodes[key];end=p['escape'];d=p['direction']
                at=list(end)
                font={'size':[1.1,1.1],'justify':['right' if d[0]<0 else 'left','bottom']}
                width=len(net)*1.1*1.05
                b=[end[0]-width if d[0]<0 else end[0],end[1]-1.9,end[0] if d[0]<0 else end[0]+width,end[1]-.25]
                if b[0]>group['box'][0]+1 and b[2]<group['box'][2]-1 and b[1]>group['box'][1]+7 and b[3]<group['box'][3]-1 and not any(b[0]<o[2] and b[2]>o[0] and b[1]<o[3] and b[3]>o[1] for o in obstacles):
                    candidates.append((key,at,b,font))
            if not candidates:raise ValueError('No label clearance for '+net+' in '+group['id']+'; reorder columns or increase spacing')
            key,at,b,font=candidates[0];end=nodes[key]['escape']
            # A label anchor must touch the actual wire. Font baseline sits above it.
            at=[end[0],end[1]]
            # Left-facing leads are labelled with right alignment, so text stays outward.
            if nodes[key]['direction'][0]<0:font['justify']=['right','bottom']
            else:font['justify']=['left','bottom']
            add({'id':'net-'+group['id']+'-'+net,'kind':'label','text':net,'at':at,'font':font})
            # Reserve text's actual outward span during routing; anchor edge is open.
            width=len(net)*1.1*1.05
            lb=[end[0]-width if 'right' in font['justify'] else end[0],end[1]-1.9,end[0] if 'right' in font['justify'] else end[0]+width,end[1]-.25]
            obstacles.append(lb)
        router=Router([group['box'][0]+1,group['box'][1]+8,group['box'][2]-1,group['box'][3]-1],obstacles,leads)
        for net,a,b in leads:routes.append((net,[a,b]))
        # Short nets first; longer shared rails can cross cleanly without joining.
        for net,members in sorted(local,key=lambda e:(len(e[1]),min(nodes[k]['escape'][0] for k in e[1]))):
            reached=[members[0]];remaining=members[1:]
            while remaining:
                _,a,b=min((abs(nodes[a]['escape'][0]-nodes[b]['escape'][0])+abs(nodes[a]['escape'][1]-nodes[b]['escape'][1]),a,b) for a in reached for b in remaining)
                path=router.route(net,nodes[a]['escape'],nodes[b]['escape']);routes.append((net,path));reached.append(b);remaining.remove(b)
    for index,(net,path) in enumerate(routes):add({'id':'route-'+str(index),'kind':'wire','width':.18,'points':[list(p) for p in path]})
    # Junctions are explicit only at a branch of the SAME intended net.
    bynet=collections.defaultdict(list)
    for net,path in routes:
        bynet[net].extend(zip(path,path[1:]))
    for net,segs in bynet.items():
        vertices={point(p) for seg in segs for p in seg}
        for p in vertices:
            directions=set()
            for a,b in segs:
                if on(p,a,b):
                    for end in (a,b):
                        if point(end)!=p:directions.add((int(math.copysign(1,end[0]-p[0])) if end[0]!=p[0] else 0,int(math.copysign(1,end[1]-p[1])) if end[1]!=p[1] else 0))
            if len(directions)>=3:add({'id':'junction-'+net+'-'+str(p),'kind':'junction','at':list(p),'diameter':.7})
    for key in plan.get('nc',[]):add({'id':'nc-'+key,'kind':'no_connect','at':list(pinmap[key]['pos'])})
    for index,net in enumerate(plan.get('supplied_nets',[]),1):
        key=next(n['nodes'][0] for n in plan['nets'] if n['name']==net);pos=pinmap[key]['pos'];ref='#PWR'+str(index).zfill(2)
        state['symbols']['SupplyDeclaration']={'name':'SupplyDeclaration','pins':[{'number':'1','name':'~','at':[0,0,0],'length':0,'type':'power_out'}],'pin_names_visible':False,'pin_numbers_visible':False}
        add({'id':'supply-'+net,'kind':'component','symbol':'SupplyDeclaration','reference':ref,'value':'SUPPLIED','at':list(pos)+[0],'in_bom':False,'on_board':False,
             'properties':[{'name':name,'value':value,'at':list(pos),'visible':False} for name,value in [('Role','ERCHelper'),('Reference',ref),('Value','SUPPLIED'),('Footprint',''),('Datasheet','')]]})
    state['functional_layout']={'version':1,'plan':copy.deepcopy(plan),'groups':groups,'source':'model-authored topology; deterministic geometry-based placement and orthogonal routing'}
    state['revision']+=1
    return state


def physical_graph(state):
    segs=[(point(a),point(b)) for w in state['items'].values() if w['kind']=='wire' for a,b in zip(w['points'],w['points'][1:])]
    pins={c['reference']+'.'+p['number']:world(c,p['at']) for c in state['items'].values() if c['kind']=='component' for p in state['symbols'][c['symbol']]['pins']}
    points=set(pins.values())|{point(i['at']) for i in state['items'].values() if i['kind']=='junction'}|{p for seg in segs for p in seg}
    parent={p:p for p in points}
    def find(p):
        if parent[p]!=p:parent[p]=find(parent[p])
        return parent[p]
    for a,b in segs:
        inside=[p for p in points if on(p,a,b)]
        for p in inside:parent[find(p)]=find(a)
    return {k:find(p) for k,p in pins.items()},segs


def audit(state, netlist_path, layout_report=None):
    meta=state.get('functional_layout');errors=[]
    if not meta:return {'status':'failed','errors':['Functional grouping and routed composition missing; call precise_compose'],'scope':'Readability requires real local wires, not isolated labelled leads.'}
    plan=meta['plan'];physical,segs=physical_graph(state)
    groupof={ref:g['id'] for g in meta['groups'] for ref in g['parts']}
    local_checks=[];possible=0;visible=0
    for net in plan['nets']:
        possible+=len(net['nodes'])-1
        roots={physical.get(k,k) for k in net['nodes']};visible+=len(net['nodes'])-len(roots)
        local=collections.defaultdict(list)
        for k in net['nodes']:local[groupof[k.rsplit('.',1)[0]]].append(k)
        for group,nodes in local.items():
            if len(nodes)<2:continue
            ok=len({physical.get(k,k) for k in nodes})==1
            local_checks.append({'group':group,'net':net['name'],'nodes':nodes,'passed':ok})
            if not ok:errors.append('Local connection must use continuous real wires: '+group+'/'+net['name'])
    coverage=visible/possible if possible else 0
    if coverage<.60:errors.append('Too many label-separated islands; visible connectivity coverage must be >=60%, actual '+str(round(coverage*100,1))+'%; combine related functional groups')
    thin_wires=[i['id'] for i in state['items'].values() if i['kind']=='wire' and i.get('width',0)<.15]
    if thin_wires:errors.append('Use an explicit readable wire width >=0.15 mm; thin/default wires='+str(len(thin_wires)))
    tiny_junctions=[i['id'] for i in state['items'].values() if i['kind']=='junction' and i.get('diameter',0)<.45]
    if tiny_junctions:errors.append('Use explicit visible junction dots >=0.45 mm; tiny/default dots='+str(len(tiny_junctions)))
    actual={}
    for n in ET.parse(netlist_path).getroot().findall('./nets/net'):
        members={x.get('ref')+'.'+x.get('pin') for x in n.findall('node') if not x.get('ref').startswith(('#PWR','#ERC'))}
        for p in members:actual[p]=members
    for net in plan['nets']:
        expected=set(net['nodes'])
        if any(actual.get(p)!=expected for p in expected):errors.append('Rendered net differs from MODEL topology: '+net['name'])
    for p in plan.get('nc',[]):
        if actual.get(p)!={p}:errors.append('NC pin has changed connectivity: '+p)
    if layout_report and layout_report.get('status')!='passed':errors.append('Rendered PDF geometry check has findings')
    # All visible content must stay in its functional block and the page frame.
    for c in state['items'].values():
        if c['kind']!='component' or c['reference'] not in groupof:continue
        b=part_bounds(c,state['symbols'][c['symbol']]);g=next(g for g in meta['groups'] if g['id']==groupof[c['reference']])['box']
        if b[0]<g[0] or b[1]<g[1]+6 or b[2]>g[2] or b[3]>g[3]:errors.append('Part/fields outside functional block: '+c['reference'])
    return {'status':'passed' if not errors else 'failed','errors':errors,'functionalGroups':[{'id':g['id'],'title':g['title'],'references':g['parts'],'boundsMm':g['box']} for g in meta['groups']],
            'localWireChecks':local_checks,'localWireChecksPassed':sum(c['passed'] for c in local_checks),'visibleConnectivityCoverage':round(coverage,4),'wireSegments':len(segs),
            'netLabels':sum(i['kind']=='label' for i in state['items'].values()),'thinWireCount':len(thin_wires),'tinyJunctionCount':len(tiny_junctions),'modelTopologyMatchesNative':not any('topology' in e or 'NC pin' in e for e in errors),
            'layoutMetrics':drawing_cost(state),'visualReview':'Required: inspect the actual whole-page and dense-area render; numeric checks alone do not approve readability.'}


def drawing_cost(state):
    segs=[(a,b) for w in state['items'].values() if w['kind']=='wire' for a,b in zip(w['points'],w['points'][1:])]
    length=sum(abs(a[0]-b[0])+abs(a[1]-b[1]) for a,b in segs)
    crossings=sum(min(a[0],b[0])<c[0]<max(a[0],b[0]) and min(c[1],d[1])<a[1]<max(c[1],d[1]) for a,b in segs if a[1]==b[1] for c,d in segs if c[0]==d[0])
    area=sum(g['w']*g['h'] for g in state['functional_layout']['groups'])
    return {'crossings':crossings,'wireLengthMm':round(length,2),'blockAreaMm2':round(area,2),'score':round(length+crossings*65+area*.025,2)}


def compose(state,lib,plan):
    # Search relative placements only. Frozen geometry and model-authored nets never change.
    validate_plan(lib,plan)
    import random
    rng=random.Random(1616)
    candidates=[copy.deepcopy(plan)]
    flank=copy.deepcopy(plan)
    byref={c['ref']:c for c in lib['objects']}
    for group in flank['groups']:
        refs=[ref for col in group['columns'] for ref in col]
        hubs=[ref for ref in refs if sum(p['type']=='output' for p in byref[ref]['pins'])>=4]
        if len(hubs)!=1:continue
        hub=hubs[0];left=[];right=[]
        for ref in refs:
            if len(byref[ref]['pins'])!=2:continue
            for net in flank['nets']:
                if not any(n.rsplit('.',1)[0]==ref for n in net['nodes']):continue
                matches=[n.rsplit('.',1)[1] for n in net['nodes'] if n.rsplit('.',1)[0]==hub]
                for number in matches:
                    pin=next(p for p in byref[hub]['pins'] if p['number']==number)
                    angle=(pin['angle']+flank.get('rotations',{}).get(hub,0))%360
                    if pin['type']=='output' and angle in (0,180):
                        (left if angle==0 else right).append((-pin['localAt'][1],ref))
                        branch_nodes=[n.rsplit('.',1)[1] for n in net['nodes'] if n.rsplit('.',1)[0]==ref]
                        if len(branch_nodes)==1:
                            rp=next(p for p in byref[ref]['pins'] if p['number']==branch_nodes[0])
                            flank.setdefault('rotations',{})[ref]=(angle+180-rp['angle'])%360
        used={ref for _,ref in left+right}
        if not left or not right:continue
        remaining=[ref for ref in refs if ref!=hub and ref not in used]
        group['columns']=[[ref for _,ref in sorted(left)],[hub],[ref for _,ref in sorted(right)]]+([remaining] if remaining else [])
    candidates.append(flank)
    motifs=copy.deepcopy(flank)
    for group in motifs['groups']:
        refs=[ref for col in group['columns'] for ref in col]
        # Recognize a parallel bank by identical net memberships, not reference names.
        memberships={ref:tuple(sorted(n['name'] for n in plan['nets'] if any(k.rsplit('.',1)[0]==ref for k in n['nodes']))) for ref in refs}
        if len(refs)>1 and all(len(byref[ref]['pins'])==2 for ref in refs) and len(set(memberships.values()))==1:
            group['_motif']='parallel_rails';group['columns']=[[ref] for ref in refs]
            top_net=memberships[refs[0]][0]
            for ref in refs:
                node=next(k for n in plan['nets'] if n['name']==top_net for k in n['nodes'] if k.rsplit('.',1)[0]==ref)
                pin=next(p for p in byref[ref]['pins'] if p['number']==node.rsplit('.',1)[1])
                motifs.setdefault('rotations',{})[ref]=(270-pin['angle'])%360
        hubs=[ref for ref in refs if len(byref[ref]['pins'])>=6 and all(p['type']=='passive' for p in byref[ref]['pins'])]
        if len(hubs)==1 and all(ref==hubs[0] or len(byref[ref]['pins'])==2 for ref in refs):
            hub=hubs[0];group['_motif']='pin_banks';group['_hub']=hub
            motifs.setdefault('rotations',{})[hub]=0
            for ref in refs:
                if ref==hub:continue
                for net in plan['nets']:
                    hp=[n.rsplit('.',1)[1] for n in net['nodes'] if n.rsplit('.',1)[0]==hub]
                    rp=[n.rsplit('.',1)[1] for n in net['nodes'] if n.rsplit('.',1)[0]==ref]
                    if len(hp)==len(rp)==1:
                        hpin=next(p for p in byref[hub]['pins'] if p['number']==hp[0])
                        rpin=next(p for p in byref[ref]['pins'] if p['number']==rp[0])
                        motifs['rotations'][ref]=(hpin['angle']+180-rpin['angle'])%360
    candidates.append(motifs)

    for index in range(35):
        trial=copy.deepcopy(plan)
        trial['spacing']=[.8,.9,1.0][index%3]
        for group in trial['groups']:
            cols=group['columns']
            if index%4==0:cols.reverse()
            elif index%4==1 and len(cols)>2:cols[0],cols[1]=cols[1],cols[0]
            elif index%4==2:rng.shuffle(cols)
            if index%3==0:
                for col in cols:col.reverse()
            # Sort multi-part columns by neighbours' actual local pin order.
            if index%3==1:
                for col in cols:
                    def rank(ref):
                        values=[]
                        for net in trial['nets']:
                            if not any(n.rsplit('.',1)[0]==ref for n in net['nodes']):continue
                            for n in net['nodes']:
                                peer,num=n.rsplit('.',1)
                                if peer in col:continue
                                source=next((c for c in lib['objects'] if c['ref']==peer),None)
                                if source and len(source['pins'])>2:
                                    pin=next(p for p in source['pins'] if p['number']==num)
                                    values.append(-pin['localAt'][1])
                        return sum(values)/len(values) if values else 0
                    col.sort(key=rank)
        candidates.append(trial)
    best=None;cost=None;failures=[];attempted=0;feasible=0
    for candidate in candidates:
        try:
            attempted+=1
            result=compose_candidate(state,lib,candidate);feasible+=1
            metric=drawing_cost(result)
            if cost is None or metric['score']<cost['score']:best=result;cost=metric
        except ValueError as e:failures.append(str(e))
    if best is not None:
        for source in [c for c in lib['objects'] if len(c['pins'])>=6]:
            for angle in [0,90,180,270]:
                candidate=copy.deepcopy(best['functional_layout']['plan'])
                candidate.setdefault('rotations',{})[source['ref']]=angle
                try:
                    attempted+=1
                    result=compose_candidate(state,lib,candidate);feasible+=1;metric=drawing_cost(result)
                    if metric['score']<cost['score']:best=result;cost=metric
                except ValueError:pass
    if best is not None:
        for gi,group in enumerate(best['functional_layout']['plan']['groups']):
            for ci,col in enumerate(group['columns']):
                for ri in range(len(col)-1):
                    candidate=copy.deepcopy(best['functional_layout']['plan'])
                    rows=candidate['groups'][gi]['columns'][ci]
                    rows[ri],rows[ri+1]=rows[ri+1],rows[ri]
                    try:
                        attempted+=1
                        result=compose_candidate(state,lib,candidate);feasible+=1;metric=drawing_cost(result)
                        if metric['score']<cost['score']:best=result;cost=metric
                    except ValueError:pass
    if best is None:raise ValueError(failures[0])
    best['functional_layout']['optimization']={**cost,'candidateCount':attempted,'feasibleCount':feasible}
    return best
