"""Compact a functional hub's input shunts and decoupling using current pins.

Only electrical roles and generated/library bounds enter this rule. No device
names, reference designators, saved drawings or source coordinates are used.
"""
import copy, math

def surround(bank, refs, design, resources, specs, pinmap, gap, parts):
    comps={c['ref']:c for c in design['components']}
    inside={c['id'] for c in bank['children']}
    hubs=[comps[r] for r in inside if len(comps[r]['pins'])>2]
    if len(hubs)!=1:return None
    hub=hubs[0]
    if not resources['symbols'][hub['librarySymbol']].get('drawingRules'):return None
    netof={k:n['name'] for n in design['nets'] for k in n['nodes']}
    keys={p['number']:hub['ref']+'.'+p['number'] for p in hub['pins']}
    ground={netof.get(keys[p['number']]) for p in hub['pins'] if p['name'].upper() in ('GND','VSS','SGND','AGND','DGND')}
    power={netof.get(keys[p['number']]):keys[p['number']] for p in hub['pins'] if p['type']=='power_in' and netof.get(keys[p['number']]) not in ground}
    inputs={netof.get(keys[p['number']]):keys[p['number']] for p in hub['pins'] if p['type']=='input'}
    shunts=[];caps=[]
    for r in refs:
        if r in inside:continue
        c=comps[r];symbol=resources['symbols'][c['librarySymbol']]
        if symbol.get('appearance',{}).get('kind')!='capacitor' or len(c['pins'])!=2:return None
        terminals={netof.get(r+'.'+p['number']):r+'.'+p['number'] for p in c['pins']}
        non_ground=set(terminals)-ground
        if len(non_ground)!=1 or not set(terminals)&ground:return None
        net=next(iter(non_ground));sp=terminals[net]
        gp=next(terminals[n] for n in terminals if n in ground)
        if pinmap[sp]['direction']!=[0,-1] or pinmap[gp]['direction']!=[0,1]:return None
        if net in inputs and pinmap[inputs[net]]['direction']==[-1,0]:shunts.append((r,inputs[net],sp))
        elif net in power and pinmap[power[net]]['direction']==[0,-1]:caps.append((r,power[net],sp))
        else:return None
    if not shunts and not caps:return None
    positions={c['id']:[c['x']-specs[c['id']]['_low'][0],c['y']-specs[c['id']]['_low'][1]] for c in bank['children']}
    def point(k):
        x,y=positions[k.rsplit('.',1)[0]];px,py=pinmap[k]['pos'];return [round(x+px,4),round(y+py,4)]
    ceil=lambda n:math.ceil(n/1.27)*1.27
    segments=[]
    def line(a,b):
        if a!=b:segments.append((a,b))
    # Independent input trunks terminate in short vertical shunts. The
    # capacitors share one row, rather than forcing each signal to detour.
    if shunts:
        shunts.sort(key=lambda b:point(b[1])[1])
        y=ceil(max(point(hp)[1] for _,hp,_ in shunts)+12.7)
        right=min(point(hp)[0] for _,hp,_ in shunts)-10.16
        for r,hp,sp in shunts:
            spec=specs[r]
            x=right-spec['_low'][0]-spec['width']
            positions[r]=[x,y-pinmap[sp]['pos'][1]]
            a,b=point(hp),point(sp)
            line(a,[b[0],a[1]]);line([b[0],a[1]],b)
            right=x+spec['_low'][0]-max(gap,3.81)
    # Each evidenced supply gets one straight rail above a parallel cap row.
    for source in sorted({hp for _,hp,_ in caps}):
        group=[v for v in caps if v[1]==source]
        a=point(source)
        top=min(point(k)[1] for k in keys.values())
        y=ceil(top-25.4)
        left=a[0]+10.16
        taps=[]
        for r,hp,sp in group:
            spec=specs[r]
            positions[r]=[left-spec['_low'][0],y-pinmap[sp]['pos'][1]]
            b=point(sp);taps.append(b)
            left+=ceil(spec['width']+max(gap,3.81))
        rail_y=y-5.08
        line(a,[a[0],rail_y])
        line([min(a[0],*(p[0] for p in taps)),rail_y],[max(a[0],*(p[0] for p in taps)),rail_y])
        for b in taps:line([b[0],rail_y],b)
    bounds=[p for edge in segments for p in edge]
    for r,(x,y) in positions.items():
        spec=specs[r]
        bounds.extend([[x+spec['_low'][0],y+spec['_low'][1]],[x+spec['_low'][0]+spec['width'],y+spec['_low'][1]+spec['height']]])
    lx=min(p[0] for p in bounds)-5.08;ly=min(p[1] for p in bounds)-10.16
    rx=max(p[0] for p in bounds)+5.08;by=max(p[1] for p in bounds)+5.08
    edges=copy.deepcopy(bank['edges'])
    for edge in edges:
        for section in edge.get('sections',[]):
            for p in [section['startPoint'],*section.get('bendPoints',[]),section['endPoint']]:p['x']-=lx;p['y']-=ly
    edges.extend({'sections':[{'startPoint':{'x':a[0]-lx,'y':a[1]-ly},'endPoint':{'x':b[0]-lx,'y':b[1]-ly}}]} for a,b in segments)
    return {'id':bank['id'],'width':rx-lx,'height':by-ly,'children':[{'id':r,'x':x+specs[r]['_low'][0]-lx,'y':y+specs[r]['_low'][1]-ly} for r,(x,y) in positions.items()],'edges':edges,'placementRule':'functional-hub-shunts-and-decoupling'}
