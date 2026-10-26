"""Measured local geometry for a recognized module/interface circuit.

The pattern supplies roles, never coordinates. Pin rows, painted fields and
clearance determine all positions. Actual routing still uses the common
obstacle-aware net router and the complete native export gates.
"""
import math
from interface_clusters import recognize
from topology_layout import _point,_bounds
from functional_layout import Router,GRID
from layout_quality import routed_metrics,complexity


def _ceil(x):return round(math.ceil(x/GRID-1e-8)*GRID,4)
def _floor(x):return round(math.floor(x/GRID+1e-8)*GRID,4)

def _escape_x(spec,direction):
    body=spec['_body_bounds'];fields=[f['box'] for f in spec.get('_field_reservations',[])]
    return (_floor(min([body[0]-GRID,*[b[0]-.4 for b in fields]]))-GRID if direction<0 else
            _ceil(max([body[2]+GRID,*[b[2]+.4 for b in fields]]))+GRID)


def _candidate(group,pattern,design,specs,pinmap,gap,extra,feed_alignment='outer-column'):
    refs=pattern['references'];hub=pattern['hub'];port=pattern['interface']
    paths=pattern['paths'];roles=pattern['roles'];pull=pattern['pull']
    netof={k:n['name'] for n in design['nets'] for k in n['nodes']}
    if any(pinmap[k]['direction']!=[1,0] for k in roles.values()):return None
    if any(pinmap[k]['direction']!=[-1,0] for k in pinmap if k.rsplit('.',1)[0]==port):return None
    desired={}
    for p in paths.values():
        if p['series']:desired[p['near']]=[-1,0];desired[p['far']]=[1,0]
    for c in pattern['caps']:desired[c['supply']]=[0,-1];desired[c['return']]=[0,1]
    if pull:desired[pull['rail']]=[0,-1];desired[pull['signal']]=[0,1]
    if any(pinmap[k]['direction']!=v for k,v in desired.items()):return None
    positions={hub:[0,0]};spacing=max(2*GRID,gap+extra*GRID)
    def pos(key):return _point(positions,pinmap,key)
    def put(ref,key,x,y):positions[ref]=[round(x-pinmap[key]['pos'][0],4),round(y-pinmap[key]['pos'][1],4)]
    def low(ref,axis):return specs[ref]['_content_low'][axis]
    def high(ref,axis):return specs[ref]['_content_high'][axis]
    def right(ref):return positions[ref][0]+high(ref,0)
    def left_at(ref,x):return _ceil(x-low(ref,0))
    output_y=pos(roles['signal'])[1];ground_y=pos(roles['return'])[1]
    # Keep all parallel bodies above the signal corridor. Capacitor return
    # leads may cross that signal only at unconnected interior crossings.
    cursor=max(pos(k)[0] for k in roles.values())+spacing
    caps=sorted(pattern['caps'],key=lambda c:(specs[c['ref']]['width'],specs[c['ref']]['height'],c['ref']))
    for c in caps:
        ref=c['ref'];positions[ref]=[left_at(ref,cursor),_floor(output_y-spacing-high(ref,1))]
        cursor=right(ref)+spacing
    if pull:
        ref=pull['ref']
        body=specs[ref]['_body_bounds']
        escape=_ceil(body[3]+GRID)+GRID-pinmap[pull['signal']]['pos'][1]
        put(ref,pull['signal'],left_at(ref,cursor)+pinmap[pull['signal']]['pos'][0],output_y-escape)
        feed=paths['supply']
        if feed_alignment=='rail-columns' and feed['series'] and netof[pull['rail']]==netof[feed['far']]:
            # Two distinct supply rails need two clear vertical corridors.
            # Their separation is the feed's painted width, not a board grid.
            s=specs[feed['series']]
            target=max(pos(c['supply'])[0] for c in caps)+_escape_x(s,1)-_escape_x(s,-1)
            positions[ref][0]+=max(0,round(target-pos(pull['rail'])[0],4))
        cursor=right(ref)+spacing
    # Series output and return parts have independent rows. Their alignment
    # follows the receiver and connector ports, not an arbitrary column grid.
    signal=paths['signal']
    if signal['series']:
        r=signal['series'];put(r,signal['near'],left_at(r,cursor)+pinmap[signal['near']]['pos'][0],output_y)
    supply=paths['supply']
    if supply['series']:
        r=supply['series']
        rail_y=min(pos(c['supply'])[1] for c in caps)
        if pull:rail_y=min(rail_y,pos(pull['rail'])[1])
        positions[r]=[left_at(r,cursor),_floor(rail_y-spacing-high(r,1))]
        if feed_alignment in ('bias-port','rail-columns','cap-port') and pull:
            # The bias may use either side of the filter. Align that actual
            # rail's outward routing port with the bias column, so the feed
            # body cannot force the wire over and back around itself. The
            # other candidate remains available when geometry makes this
            # alignment unattractive. All distances come from symbol bounds.
            key=next((k for k in (supply['near'],supply['far']) if netof[k]==netof[pull['rail']]),None)
            if key is None:return None
            body=specs[r]['_body_bounds'];direction=pinmap[key]['direction'][0]
            # Include the outward lead and painted field clearance. Aligning
            # only the body edge leaves the value text across the vertical
            # path and the common router must insert a small dogleg.
            port_x=_escape_x(specs[r],direction)
            positions[r][0]=round(pos(pull['rail'])[0]-port_x,4)
            if feed_alignment=='cap-port' and netof[pull['rail']]==netof[supply['far']]:
                # The receiver-side bypass can share the other free corridor.
                # Move it only where its measured body/text envelope remains
                # clear of every placed part, rather than adding a dogleg.
                cap=caps[-1];target=positions[r][0]+_escape_x(specs[r],-1)
                positions[cap['ref']][0]+=round(target-pos(cap['supply'])[0],4)
                def painted(ref):
                    x,y=positions[ref]
                    return [[x+b[0]-.4,y+b[1]-.4,x+b[2]+.4,y+b[3]+.4]
                            for b in [specs[ref]['_body_bounds'],*[f['box'] for f in specs[ref].get('_field_reservations',[])]]]
                cr=cap['ref']
                for other in positions:
                    if other==cr:continue
                    if any(min(a[2],b[2])-max(a[0],b[0])>0 and min(a[3],b[3])-max(a[1],b[1])>0 for a in painted(cr) for b in painted(other)):return None
    ret=paths['return']
    if ret['series']:
        r=ret['series'];near_x=left_at(r,cursor)+pinmap[ret['near']]['pos'][0]
        bottom=max((positions[x][1]+high(x,1) for x in positions if x!=hub),default=ground_y)
        put(r,ret['near'],near_x,_ceil(max(ground_y,bottom+spacing-low(r,1)+pinmap[ret['near']]['pos'][1])))
    edge=max(right(r) for r in positions if r!=hub)
    connector_x=_ceil(edge+spacing-specs[port]['_low'][0])
    positions[port]=[connector_x,round(output_y-pinmap[signal['end']]['pos'][1],4)]
    if set(positions)!=set(refs):return None
    # Body and text are separate obstacles. Their union's bounding rectangle
    # would treat the empty area above a long part value as a solid wall and
    # create a gratuitous offset in an otherwise straight local signal.
    obstacles=[];route_map={k:dict(v) for k,v in pinmap.items()}
    for r in refs:
        body=specs[r]['_body_bounds']
        local=[body[0]-GRID,body[1]-GRID,body[2]+GRID,body[3]+GRID]
        if r==port:local=[specs[r]['_low'][0],specs[r]['_low'][1],specs[r]['_low'][0]+specs[r]['width'],specs[r]['_low'][1]+specs[r]['height']]
        obstacles.append([positions[r][0]+local[0],positions[r][1]+local[1],positions[r][0]+local[2],positions[r][1]+local[3]])
        for field in specs[r].get('_field_reservations',[]):
            a,b,c,d=field['box'];obstacles.append([positions[r][0]+a-.4,positions[r][1]+b-.4,positions[r][0]+c+.4,positions[r][1]+d+.4])
        for k in route_map:
            if k.rsplit('.',1)[0]!=r:continue
            x,y=pinmap[k]['pos'];dx,dy=pinmap[k]['direction']
            route_map[k]['port']=[_floor(local[0]) if dx<0 else _ceil(local[2]) if dx>0 else x,
                                  _floor(local[1]) if dy<0 else _ceil(local[3]) if dy>0 else y]
    pairs=[]
    for n in design['nets']:
        members=sorted(k for k in n['nodes'] if k.rsplit('.',1)[0] in refs)
        if len(members)<2:continue
        # A minimum-length tree of current terminal positions is independent
        # of serialized net order and does not invent new circuit nodes.
        connected={members[0]};remaining=set(members[1:])
        while remaining:
            a,b=min(((a,b) for a in connected for b in remaining),key=lambda pair:(sum(abs(x-y) for x,y in zip(pos(pair[0]),pos(pair[1]))),pair))
            pairs.append((a,b));connected.add(b);remaining.remove(b)
    if not pairs:return None
    leads=[]
    for k in sorted({k for pair in pairs for k in pair}):
        leads.append((netof[k],pos(k),_point(positions,route_map,k,port=True)))
    # External-only terminals still receive named stubs in native export.
    # Reserve their corridors too: a branch must not end on those foreign
    # stubs merely because they have no second terminal inside this group.
    paired={k for pair in pairs for k in pair}
    reservations=leads+[(netof[k],pos(k),_point(positions,route_map,k,port=True))
                        for k in sorted(route_map) if k not in paired and k in netof and k.rsplit('.',1)[0] in refs]
    bounds=_bounds(positions,refs,specs,pairs,route_map)
    router=Router([bounds[0]-8*GRID,bounds[1]-8*GRID,bounds[2]+8*GRID,bounds[3]+8*GRID],obstacles,reservations)
    routes=[{'net':n,'points':[a,b]} for n,a,b in leads if a!=b]
    # Signal first establishes the straight reference row; power and return
    # routes then choose legal crossings without an accidental T contact.
    pairs.sort(key=lambda p:(netof[p[0]]!=netof[roles['signal']],sum(abs(x-y) for x,y in zip(pos(p[0]),pos(p[1]))),p))
    try:
        for a,b in pairs:
            route=router.connect(netof[a],_point(positions,route_map,a,port=True),_point(positions,route_map,b,port=True),join_target_tree=True)
            routes.append({'net':netof[a],'points':route})
    except (KeyError,ValueError,IndexError):return None
    points=[p for route in routes for p in route['points']]
    left=min(bounds[0],*(p[0] for p in points))-2*GRID;top=min(bounds[1],*(p[1] for p in points))-2*GRID
    right_edge=max(bounds[2],*(p[0] for p in points))+2*GRID;bottom=max(bounds[3],*(p[1] for p in points))+2*GRID
    edges=[]
    for route in routes:
        pts=[{'x':round(p[0]-left,4),'y':round(p[1]-top,4)} for p in route['points']]
        if len(pts)>1:edges.append({'net':route['net'],'sections':[{'startPoint':pts[0],'bendPoints':pts[1:-1],'endPoint':pts[-1]}]})
    return {'id':group['id'],'width':right_edge-left,'height':bottom-top,
            'children':[{'id':r,'x':positions[r][0]+specs[r]['_low'][0]-left,'y':positions[r][1]+specs[r]['_low'][1]-top} for r in refs],
            'edges':edges,'interfaceCluster':{'hub':hub,'interface':port,'spacingExtraGrid':extra,'feedAlignment':feed_alignment}}


def place(group,design,resources,specs,pinmap,gap):
    pattern=recognize(group['references'],design,resources)
    if not pattern:return None
    results=[];records=[]
    alignments=('outer-column','bias-port','rail-columns','cap-port') if pattern['pull'] and pattern['paths']['supply']['series'] else ('outer-column',)
    # Include one tighter legal corridor alongside the nominal and expanded
    # gaps; native export still rejects painted overlaps and contact errors.
    for extra in (-1,0,2,4):
        for alignment in alignments:
            result=_candidate(group,pattern,design,specs,pinmap,gap,extra,alignment)
            record={'spacingExtraGrid':extra,'feedAlignment':alignment}
            if result is not None:
                metrics=routed_metrics(result)
                score=complexity(metrics,result['width'],result['height'])
                records.append({**record,'status':'routed','metrics':metrics,'score':score})
                results.append((score,extra,alignment,result))
            else:records.append({**record,'status':'unsupported-geometry-or-unroutable'})
    if not results:return None
    _,extra,alignment,selected=min(results,key=lambda x:x[:3])
    selected['placementSearch']={'method':'measured-interface-circuit','selectedSpacingExtraGrid':extra,'selectedFeedAlignment':alignment,'candidates':records}
    return selected
