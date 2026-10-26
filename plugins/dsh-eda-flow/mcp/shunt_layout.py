"""Arrange a bank of input shunt capacitors against a connector's actual pin rows."""
import math

def place(group,design,resources,specs,pinmap,gap):
    comps={c['ref']:c for c in design['components'] if c['ref'] in group['references']}
    hubs=[c for c in comps.values() if len(c['pins'])>2]
    if len(hubs)!=1:return None
    hub=hubs[0];caps=[c for c in comps.values() if c is not hub]
    if len(caps)<2 or any(len(c['pins'])!=2 or resources['symbols'][c['librarySymbol']].get('appearance',{}).get('kind')!='specified-capacitor' for c in caps):return None
    netof={p:n['name'] for n in design['nets'] for p in n['nodes']}
    terminals=lambda c:{netof.get(c['ref']+'.'+p['number']):c['ref']+'.'+p['number'] for p in c['pins']}
    shared=set.intersection(*(set(terminals(c)) for c in caps))
    if len(shared)!=1 or None in shared:return None
    common=next(iter(shared));hub_terms=terminals(hub)
    if common not in hub_terms:return None
    ground=hub_terms[common]
    if pinmap[ground]['direction']!=[-1,0]:return None
    branches=[]
    for c in caps:
        terms=terminals(c);signals=set(terms)-{common}
        if len(signals)!=1:return None
        signal=next(iter(signals))
        if signal not in hub_terms:return None
        hp,cp,gp=hub_terms[signal],terms[signal],terms[common]
        if [pinmap[k]['direction'] for k in (hp,cp,gp)]!=[[-1,0],[0,-1],[0,1]]:return None
        branches.append((c,hp,cp,gp))
    branches.sort(key=lambda b:pinmap[b[1]]['pos'][1])
    if len({b[1] for b in branches})!=len(branches):return None
    ceil=lambda v:math.ceil(v/1.27)*1.27
    pitch=ceil(max(17.78,*[len(c['value'])*.92+gap+5.08 for c in caps]))
    connector_x=min(pinmap[k]['pos'][0] for k in hub_terms.values());trunk_x=connector_x-15.24
    cap_y=max(pinmap[k]['pos'][1] for k in hub_terms.values())+10.16
    positions={hub['ref']:[0,0]}
    def point(k):
        x,y=positions[k.rsplit('.',1)[0]];px,py=pinmap[k]['pos'];return [round(x+px,4),round(y+py,4)]
    for i,(c,hp,cp,gp) in enumerate(branches):
        local=[pinmap[k]['pos'] for k in (cp,gp)]
        positions[c['ref']]=[trunk_x-(len(caps)-i)*pitch-(local[0][0]+local[1][0])/2,cap_y-(local[0][1]+local[1][1])/2]
    rail_y=max(point(gp)[1] for _,_,_,gp in branches)+7.62;segments=[]
    def line(a,b):
        if a!=b:segments.append((a,b))
    for c,hp,cp,gp in branches:
        a,b=point(hp),point(cp);line(a,[b[0],a[1]]);line([b[0],a[1]],b)
        p=point(gp);line(p,[p[0],rail_y])
    ground_point=point(ground);line(ground_point,[trunk_x,ground_point[1]]);line([trunk_x,ground_point[1]],[trunk_x,rail_y])
    line([point(branches[0][3])[0],rail_y],[trunk_x,rail_y])
    bounds=[p for segment in segments for p in segment]
    for r,(x,y) in positions.items():
        s=specs[r];bounds += [[x+s['_low'][0],y+s['_low'][1]],[x+s['_low'][0]+s['width'],y+s['_low'][1]+s['height']]]
    left=min(p[0] for p in bounds)-5.08;top=min(p[1] for p in bounds)-10.16;right=max(p[0] for p in bounds)+5.08;bottom=max(p[1] for p in bounds)+5.08
    return {'id':group['id'],'width':right-left,'height':bottom-top,
            'children':[{'id':r,'x':x+specs[r]['_low'][0]-left,'y':y+specs[r]['_low'][1]-top} for r,(x,y) in positions.items()],
            'edges':[{'sections':[{'startPoint':{'x':a[0]-left,'y':a[1]-top},'endPoint':{'x':b[0]-left,'y':b[1]-top}}]} for a,b in segments]}
