"""Remove redundant tracks only when their complete copper is retained by fill.

Filled polygons, not zone outlines or net names, are the evidence.  Refill after
removal and restore any track whose copper would disappear.  Keep locked tracks.
The caller must still run native DRC/parity on the resulting board.
"""
import pcbnew as pcb
from collections import defaultdict
from itertools import combinations

def route_metrics(board):
    tracks=[t for t in board.GetTracks() if not isinstance(t,pcb.PCB_VIA)]
    joins=defaultdict(list)
    for t in tracks:
        a,b=t.GetStart(),t.GetEnd()
        joins[(t.GetNetCode(),t.GetLayer(),a.x,a.y)].append((b.x-a.x,b.y-a.y))
        joins[(t.GetNetCode(),t.GetLayer(),b.x,b.y)].append((a.x-b.x,a.y-b.y))
    return {'trackLengthMm':round(sum(pcb.ToMM(t.GetLength()) for t in tracks),6),'segments':len(tracks),
            'shortSegmentsUnder05mm':sum(pcb.ToMM(t.GetLength())<.5 for t in tracks),
            'degree2Bends':sum(len(v)==2 and abs(v[0][0]*v[1][1]-v[0][1]*v[1][0])>1 for v in joins.values()),
            'metric':'explicit copper tracks; excludes area fill and component-internal bridges; not signal or return path performance'}

def filled_copper(board,keys):
    result={key:pcb.SHAPE_POLY_SET() for key in keys}
    for zone in board.Zones():
        if zone.GetIsRuleArea() or not zone.GetNetCode():continue
        for key,poly in result.items():
            net,layer=key
            if net==zone.GetNetCode() and zone.GetLayerSet().Contains(layer):poly.BooleanAdd(zone.GetFilledPolysList(layer))
    return result

def trace_polygon(track):
    poly=pcb.SHAPE_POLY_SET()
    track.TransformShapeToPolygon(poly,track.GetLayer(),0,pcb.FromMM(.001),pcb.ERROR_OUTSIDE)
    return poly

def covered(poly,fill):
    remainder=pcb.SHAPE_POLY_SET(poly);remainder.BooleanSubtract(fill)
    return remainder.OutlineCount()==0

def remove_filled_tracks(board):
    tracks=[t for t in board.GetTracks() if not isinstance(t,pcb.PCB_VIA) and not t.IsLocked() and t.GetNetCode()]
    keepalive=[];board._eda_filled_copper_keepalive=keepalive
    keepalive.append(tracks)
    keys={(t.GetNetCode(),t.GetLayer()) for t in tracks};fill=filled_copper(board,keys);keepalive.append(fill)
    candidates=[]
    for track in tracks:
        key=(track.GetNetCode(),track.GetLayer());poly=trace_polygon(track);keepalive.append(poly)
        if covered(poly,fill[key]):candidates.append((track,key,poly))
    for track,_,_ in candidates:board.Remove(track)
    retained=[]
    while candidates:
        board.BuildConnectivity();pcb.ZONE_FILLER(board).Fill(board.Zones())
        fill=filled_copper(board,keys);keepalive.append(fill)
        restore=[row for row in candidates if not covered(row[2],fill[row[1]])]
        if not restore:break
        for row in restore:board.Add(row[0]);candidates.remove(row);retained.append(row)
    if retained and not candidates:
        board.BuildConnectivity();pcb.ZONE_FILLER(board).Fill(board.Zones())
    keepalive.extend([candidates,retained])
    return {'method':'whole trace copper contained in same-net same-layer filled polygons, revalidated after refill',
            'removedSegments':len(candidates),'removedLengthMm':round(sum(pcb.ToMM(t.GetLength()) for t,_,_ in candidates),6),
            'restoredSegments':len(retained),'removed':[{'net':t.GetNetname(),'layer':pcb.LayerName(t.GetLayer()),'lengthMm':round(pcb.ToMM(t.GetLength()),6)} for t,_,_ in candidates],
            'copperCoveragePreserved':True,'nativeDrcRequired':True}


