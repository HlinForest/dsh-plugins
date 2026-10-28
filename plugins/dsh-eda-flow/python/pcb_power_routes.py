"""Reserve short supply/return paths before global routing, from declared owners.

No component IDs, source-board positions or extra connectivity are inferred here.
Every path uses existing same-net physical pads and actual native obstacles.
Protected DSN wires preserve these local paths during the global routing pass.
Native DRC and post-route connectivity are still required.
"""
import math,heapq,time
import pcbnew as pcb
from pcb_trace_simplification import polygon,union,contained,intersects,alternatives


def _xy(p):return (p.x,p.y)

def _tracks(board,path,net,layer,width):
    result=[]
    for a,b in zip(path,path[1:]):
        if a==b:continue
        t=pcb.PCB_TRACK(board);t.SetStart(pcb.VECTOR2I(*a));t.SetEnd(pcb.VECTOR2I(*b))
        t.SetLayer(layer);t.SetWidth(width);t.SetNet(net);t.SetLocked(True);result.append(t)
    return result


def _path(start,end,free,clear_segment,bounds,step,max_expansions=150000,seconds=8):
    """Bounded octilinear lattice A*, with native checks on every complete edge."""
    begin=time.monotonic();x0,y0,x1,y1=bounds
    width=(x1-x0)//step+1;height=(y1-y0)//step+1;point_cache={};edge_cache={}
    def xy(k):j,i=divmod(k,width);return (x0+i*step,y0+j*step)
    def available(k):
        if k not in point_cache:point_cache[k]=free(xy(k))
        return point_cache[k]
    def edge(a,b):
        key=(min(a,b),max(a,b))
        if key not in edge_cache:edge_cache[key]=clear_segment(xy(a),xy(b))
        return edge_cache[key]
    def seeds(pt):
        i,j=round((pt[0]-x0)/step),round((pt[1]-y0)/step);result={}
        for v in range(max(0,j-2),min(height,j+3)):
            for u in range(max(0,i-2),min(width,i+3)):
                k=v*width+u
                if available(k) and clear_segment(pt,xy(k)):result[k]=math.dist(pt,xy(k))
        return result
    # Try simple 45/90 degree paths first, avoiding extra grid corners.
    choices=[p for p in alternatives(start,end) if all(clear_segment(a,b) for a,b in zip(p,p[1:]))]
    if choices:return min(choices,key=lambda p:sum(math.dist(a,b) for a,b in zip(p,p[1:]))),'simple',0
    starts=seeds(start);ends=seeds(end)
    if not starts or not ends:return None,'terminal cannot reach routing lattice',0
    dist=dict(starts);parent={k:None for k in starts}
    queue=[(d+math.dist(xy(k),end),d,k) for k,d in starts.items()];heapq.heapify(queue)
    best=math.inf;finish=None;expanded=0
    while queue:
        f,d,k=heapq.heappop(queue)
        if f>=best:break
        if d>dist[k]+.001:continue
        expanded+=1
        if expanded>max_expansions or (expanded%256==0 and time.monotonic()-begin>seconds):break
        if k in ends and d+ends[k]<best:best=d+ends[k];finish=k
        j,i=divmod(k,width)
        for di,dj in [(-1,0),(1,0),(0,-1),(0,1),(-1,-1),(-1,1),(1,-1),(1,1)]:
            ni,nj=i+di,j+dj
            if not(0<=ni<width and 0<=nj<height):continue
            nk=nj*width+ni;nd=d+step*math.hypot(di,dj)
            if nd>=dist.get(nk,math.inf) or not available(nk) or not edge(k,nk):continue
            dist[nk]=nd;parent[nk]=k;heapq.heappush(queue,(nd+math.dist(xy(nk),end),nd,nk))
    if finish is None:return None,'no path within bounded search',expanded
    path=[end];k=finish
    while k is not None:path.append(xy(k));k=parent[k]
    path.append(start);path.reverse()
    # Replace grid staircases with collision-checked octilinear alternatives.
    result=[path[0]];i=0
    while i<len(path)-1:
        selected=None
        for j in range(len(path)-1,i,-1):
            options=alternatives(path[i],path[j])
            for option in sorted(options,key=lambda p:sum(math.dist(a,b) for a,b in zip(p,p[1:]))):
                if all(clear_segment(a,b) for a,b in zip(option,option[1:])):selected=(j,option);break
            if selected:break
        if not selected:return None,'path simplification failed',expanded
        i,option=selected;result.extend(option[1:])
    return result,'lattice',expanded


