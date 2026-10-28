"""Measured drawing complexity; no reference circuit or target coordinates."""
from collections import defaultdict
import math

GRID=1.27

def wire_metrics(segments, junctions=()):
    point=lambda p:tuple(round(float(v),4) for v in p)
    segments=sorted({tuple(sorted((point(a),point(b)))) for a,b in segments if point(a)!=point(b)})
    joins={point(p) for p in junctions};crossings=set();neighbors=defaultdict(set)
    for a,b in segments:neighbors[a].add(b);neighbors[b].add(a)
    for index,(a,b) in enumerate(segments):
        for c,d in segments[index+1:]:
            h,v=((a,b),(c,d)) if a[1]==b[1] and c[0]==d[0] else (((c,d),(a,b)) if c[1]==d[1] and a[0]==b[0] else (None,None))
            if h is None:continue
            p=(v[0][0],h[0][1])
            if min(h[0][0],h[1][0])<p[0]<max(h[0][0],h[1][0]) and min(v[0][1],v[1][1])<p[1]<max(v[0][1],v[1][1]) and p not in joins:
                crossings.add(p)
    bends=0
    for p,adjacent in neighbors.items():
        if len(adjacent)!=2 or p in joins:continue
        a,b=adjacent
        if (a[0]-p[0])*(b[1]-p[1])!=(a[1]-p[1])*(b[0]-p[0]):bends+=1
    lengths=[math.dist(a,b) for a,b in segments]
    return {'segments':len(segments),'wireMm':round(sum(lengths),4),'maxSegmentMm':round(max(lengths,default=0),4),'bends':bends,'crossings':len(crossings)}

def routed_metrics(result):
    segments=[]
    for edge in result['edges']:
        for section in edge.get('sections',[]):
            points=[section['startPoint'],*section.get('bendPoints',[]),section['endPoint']]
            points=[(p['x'],p['y']) for p in points]
            segments.extend(zip(points,points[1:]))
    return wire_metrics(segments)

def complexity(metrics,width,height,include_label_span=True):
    # Costs are in drawing millimetres: a bend costs four connection grids,
    # an unmarked crossing eight. Expose every metric alongside this finite
    # heuristic; neither this score nor ERC establishes engineering quality.
    return round(metrics['wireMm']+(metrics.get('labelSpanMm',0) if include_label_span else 0)+4*GRID*metrics['bends']+8*GRID*metrics['crossings']
                 +.5*metrics['maxSegmentMm']+width+height,4)


def unwired_metrics(state,design):
    """Estimate reading distance hidden behind same-name label islands.

    Raw wire length alone rewards replacing useful local wires with labels.
    Use a Manhattan spanning-tree lower bound between disconnected physical
    pin sets. This is a presentation estimate, never an electrical open-net
    finding: the actual native netlist verifies label connectivity separately.
    """
    import functional_layout as geom
    physical,_=geom.physical_graph(state)
    pins={c['reference']+'.'+p['number']:geom.world(c,p['at'])
          for c in state['items'].values() if c['kind']=='component'
          for p in state['symbols'][c['symbol']]['pins']}
    total=0;net_count=0;links=0
    for net in design['nets']:
        islands=defaultdict(list)
        for key in net['nodes']:
            if key not in pins:raise ValueError('Missing native terminal for label-span metric: '+key)
            islands[physical.get(key,key)].append(pins[key])
        groups=sorted((sorted(v) for v in islands.values()))
        if len(groups)<2:continue
        net_count+=1;connected={0};remaining=set(range(1,len(groups)))
        def distance(a,b):return min(sum(abs(x-y) for x,y in zip(p,q)) for p in groups[a] for q in groups[b])
        while remaining:
            cost,a,b=min((distance(a,b),a,b) for a in connected for b in remaining)
            total+=cost;links+=1;connected.add(b);remaining.remove(b)
    return {'labelSpanMm':round(total,4),'labelSeparatedNets':net_count,'labelIslandLinks':links}
