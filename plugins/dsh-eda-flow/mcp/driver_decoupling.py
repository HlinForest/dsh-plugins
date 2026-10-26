"""Place parallel supply capacitors above a generated pin-aligned driver bank.

Uses current symbol geometry and connectivity, never a saved circuit fragment.
"""
import copy,math

def surround(bank,refs,design,resources,specs,pinmap,gap,parts):
    internal={c['id']:c for c in bank['children']}
    comps={c['ref']:c for c in design['components']}
    caps=[comps[r] for r in refs if r not in internal]
    hubs=[comps[r] for r in internal if len(comps[r]['pins'])>2]
    if len(hubs)!=1 or not caps:return None
    hub=hubs[0];names={p['name'].upper():hub['ref']+'.'+p['number'] for p in hub['pins'] if p['type']=='power_in'}
    supply=names.get('VDD') or names.get('VCC');ground=names.get('GND')
    if not supply or not ground:return None
    if pinmap[supply]['direction']!=[-1,0] or pinmap[ground]['direction']!=[1,0]:return None
    netof={k:n['name'] for n in design['nets'] for k in n['nodes']}
    pairs=[]
    for c in caps:
        if len(c['pins'])!=2 or resources['symbols'][c['librarySymbol']].get('appearance',{}).get('kind') not in ('specified-capacitor','capacitor'):return None
        terms={netof.get(c['ref']+'.'+p['number']):c['ref']+'.'+p['number'] for p in c['pins']}
        if set(terms)!={netof[supply],netof[ground]}:return None
        a,b=terms[netof[supply]],terms[netof[ground]]
        if pinmap[a]['direction']!=[-1,0] or pinmap[b]['direction']!=[1,0]:return None
        pairs.append((c,a,b))
    from design_audit import child,children
    from native_resources import Atom as A
    for c,sp,gp in pairs:
        angle=float(child(parts[c['ref']],'at')[3])
        for field in children(parts[c['ref']],'property'):
            if field[1] not in ('Reference','Value'):continue
            x=pinmap[sp]['pos'][0]-5.08 if field[1]=='Reference' else pinmap[gp]['pos'][0]+2.54
            child(field,'at')[1:]=[A(str(x)),A(str(pinmap[sp]['pos'][1]-2.54)),A(str(angle%180))]
            effects=child(field,'effects');effects[:]=[e for e in effects if not isinstance(e,list) or e[0]!='justify']
            effects.append([A('justify'),*(A(v) for v in (('right','top') if angle in (90,180) else ('left','bottom')))])
        spec=specs[c['ref']]
        spec['_low'][1]=pinmap[sp]['pos'][1]-5.08;spec['height']=10.16
        spec['width']=max(spec['width'],pinmap[gp]['pos'][0]+2.54+len(c['value'])*1.15+2.54-spec['_low'][0])
    positions={r:[c['x']-specs[r]['_low'][0],c['y']-specs[r]['_low'][1]] for r,c in internal.items()}
    def point(k):
        x,y=positions[k.rsplit('.',1)[0]];px,py=pinmap[k]['pos'];return [round(x+px,4),round(y+py,4)]
    ceil=lambda x:math.ceil(x/1.27)*1.27
    a,b=point(supply),point(ground)
    left=a[0]-12.7;right=b[0]+12.7
    top=min(point(hub['ref']+'.'+p['number'])[1] for p in hub['pins'])-7.62
    pitch=ceil(max(7.62,gap+2.54))
    segments=[]
    def line(a,b):
        if a!=b:segments.append((a,b))
    for i,(c,sp,gp) in enumerate(pairs):
        # Field rectangles determine the horizontal allowance, so long values
        # cannot spill into either power rail.
        x=left+7.62-pinmap[sp]['pos'][0];y=top-i*pitch-pinmap[sp]['pos'][1]
        positions[c['ref']]=[x,y]
        right=max(right,ceil(x+specs[c['ref']]['_low'][0]+specs[c['ref']]['width']+5.08))
    for c,sp,gp in pairs:
        p,q=point(sp),point(gp);line([left,p[1]],p);line(q,[right,q[1]])
    top_y=min(point(sp)[1] for _,sp,_ in pairs)
    line(a,[left,a[1]]);line([left,a[1]],[left,top_y])
    line(b,[right,b[1]]);line([right,b[1]],[right,top_y])
    bounds=[p for s in segments for p in s]
    for r,(x,y) in positions.items():
        spec=specs[r];bounds.extend([[x+spec['_low'][0],y+spec['_low'][1]],[x+spec['_low'][0]+spec['width'],y+spec['_low'][1]+spec['height']]])
    lx=min(p[0] for p in bounds)-5.08;ly=min(p[1] for p in bounds)-10.16
    rx=max(p[0] for p in bounds)+5.08;by=max(p[1] for p in bounds)+5.08
    edges=copy.deepcopy(bank['edges'])
    edges.extend({'sections':[{'startPoint':{'x':p[0],'y':p[1]},'endPoint':{'x':q[0],'y':q[1]}}]} for p,q in segments)
    for edge in edges:
        for s in edge.get('sections',[]):
            for p in [s['startPoint'],*s.get('bendPoints',[]),s['endPoint']]:p['x']-=lx;p['y']-=ly
    return {'id':bank['id'],'width':rx-lx,'height':by-ly,'children':[{'id':r,'x':x+specs[r]['_low'][0]-lx,'y':y+specs[r]['_low'][1]-ly} for r,(x,y) in positions.items()],'edges':edges}