def reserve_power_routes(board,process,plan,lock=True):
    relations=process.get('relations',[]);active=plan.get('activeLayers',['F.Cu','B.Cu'])
    report={'routes':[],'lockedDuringGlobalRouting':lock,'geometrySource':'current generated native PCB only','nativeDrcRequired':True,
            'scope':'existing owner supply and return pairs; protects geometric paths, not loop inductance or transient performance'}
    if not relations:return {**report,'reason':'no declared power relations'}
    if len(active)!=1:return {**report,'reason':'priority routing currently requires one explicit copper layer'}
    layer=pcb.B_Cu if active[0]=='B.Cu' else pcb.F_Cu
    width=pcb.FromMM(plan['trackWidthMm']);clearance=pcb.FromMM(plan['clearanceMm']);safety=pcb.FromMM(.003)
    outline=pcb.SHAPE_POLY_SET()
    if not board.GetBoardPolygonOutlines(outline,False):return {**report,'reason':'no reliable board outline'}
    center_area=pcb.SHAPE_POLY_SET(outline)
    center_area.Inflate(-(width//2+pcb.FromMM(.5)+safety),pcb.CORNER_STRATEGY_ROUND_ALL_CORNERS,pcb.FromMM(.001))
    box=center_area.BBox();bounds=(box.GetX(),box.GetY(),box.GetRight(),box.GetBottom())
    pads={}
    for f in board.GetFootprints():
        for p in f.Pads():pads.setdefault((f.GetReference(),p.GetNumber()),[]).append(p)
    keepalive=[outline,center_area];work=[]
    for relation in sorted(relations,key=lambda r:(r['kind']!='decoupling',r['ref'])):
        for role,key in [('return','returnPad'),('anchor','supplyPad')]:
            if role not in process.get('routeRoles',['return','anchor']):continue
            endpoint=relation[role];aa=pads.get((relation['ref'],relation[key]),[]);bb=pads.get((endpoint['ref'],endpoint['pad']),[])
            # A repair may target a particular physical pad of a multi-pad pin.
            # Keep the usual nearest-pair choice when no physical UUID is given.
            if role=='anchor' and relation.get('_sourcePhysicalUuid'):
                aa=[q for q in aa if q.m_Uuid.AsString()==relation['_sourcePhysicalUuid']]
            if endpoint.get('_physicalUuid'):
                bb=[q for q in bb if q.m_Uuid.AsString()==endpoint['_physicalUuid']]
            pairs=[(a,b) for a in aa for b in bb if a.IsOnLayer(layer) and b.IsOnLayer(layer)]
            if not pairs:raise ValueError('Power route endpoints missing on requested layer: '+relation['ref'])
            if any(a.GetNetCode()<=0 or a.GetNetCode()!=b.GetNetCode() for a,b in pairs):raise ValueError('Power route endpoint nets differ: '+relation['ref'])
            a,b=min(pairs,key=lambda ab:math.dist(_xy(ab[0].GetPosition()),_xy(ab[1].GetPosition())))
            work.append((relation,role,a,b))
    for relation,role,a,b in work:
        start,end=_xy(a.GetPosition()),_xy(b.GetPosition());net=a.GetNetCode()
        entry={'ref':relation['ref'],'kind':relation['kind'],'role':role,'net':a.GetNetname(),'from':relation['ref']+'.'+a.GetNumber(),
               'to':relation[role]['ref']+'.'+b.GetNumber(),'straightDistanceMm':pcb.ToMM(round(math.dist(start,end))), 'adopted':False}
        items=[p for f in board.GetFootprints() for p in f.Pads() if p.IsOnLayer(layer) and p.GetNetCode()!=net]
        items += [t for t in board.GetTracks() if t.IsOnLayer(layer) and t.GetNetCode()!=net]
        items += [g for f in board.GetFootprints() for g in f.GraphicalItems() if g.IsOnCopperLayer() and g.GetLayer()==layer]
        items += [g for g in board.GetDrawings() if g.IsOnCopperLayer() and g.GetLayer()==layer]
        obstacles=union(polygon(item,layer,clearance+width//2+safety) for item in items)
        for z in board.Zones():
            if z.GetIsRuleArea() and z.GetLayerSet().Contains(layer) and z.GetDoNotAllowTracks():
                zpoly=pcb.SHAPE_POLY_SET(z.Outline());zpoly.Inflate(width//2+safety,pcb.CORNER_STRATEGY_ROUND_ALL_CORNERS,pcb.FromMM(.001));obstacles.BooleanAdd(zpoly);keepalive.append(zpoly)
        keepalive.append(obstacles)
        def free(pt):return center_area.Contains(pcb.VECTOR2I(*pt)) and not obstacles.Contains(pcb.VECTOR2I(*pt))
        def clear_segment(x,y):
            if x==y:return free(x)
            return free(x) and free(y) and not obstacles.Collide(pcb.SEG(pcb.VECTOR2I(*x),pcb.VECTOR2I(*y))) and all(center_area.Contains(pcb.VECTOR2I(round(x[0]+(y[0]-x[0])*v/8),round(x[1]+(y[1]-x[1])*v/8))) for v in range(1,8))
        # Grow an existing connected same-net tree instead of enclosing signals
        # with a second independent return loop around the same owner.
        board.BuildConnectivity();connectivity=board.GetConnectivity();pending=[b];reached={}
        while pending:
            item=pending.pop();uid=item.m_Uuid.AsString()
            if uid in reached:continue
            reached[uid]=item
            pending.extend(t for t in list(connectivity.GetConnectedTracks(item))+list(connectivity.GetConnectedPads(item)) if t.GetNetCode()==net)
        targets={end}
        for item in reached.values():
            if isinstance(item,pcb.PCB_TRACK) and not isinstance(item,(pcb.PCB_VIA,pcb.PCB_ARC)) and item.GetLayer()==layer:
                x,y=_xy(item.GetStart()),_xy(item.GetEnd());targets.update([x,y])
                vx,vy=y[0]-x[0],y[1]-x[1];den=vx*vx+vy*vy
                if den:
                    fraction=max(0,min(1,((start[0]-x[0])*vx+(start[1]-x[1])*vy)/den))
                    targets.add((round(x[0]+fraction*vx),round(x[1]+fraction*vy)))
        path=None;method='no routing target';expanded=0
        if a.m_Uuid.AsString() in reached and process.get('joinExistingTree',True):
            entry.update({'adopted':True,'sharedExistingTree':True,'newLengthMm':0,'segments':0,'pathMm':[]})
            report['routes'].append(entry);continue
        if not process.get('joinExistingTree',True):targets={end}
        target_choices=sorted(targets,key=lambda t:(math.dist(start,t),t))[:6]
        best_length=math.inf;attempts=0
        for target in target_choices:
            # Target proximity is only a lower bound; obstacles can make the
            # nearest reachable junction much longer than another tree entry.
            if math.dist(start,target)>=best_length:break
            attempt,search,count=_path(start,target,free,clear_segment,bounds,pcb.FromMM(.25))
            expanded+=count;attempts+=1
            if path is None:method=search
            if attempt is not None:
                distance=sum(math.dist(x,y) for x,y in zip(attempt,attempt[1:]))
                if distance<best_length:
                    path=attempt;best_length=distance;method=search;entry['joinsExistingTree']=target!=end
        entry['treeTargetsEvaluated']=attempts
        entry.update({'search':method,'expanded':expanded})
        if path:
            tracks=_tracks(board,path,a.GetNet(),layer,width)
            actual=union(polygon(t,layer) for t in tracks)
            edge=union(polygon(t,layer,pcb.FromMM(.5)+safety) for t in tracks)
            foreign=union(polygon(item,layer,clearance+safety) for item in items)
            keepalive.extend([actual,edge,foreign])
            if contained(edge,outline) and not intersects(actual,foreign):
                for t in tracks:t.SetLocked(lock);board.Add(t)
                entry.update({'adopted':True,'newLengthMm':round(sum(pcb.ToMM(t.GetLength()) for t in tracks),6),'segments':len(tracks),
                              'pathMm':[[pcb.ToMM(v) for v in p] for p in path]})
            else:entry['reason']='full native track/edge validation rejected path'
        report['routes'].append(entry)
    board._eda_power_routes_keepalive=keepalive
    if any(r['adopted'] for r in report['routes']):board.BuildConnectivity()
    return report