def remove_pad_tracks(board):
    """Remove tracks whose full copper is already provided by immutable pads.

    Use inward-approximated pad polygons and outward-approximated tracks, on the
    same net and layer. No copper is added or lost, so no fill rebuild is needed.
    Locked tracks and vias are never candidates; native DRC remains mandatory.
    """
    tracks=[t for t in board.GetTracks() if not isinstance(t,pcb.PCB_VIA) and not t.IsLocked() and t.GetNetCode()]
    pads={key:pcb.SHAPE_POLY_SET() for key in {(t.GetNetCode(),t.GetLayer()) for t in tracks}}
    for footprint in board.GetFootprints():
        for pad in footprint.Pads():
            if not pad.GetNetCode() or pad.GetAttribute()==pcb.PAD_ATTRIB_NPTH:continue
            for (net,layer),poly in pads.items():
                if net!=pad.GetNetCode() or not pad.IsOnLayer(layer):continue
                shape=pcb.SHAPE_POLY_SET()
                pad.TransformShapeToPolygon(shape,layer,0,pcb.FromMM(.001),pcb.ERROR_INSIDE)
                poly.BooleanAdd(shape)
    removed=[t for t in tracks if covered(trace_polygon(t),pads[(t.GetNetCode(),t.GetLayer())])]
    record={'method':'whole trace copper contained in same-net same-layer physical pad copper',
            'removedSegments':len(removed),'removedLengthMm':round(sum(pcb.ToMM(t.GetLength()) for t in removed),6),
            'removed':[{'net':t.GetNetname(),'layer':pcb.LayerName(t.GetLayer()),'lengthMm':round(pcb.ToMM(t.GetLength()),6)} for t in removed],
            'copperCoveragePreserved':True,'nativeDrcRequired':True}
    for track in removed:board.Remove(track)
    if removed:board.BuildConnectivity()
    # KiCad 10 SWIG custom-pad aggregate proxies must outlive board export.
    # Releasing these aggregates early invalidated BOARD proxies in the native
    # display-board regression; retain them with the board, not in global state.
    board._eda_pad_copper_keepalive=pads
    return record

def remove_redundant_tracks(board):
    filled=remove_filled_tracks(board)
    pads=remove_pad_tracks(board)
    return {'method':'complete copper coverage by actual filled zones or physical pads; same net and layer',
            'removedSegments':filled['removedSegments']+pads['removedSegments'],
            'removedLengthMm':round(filled['removedLengthMm']+pads['removedLengthMm'],6),
            'restoredSegments':filled['restoredSegments'],'filledZones':filled,'physicalPads':pads,
            'copperCoveragePreserved':True,'nativeDrcRequired':True}

def merge_collinear_tracks(board):
    """Remove segmentation artifacts without moving or removing any copper.

    Exact integer collinearity, equal width/net/layer and opposite directions
    are required. Branch copper stays in place even when its junction
    becomes an interior point of a merged trunk; protected tracks remain.
    """
    changes=[];keepalive=[]
    while True:
        joins=defaultdict(list)
        for track in board.GetTracks():
            if isinstance(track,(pcb.PCB_VIA,pcb.PCB_ARC)):continue
            for point in (track.GetStart(),track.GetEnd()):joins[(track.GetNetCode(),track.GetLayer(),point.x,point.y)].append(track)
        merged=False
        for (net,layer,x,y),tracks in joins.items():
            if len(tracks)<2 or net<=0:continue
            def other(track):
                start=track.GetStart();end=track.GetEnd()
                return end if (start.x,start.y)==(x,y) else start
            pair=None
            for a,b in combinations(tracks,2):
                if a.IsLocked() or b.IsLocked() or a.GetWidth()!=b.GetWidth():continue
                first,last=other(a),other(b);u=(first.x-x,first.y-y);v=(last.x-x,last.y-y)
                if u[0]*v[1]==u[1]*v[0] and u[0]*v[0]+u[1]*v[1]<0:
                    pair=(a,b,first,last);break
            if pair is None:continue
            a,b,first,last=pair
            new=pcb.PCB_TRACK(board);new.SetNet(a.GetNet());new.SetLayer(layer);new.SetWidth(a.GetWidth());new.SetStart(first);new.SetEnd(last)
            board.Remove(a);board.Remove(b);board.Add(new);keepalive.extend((a,b,new));merged=True
            changes.append({'net':a.GetNetname(),'layer':pcb.LayerName(layer),'removedJointMm':[pcb.ToMM(x),pcb.ToMM(y)]})
            break
        if not merged:break
    board._eda_collinear_keepalive=keepalive
    if changes:board.BuildConnectivity()
    return {'method':'exact same-width collinear copper union; no endpoint displacement','mergedJoints':len(changes),'changes':changes,'nativeDrcRequired':True}
