"""Conservative octilinear shortcuts of generated native copper.

Preserve chain endpoints, every existing same-net copper contact, layer, width,
and locked items. Native DRC after refilling is mandatory: zones, custom rules
and electrical performance cannot be approved by this geometric precheck.
"""
import math
from collections import defaultdict
import pcbnew as pcb


def xy(point):
    return (point.x, point.y)


def length(points):
    return sum(math.dist(a,b) for a,b in zip(points,points[1:]))


def alternatives(a,b):
    dx,dy=b[0]-a[0],b[1]-a[1]
    if dx==0 or dy==0 or abs(dx)==abs(dy):
        return [[a,b]] if a!=b else []
    sx=1 if dx>0 else -1;sy=1 if dy>0 else -1;m=min(abs(dx),abs(dy))
    return [[a,(a[0]+sx*m,a[1]+sy*m),b],
            [a,(b[0]-sx*m,b[1]-sy*m),b],
            [a,(a[0],b[1]),b],[a,(b[0],a[1]),b]]


def polygon(item,layer,clearance=0,inside=False):
    result=pcb.SHAPE_POLY_SET()
    item.TransformShapeToPolygon(result,layer,clearance,pcb.FromMM(.001),
                                 pcb.ERROR_INSIDE if inside else pcb.ERROR_OUTSIDE)
    return result


def union(polys):
    result=pcb.SHAPE_POLY_SET()
    for poly in polys:result.BooleanAdd(poly)
    return result


def intersects(a,b):
    result=pcb.SHAPE_POLY_SET(a);result.BooleanIntersection(b)
    return result.OutlineCount()>0


def contained(a,b):
    result=pcb.SHAPE_POLY_SET(a);result.BooleanSubtract(b)
    return result.OutlineCount()==0


