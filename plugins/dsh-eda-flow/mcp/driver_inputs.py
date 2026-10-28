"""Attach input shunts to a driver's actual input rows, beside its series bank."""
import copy, math
from functional_groups import _kind,_is_kind

def ground_island(design,resources,refs):
    """Derive the input-filter return island from frozen electrical facts.

    Only its connection to the driver ground may use a net label. Input
    signals and the short common return within the filter remain wired.
    """
    comps=[c for c in design['components'] if c['ref'] in refs]
    hubs=[c for c in comps if len(c['pins'])>2]
    if len(hubs)!=1:return set()
    hub=hubs[0]
    if sum(p['type']=='output' for p in hub['pins'])<3:return set()
    netof={k:n['name'] for n in design['nets'] for k in n['nodes']}
    ground=next((netof.get(hub['ref']+'.'+p['number']) for p in hub['pins'] if p['name'].upper()=='GND' and p['type']=='power_in'),None)
    inputs={netof.get(hub['ref']+'.'+p['number']) for p in hub['pins'] if p['type']=='input'}
    if ground is None:return set()
    result=set()
    for c in comps:
        if len(c['pins'])!=2 or not _is_kind(_kind(c,resources),'capacitor'):continue
        terms={netof.get(c['ref']+'.'+p['number']):c['ref']+'.'+p['number'] for p in c['pins']}
        signals=set(terms)-{ground}
        if ground in terms and len(signals)==1 and signals<=inputs:result.add(terms[ground])
    return result if len(result)>=2 else set()

def surround(bank,refs,design,resources,specs,pinmap,gap,parts):
    from driver_decoupling import surround as decoupling
    comps={c['ref']:c for c in design['components']}
    inside={c['id'] for c in bank['children']}
    hubs=[comps[r] for r in inside if len(comps[r]['pins'])>2]
    if len(hubs)!=1:return None
    hub=hubs[0]
    netof={k:n['name'] for n in design['nets'] for k in n['nodes']}
    ground=next((hub['ref']+'.'+p['number'] for p in hub['pins'] if p['name'].upper()=='GND'),None)
    if not ground:return None
    inputs={netof[hub['ref']+'.'+p['number']]:hub['ref']+'.'+p['number'] for p in hub['pins'] if p['type']=='input' and pinmap[hub['ref']+'.'+p['number']]['direction']==[-1,0]}
    branches=[]
    for r in refs:
        if r in inside:continue
        c=comps[r]
        if resources['symbols'][c['librarySymbol']].get('appearance',{}).get('kind') not in ('specified-capacitor','capacitor'):continue
        terms={netof.get(r+'.'+p['number']):r+'.'+p['number'] for p in c['pins']}
        signals=set(terms)-{netof[ground]}
        if netof[ground] not in terms or len(signals)!=1:continue
        signal=next(iter(signals))
        if signal not in inputs:continue
        sp,gp=terms[signal],terms[netof[ground]]
        if [pinmap[k]['direction'] for k in (sp,gp)]!=[[0,-1],[0,1]]:return None
        branches.append((r,inputs[signal],sp,gp))
    if len(branches)<2:return None
    shunts={b[0] for b in branches}
    base=decoupling(bank,[r for r in refs if r not in shunts],design,resources,specs,pinmap,gap,parts)
    if base is None:return None
    positions={c['id']:[c['x']-specs[c['id']]['_low'][0],c['y']-specs[c['id']]['_low'][1]] for c in base['children']}
    def point(k):
        x,y=positions[k.rsplit('.',1)[0]];px,py=pinmap[k]['pos'];return [round(x+px,4),round(y+py,4)]
    branches.sort(key=lambda b:point(b[1])[1],reverse=True)
    from design_audit import child,children
    from native_resources import Atom as A
    # Vertical fields keep a bank of shunts compact without hiding values.
    for r,_,sp,gp in branches:
        center=(pinmap[sp]['pos'][1]+pinmap[gp]['pos'][1])/2
        for field in children(parts[r],'property'):
            if field[1] not in ('Reference','Value'):continue
            x=-3.81 if field[1]=='Reference' else 3.81
            child(field,'at')[1:]=[A(str(x)),A(str(center)),A('90')]
            eff=child(field,'effects');eff[:]=[v for v in eff if not isinstance(v,list) or v[0]!='justify']
        half=max(len(comps[r]['value'])*1.15/2,7.62)
        specs[r]['_low']=[-5.08,center-half];specs[r]['width']=10.16;specs[r]['height']=2*half
    pitch=math.ceil(max(7.62,gap+5.08)/1.27)*1.27
    # Stay to the left of the complete driver bank, including resistor labels.
    near=-7.62;cap_y=max(point(b[1])[1] for b in branches)+12.7
    segments=[]
    def line(a,b):
        if a!=b:segments.append((a,b))
    for i,(r,hp,sp,gp) in enumerate(branches):
        x=near-(len(branches)-1-i)*pitch
        positions[r]=[x-pinmap[sp]['pos'][0],cap_y-pinmap[sp]['pos'][1]]
    rail=max(point(gp)[1] for _,_,_,gp in branches)+7.62
    lead=min(point(sp)[0] for _,_,sp,_ in branches)-10.16
    net_labels=[]
    for r,hp,sp,gp in branches:
        h,s,g=point(hp),point(sp),point(gp)
        line([lead,h[1]],h);line([s[0],h[1]],s);line(g,[g[0],rail])
        net_labels.append({'net':netof[hp],'pos':[lead,h[1]],'direction':[1,0]})
    # The short filter return gets its own ground label. Do not wrap a wire
    # around the driver merely to connect two already named ground islands.
    line([min(point(sp)[0] for _,_,sp,_ in branches),rail],[near,rail])
    bounds=[p for seg in segments for p in seg]+[[0,0],[base['width'],base['height']]]
    for r,(x,y) in positions.items():
        s=specs[r];bounds.extend([[x+s['_low'][0],y+s['_low'][1]],[x+s['_low'][0]+s['width'],y+s['_low'][1]+s['height']]])
    lx=min(p[0] for p in bounds)-5.08;ly=min(p[1] for p in bounds)
    rx=max(p[0] for p in bounds)+5.08;by=max(p[1] for p in bounds)+5.08
    edges=copy.deepcopy(base['edges'])
    edges.extend({'sections':[{'startPoint':{'x':a[0],'y':a[1]},'endPoint':{'x':b[0],'y':b[1]}}]} for a,b in segments)
    for e in edges:
        for s in e.get('sections',[]):
            for p in [s['startPoint'],*s.get('bendPoints',[]),s['endPoint']]:p['x']-=lx;p['y']-=ly
    return {'id':bank['id'],'width':rx-lx,'height':by-ly,'children':[{'id':r,'x':x+specs[r]['_low'][0]-lx,'y':y+specs[r]['_low'][1]-ly} for r,(x,y) in positions.items()],'edges':edges,'netLabels':[{**l,'pos':[l['pos'][0]-lx,l['pos'][1]-ly]} for l in net_labels]}
