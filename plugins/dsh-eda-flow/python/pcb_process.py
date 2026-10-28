"""Visible process constraints enforced against actual packages and connectivity."""
import math,copy
import pcbnew as pcb

def native_process(source,pads):
    process=copy.deepcopy(source);names={}
    for relation in process.get('relations',[]):
        for role,key in [('anchor','supplyNet'),('return','returnNet')]:
            endpoint=relation[role];actual={p.GetNetname() for p in pads[(endpoint['ref'],endpoint['pad'])]}
            if len(actual)!=1 or not next(iter(actual)):raise ValueError('Ambiguous native supply net')
            native=next(iter(actual));logical=relation[key]
            if logical in names and names[logical]!=native:raise ValueError('Supply net alias differs by owner')
            names[logical]=native;relation[key]=native
    for entry in process.get('copperNets',[]):
        entry['logicalName']=entry['name'];entry['name']=names[entry['name']]
    return process

def assembly_sides(footprints,requested,process):
    sides=dict(requested);facts=[]
    for ref,fp in footprints.items():
        pads=list(fp.Pads());has_hole=any(p.GetAttribute() in (pcb.PAD_ATTRIB_PTH,pcb.PAD_ATTRIB_NPTH) for p in pads)
        kind='THT' if has_hole else 'SMD'
        policy=process.get('pcbThtSide' if has_hole else 'pcbSmdSide','不限定')
        if policy!='不限定':sides[ref]='B.Cu' if policy=='底面' else 'F.Cu'
        facts.append({'ref':ref,'packageType':kind,'side':sides.get(ref,'F.Cu'),'basis':'actual physical pads'})
    return sides,facts

def relation_distance(footprints,r):
    members=[p for p in footprints[r['ref']].Pads() if p.GetNumber()==r['supplyPad']]
    anchors=[p for p in footprints[r['anchor']['ref']].Pads() if p.GetNumber()==r['anchor']['pad']]
    if not members or not anchors:raise ValueError('Power placement pin/pad missing '+r['ref'])
    if any(a.GetNetname()!=b.GetNetname() for a in members for b in anchors):raise ValueError('Power placement pin/pad net mismatch '+r['ref'])
    return min(math.hypot(pcb.ToMM(a.GetPosition().x-b.GetPosition().x),pcb.ToMM(a.GetPosition().y-b.GetPosition().y)) for a in members for b in anchors)

def placement_report(board,process):
    footprints={f.GetReference():f for f in board.GetFootprints()};rows=[]
    for r in process.get('relations',[]):
        distance=relation_distance(footprints,r);limit=r.get('maxDistanceMm')
        rows.append({**r,'distanceMm':round(distance,6),'passed':limit is None or distance<=limit+.000002})
    return {'relations':rows,'passed':all(r['passed'] for r in rows),'metric':'supply pad to owner supply pad, straight-line; not loop inductance or transient performance'}

def refresh_copper_report(board,result):
    """Native zone iteration order is not an association with input rows."""
    actual={z.m_Uuid.AsString():z for z in board.Zones()}
    for entry in result['zones']:
        zone=actual[entry['zoneId']];layer=zone.GetLayer()
        if zone.GetNetname()!=entry['name']:raise ValueError('Copper report net mismatch')
        entry['priority']=zone.GetAssignedPriority()
        entry['filledPolygons']=zone.GetFilledPolysList(layer).OutlineCount()
        entry['filledAreaMm2']=zone.GetFilledPolysList(layer).Area()/1e12
    return result

def add_copper(board,process,plan):
    rows=[];layers=plan.get('activeLayers',['F.Cu','B.Cu'])
    if not process.get('copperNets'):return {'zones':[],'filled':False}
    if len(layers)!=1:raise ValueError('Copper policy requires one explicit routing layer')
    layer=pcb.B_Cu if layers[0]=='B.Cu' else pcb.F_Cu
    w,h=plan['widthMm'],plan['heightMm'];edge=.8
    for entry in process['copperNets']:
        pads=[p for fp in board.GetFootprints() for p in fp.Pads() if p.GetNetname()==entry['name'] and p.GetLayerSet().Contains(layer)]
        if len(pads)<2:raise ValueError('Copper policy net has fewer than two physical pads: '+entry['name'])
        if entry['kind']=='return':bounds=(edge,edge,w-edge,h-edge)
        else:
            boxes=[p.GetBoundingBox() for p in pads]
            bounds=(max(edge,min(pcb.ToMM(b.GetX()) for b in boxes)-1),max(edge,min(pcb.ToMM(b.GetY()) for b in boxes)-1),min(w-edge,max(pcb.ToMM(b.GetRight()) for b in boxes)+1),min(h-edge,max(pcb.ToMM(b.GetBottom()) for b in boxes)+1))
        x0,y0,x1,y1=bounds
        zone=pcb.ZONE(board);zone.SetLayer(layer);zone.SetNet(pads[0].GetNet());zone.SetLocalClearance(pcb.FromMM(plan['clearanceMm']));zone.SetMinThickness(pcb.FromMM(plan['trackWidthMm']))
        zone.SetPadConnection(pcb.ZONE_CONNECTION_FULL);zone.SetAssignedPriority(0 if entry['kind']=='return' else 1)
        zone.SetIslandRemovalMode(pcb.ISLAND_REMOVAL_MODE_ALWAYS)
        poly=zone.Outline();poly.NewOutline()
        for x,y in [(x0,y0),(x1,y0),(x1,y1),(x0,y1)]:poly.Append(pcb.FromMM(x),pcb.FromMM(y))
        board.Add(zone);rows.append({**entry,'zoneId':zone.m_Uuid.AsString(),'layer':layers[0],'boundsMm':list(bounds),'padConnection':'solid','islands':'remove-all','geometry':'board inset for return; actual net pad envelope + 1 mm for supply'})
    # Resolve overlapping domains explicitly. Larger envelopes fill first;
    # smaller local domains have higher priority, independent of random UUIDs.
    # This is a geometric heuristic, still subject to native connectivity DRC.
    def order(entry):
        x0,y0,x1,y1=entry['boundsMm']
        return (entry['kind']!='return',-(x1-x0)*(y1-y0),entry['name'])
    zones={z.m_Uuid.AsString():z for z in board.Zones()}
    for priority,entry in enumerate(sorted(rows,key=order)):
        zones[entry['zoneId']].SetAssignedPriority(priority)
    board.BuildConnectivity();pcb.ZONE_FILLER(board).Fill(board.Zones())
    result={'zones':rows,'filled':True,'priorityPolicy':'return domains first; then descending actual pad-envelope area; equal areas ordered by net name; native connectivity required','assumptions':['Solid pad connection; production soldering/thermal relief policy requires review.','Copper is added to existing nets only, never contracts zero-ohm boundaries.']}
    refresh_copper_report(board,result)
    for entry in rows:
        if entry['filledPolygons']==0:raise ValueError('Requested copper zone has no connected fill: '+entry['name'])
    return result