def shorten_tracks(board,clearance_mm,edge_clearance_mm,min_segment_mm=.5,max_chain_edges=5):
    if any(not math.isfinite(v) or v<0 for v in (clearance_mm,edge_clearance_mm,min_segment_mm)):
        raise ValueError('Invalid trace simplification limits')
    board_outline=pcb.SHAPE_POLY_SET()
    if not board.GetBoardPolygonOutlines(board_outline,False):
        return {'changes':[],'reason':'No reliable board outline','nativeDrcRequired':True}
    tracks={t.m_Uuid.AsString():t for t in board.GetTracks()
            if not isinstance(t,(pcb.PCB_VIA,pcb.PCB_ARC)) and t.GetNetCode()>0}
    edges=defaultdict(list)
    for uid,t in tracks.items():
        for point in [t.GetStart(),t.GetEnd()]:
            edges[(t.GetNetCode(),t.GetLayer(),xy(point))].append(uid)
    def opposite(uid,point):
        t=tracks[uid]
        return xy(t.GetEnd()) if xy(t.GetStart())==point else xy(t.GetStart())
    candidates=[];seen=set();threshold=pcb.FromMM(min_segment_mm)
    for uid,t in tracks.items():
        if t.IsLocked():continue
        for start in [xy(t.GetStart()),xy(t.GetEnd())]:
            chain=[uid];points=[start,opposite(uid,start)]
            for _ in range(2,max_chain_edges+1):
                incident=edges[(t.GetNetCode(),t.GetLayer(),points[-1])]
                if len(incident)!=2:break
                nxt=next(q for q in incident if q!=chain[-1]);next_track=tracks[nxt]
                if nxt in chain or next_track.IsLocked() or next_track.GetWidth()!=t.GetWidth():break
                chain.append(nxt);points.append(opposite(nxt,points[-1]))
                signature=tuple(sorted(chain))
                if signature in seen:continue
                seen.add(signature);old_length=length(points)
                old_short=sum(math.dist(a,b)<threshold for a,b in zip(points,points[1:]))
                for path in alternatives(points[0],points[-1]):
                    saving=old_length-length(path)
                    new_short=sum(math.dist(a,b)<threshold for a,b in zip(path,path[1:]))
                    if saving>pcb.FromMM(.01) and new_short<=old_short:
                        candidates.append({'ids':list(chain),'path':path,'saving':saving,
                                           'net':t.GetNetCode(),'name':t.GetNetname(),
                                           'layer':t.GetLayer(),'width':t.GetWidth()})
    candidates.sort(key=lambda c:(-c['saving'],c['name'],c['layer'],c['path']))
    # Zones are refilled after the proposal. Their connectivity is checked by
    # native DRC, never inferred from their outlines.
    layers={t.GetLayer() for t in tracks.values()};objects=defaultdict(list);keepalive=[]
    for layer in layers:
        items=[t for t in board.GetTracks() if t.IsOnLayer(layer)]
        items += [pad for fp in board.GetFootprints() for pad in fp.Pads() if pad.IsOnLayer(layer)]
        items += [g for fp in board.GetFootprints() for g in fp.GraphicalItems() if g.IsOnCopperLayer() and g.GetLayer()==layer]
        items += [g for g in board.GetDrawings() if g.IsOnCopperLayer() and g.GetLayer()==layer]
        for item in items:
            poly=polygon(item,layer);keepalive.append(poly)
            objects[layer].append({'id':item.m_Uuid.AsString(),'net':item.GetNetCode() if hasattr(item,'GetNetCode') else 0,'poly':poly})
        for zone in board.Zones():
            if zone.GetIsRuleArea() and zone.GetLayerSet().Contains(layer) and zone.GetDoNotAllowTracks():
                poly=pcb.SHAPE_POLY_SET(zone.Outline());keepalive.append(poly)
                objects[layer].append({'id':zone.m_Uuid.AsString(),'net':-1,'poly':poly})
    used=set();changes=[];cache={};safety=pcb.FromMM(.003)
    for candidate in candidates:
        ids=candidate['ids'];layer=candidate['layer'];net=candidate['net']
        if used.intersection(ids):continue
        new=[]
        for a,b in zip(candidate['path'],candidate['path'][1:]):
            track=pcb.PCB_TRACK(board);track.SetStart(pcb.VECTOR2I(*a));track.SetEnd(pcb.VECTOR2I(*b))
            track.SetWidth(candidate['width']);track.SetLayer(layer);track.SetNet(tracks[ids[0]].GetNet());new.append(track)
        expanded=union(polygon(t,layer,pcb.FromMM(clearance_mm)+safety) for t in new)
        edge_shape=union(polygon(t,layer,pcb.FromMM(edge_clearance_mm)+safety) for t in new)
        if not contained(edge_shape,board_outline):continue
        foreign_key=(layer,net)
        if foreign_key not in cache:
            cache[foreign_key]=union(o['poly'] for o in objects[layer] if o['net']!=net)
        if intersects(expanded,cache[foreign_key]):continue
        old=union(o['poly'] for o in objects[layer] if o['id'] in ids)
        new_poly=union(polygon(t,layer,inside=True) for t in new)
        contacts=[o for o in objects[layer] if o['net']==net and o['id'] not in ids and intersects(o['poly'],old)]
        if any(not intersects(o['poly'],new_poly) for o in contacts):continue
        for uid in ids:board.Remove(tracks[uid]);keepalive.append(tracks[uid])
        for track in new:board.Add(track)
        objects[layer]=[o for o in objects[layer] if o['id'] not in ids]
        for track in new:
            poly=polygon(track,layer);keepalive.append(poly)
            objects[layer].append({'id':track.m_Uuid.AsString(),'net':net,'poly':poly})
        used.update(ids);cache.clear()
        changes.append({'net':candidate['name'],'layer':pcb.LayerName(layer),
                        'removedSegments':len(ids),'newSegments':len(new),
                        'removedIds':ids,'preservedContacts':len(contacts),
                        'widthMm':pcb.ToMM(candidate['width']),
                        'savedLengthMm':round(candidate['saving']/1e6,6),
                        'pointsMm':[[pcb.ToMM(v) for v in p] for p in candidate['path']]})
    board._eda_shortcut_keepalive=keepalive
    if changes:
        board.BuildConnectivity();pcb.ZONE_FILLER(board).Fill(board.Zones())
    return {'method':'Endpoint-preserving octilinear shortcuts; actual foreign copper clearance and same-net object contacts',
            'candidates':len(candidates),'changes':changes,
            'savedLengthMm':round(sum(c['savedLengthMm'] for c in changes),6),
            'nativeDrcRequired':True,'geometrySource':'current generated native PCB only'}
