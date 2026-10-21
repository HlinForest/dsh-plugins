"""Relative placement for an evidenced receiver, RC supply filter and pull-up.
Recognized by connectivity and symbol roles, never by reference names or old CAD.
"""
import math

def place(group, design, resources, specs, pinmap, gap, parts=None):
    comps={c['ref']:c for c in design['components'] if c['ref'] in group['references']}
    kind=lambda c:resources['symbols'][c['librarySymbol']].get('appearance',{}).get('kind')
    hubs=[c for c in comps.values() if kind(c) in ('specified-receiver','infrared-receiver')]
    if len(hubs)!=1:return None
    hub=hubs[0];ref=hub['ref'];netof={p:n['name'] for n in design['nets'] for p in n['nodes']}
    pins={p['name'].upper():ref+'.'+p['number'] for p in hub['pins']}
    if not {'VCC','GND','OUT'}<=pins.keys():return None
    v,g,o=[pins[k] for k in ('VCC','GND','OUT')]
    if any(pinmap[k]['direction']!=[1,0] for k in (v,g,o)):return None
    cap=[];series=[];pull=[];connectors=[]
    def terminals(c):return {netof.get(c['ref']+'.'+p['number']):c['ref']+'.'+p['number'] for p in c['pins']}
    for c in comps.values():
        if c is hub:continue
        if len(c['pins'])>2 and kind(c) in ('specified-box','connector'):
            connectors.append(c);continue
        if len(c['pins'])!=2:return None
        terms=terminals(c);nets=set(terms)
        if kind(c) in ('specified-capacitor','capacitor') and nets=={netof[v],netof[g]}:cap.append(c)
        elif kind(c) in ('specified-resistor','resistor') and netof[v] in nets and netof[g] not in nets:series.append(c)
        elif kind(c) in ('specified-resistor','resistor') and netof[o] in nets and netof[g] not in nets:pull.append(c)
        else:return None
    if len(series)!=1 or len(pull)!=1 or not cap:return None
    series,pull=series[0],pull[0];st,pt=terminals(series),terminals(pull)
    source=set(st)-{netof[v]}
    if len(source)!=1:return None
    supply=next(iter(source))
    if set(pt)!={netof[o],supply}:return None
    if len(connectors)>1:return None
    connector=connectors[0] if connectors else None
    if connector:
        ct=terminals(connector)
        if len(ct)!=len(connector['pins']) or not {supply,netof[g],netof[o]}<=ct.keys():return None
        if any(pinmap[k]['direction']!=[-1,0] for k in ct.values()):return None
    si,so,pi,po=st[netof[v]],st[supply],pt[supply],pt[netof[o]]
    if [pinmap[k]['direction'] for k in (si,so,pi,po)]!=[[-1,0],[1,0],[0,-1],[0,1]]:return None
    for c in cap:
        t=terminals(c)
        if pinmap[t[netof[v]]]['direction']!=[0,-1] or pinmap[t[netof[g]]]['direction']!=[0,1]:return None
    step=1.27;up=lambda n:math.ceil(n/step)*step
    vx,vy=pinmap[v]['pos'];gx,gy=pinmap[g]['pos'];ox,oy=pinmap[o]['pos']
    rail_y=min(vy,oy,gy)-20.32;cap_y=(rail_y+gy)/2
    trunk_x=vx+up(max(12.7,len(netof[v])*.92+7.62))
    positions={ref:[0,0]};cap_x=trunk_x+7.62
    for c in cap:
        if parts is not None:
            from design_audit import child,children
            from native_resources import Atom as A
            for field in children(parts[c['ref']],'property'):
                if field[1] not in ('Reference','Value'):continue
                child(field,'at')[1:]=[A(str(-3.81 if field[1]=='Reference' else 3.81)),A('0'),A('90')]
                eff=child(field,'effects');eff[:]=[v for v in eff if not isinstance(v,list) or v[0]!='justify']
            half=max(len(c['value'])*1.15/2,7.62)
            specs[c['ref']]['_low']=[-5.08,-half];specs[c['ref']]['width']=10.16;specs[c['ref']]['height']=2*half
        positions[c['ref']]=[cap_x,cap_y]
        cap_x+=up(max(10.16,gap+5.08) if parts is not None else max(15.24,len(c['value'])*.92+gap+5.08))
    sx=cap_x+5.08;positions[series['ref']]=[sx,rail_y-pinmap[si]['pos'][1]]
    def point(k):
        x,y=positions[k.rsplit('.',1)[0]];px,py=pinmap[k]['pos'];return [round(x+px,4),round(y+py,4)]
    pull_x=point(so)[0]+15.24
    positions[pull['ref']]=[pull_x,(rail_y+oy)/2]
    segments=[]
    def line(a,b):
        if a!=b:segments.append((a,b))
    line([vx,vy],[trunk_x,vy]);line([trunk_x,vy],[trunk_x,rail_y]);line([trunk_x,rail_y],point(si))
    line(point(so),[pull_x,rail_y]);line([pull_x,rail_y],point(pi));line(point(po),[pull_x,oy]);line([ox,oy],[pull_x,oy])
    ground_end=max(positions[c['ref']][0] for c in cap)
    line([gx,gy],[ground_end,gy])
    for c in cap:
        t=terminals(c);a,b=point(t[netof[v]]),point(t[netof[g]])
        line(a,[a[0],rail_y]);line(b,[b[0],gy])
    if connector:
        output_pin=ct[netof[o]]
        connector_x=pull_x+40.64
        positions[connector['ref']]=[connector_x-pinmap[output_pin]['pos'][0],oy-pinmap[output_pin]['pos'][1]]
        cp,cg,co=[point(ct[n]) for n in (supply,netof[g],netof[o])]
        # The receiver output and the connector input share a horizontal row.
        # Separate supply/return corridors stay clear of the connector labels.
        supply_x=connector_x-12.7;return_x=connector_x-17.78
        line([pull_x,oy],co)
        line([pull_x,rail_y],[supply_x,rail_y]);line([supply_x,rail_y],[supply_x,cp[1]]);line([supply_x,cp[1]],cp)
        line([ground_end,gy],[return_x,gy]);line([return_x,gy],[return_x,cg[1]]);line([return_x,cg[1]],cg)
    bounds=[]
    for r,(x,y) in positions.items():
        s=specs[r];bounds += [[x+s['_low'][0],y+s['_low'][1]],[x+s['_low'][0]+s['width'],y+s['_low'][1]+s['height']]]
    bounds += [p for segment in segments for p in segment]
    left=min(p[0] for p in bounds)-5.08;top=min(p[1] for p in bounds)-10.16
    right=max(p[0] for p in bounds)+5.08;bottom=max(p[1] for p in bounds)+5.08
    return {'id':group['id'],'width':right-left,'height':bottom-top,
            'children':[{'id':r,'x':x+specs[r]['_low'][0]-left,'y':y+specs[r]['_low'][1]-top} for r,(x,y) in positions.items()],
            'edges':[{'sections':[{'startPoint':{'x':a[0]-left,'y':a[1]-top},'endPoint':{'x':b[0]-left,'y':b[1]-top}}]} for a,b in segments]}
