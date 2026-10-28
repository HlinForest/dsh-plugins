"""Optional joint placement of repeated series channels from reviewed nets.

Only unambiguous two-terminal branches with an output driver and a common
load qualify. The native driver pad row determines order and outward normal.
This is a placement proposal, never evidence of routability or electrical fit.
"""
import math


def series_channels(components, expected):
    byref={c['ref']:c for c in components};nodes={}
    for (ref,pin),net in expected.items():nodes.setdefault(net,[]).append((ref,str(pin)))
    types={(c['ref'],str(p.get('pad',p['number']))):p.get('type') for c in components for p in c.get('pins',[])}
    result=[]
    for ref,c in sorted(byref.items()):
        if c.get('electricalRole')!='current-limit':continue
        members=[(str(pin),net) for (owner,pin),net in expected.items() if owner==ref]
        if len(members)!=2 or len({net for pin,net in members})!=2:continue
        options=[]
        for source,load in (members,list(reversed(members))):
            upstream=[n for n in nodes[source[1]] if n[0]!=ref]
            downstream=[n for n in nodes[load[1]] if n[0]!=ref]
            if len(upstream)!=1 or len(downstream)!=1:continue
            if types.get(upstream[0])!='output' or types.get(downstream[0]) not in ('passive','input'):continue
            if upstream[0][0]==downstream[0][0]:continue
            options.append({'ref':ref,'inputPad':source[0],'outputPad':load[0],
                            'driver':{'ref':upstream[0][0],'pad':upstream[0][1]},
                            'load':{'ref':downstream[0][0],'pad':downstream[0][1]}})
        if len(options)==1:result.append(options[0])
    return result


def pad_row_banks(channels, points, centers):
    """Group by actual collinear pad rows, not pin numbers or reference names."""
    groups={}
    for channel in channels:
        driver=channel['driver'];load=channel['load'];key=(driver['ref'],driver['pad'])
        if key not in points or driver['ref'] not in centers:continue
        at=points[key];center=centers[driver['ref']];delta=[at[a]-center[a] for a in range(2)]
        # A long package's end pins can be farther from its center along the
        # row than across it. Infer row orientation from all native pad peers,
        # rather than from the largest center displacement.
        peers=[p for (owner,pin),p in points.items() if owner==driver['ref'] and pin]
        counts=[sum(abs(p[a]-at[a])<.01 for p in peers) for a in range(2)]
        if max(counts)<2 or counts[0]==counts[1]:continue
        normal=max(range(2),key=lambda a:counts[a])
        if abs(delta[normal])<.01:continue
        sign=1 if delta[normal]>0 else -1
        row=(driver['ref'],load['ref'],normal,sign,round(at[normal],2))
        groups.setdefault(row,[]).append({**channel,'driverAtMm':at})
    result=[]
    for (driver,load,normal,sign,coordinate),members in sorted(groups.items()):
        if len(members)<2:continue
        tangent=1-normal;members.sort(key=lambda c:(c['driverAtMm'][tangent],c['ref']))
        if len({round(c['driverAtMm'][tangent],2) for c in members})!=len(members):continue
        result.append({'driver':driver,'load':load,'normalAxis':normal,'outwardSign':sign,'members':members})
    return result


def propose_bank(bank, geometries, owner_box, gap, valid, anchors):
    """Pack a row jointly; caller checks real bodies, pads and copper corridors.

    Geometry entries are native envelopes/pad offsets for each legal rotation.
    The search offsets are relative to the actual driver envelope and pad row.
    No pose, spacing, pin sequence or part value comes from a reference board.
    """
    normal=bank['normalAxis'];tangent=1-normal;sign=bank['outwardSign'];members=bank['members']
    choices=[]
    for member in members:
        options=[]
        for g in geometries.get(member['ref'],[]):
            a=g['pads'][member['inputPad']];b=g['pads'][member['outputPad']]
            if abs(a[tangent]-b[tangent])>.01 or sign*(b[normal]-a[normal])<=.01:continue
            options.append(g)
        if not options:return None
        choices.append(min(options,key=lambda g:g['rotation']))
    widths=[g['box'][tangent+2]-g['box'][tangent] for g in choices]
    offsets=[0.0]
    for i in range(1,len(choices)):offsets.append(offsets[-1]+(widths[i-1]+widths[i])/2+gap)
    target=sum(m['driverAtMm'][tangent]-o for m,o in zip(members,offsets))/len(members)
    edge=owner_box[normal+2] if sign>0 else owner_box[normal]
    row=edge+sign*gap-(min(g['box'][normal] for g in choices) if sign>0 else max(g['box'][normal+2] for g in choices))
    best=None;tested=0;feasible=0
    def cross(a,b,c,d):
        def orient(x,y,z):return (y[0]-x[0])*(z[1]-x[1])-(y[1]-x[1])*(z[0]-x[0])
        return orient(a,b,c)*orient(a,b,d)<-1e-8 and orient(c,d,a)*orient(c,d,b)<-1e-8
    for outward in range(17):
        for shift in range(-12,13):
            proposal=[];score=0;lines=[];tested+=1
            for member,g,offset in zip(members,choices,offsets):
                # Center the actual envelope along the row (asymmetric origins allowed).
                at=[0.0,0.0];at[normal]=row+sign*outward*.5
                at[tangent]=target+offset+shift*.5-(g['box'][tangent]+g['box'][tangent+2])/2
                pose={'ref':member['ref'],'xMm':at[0],'yMm':at[1],'rotation':g['rotation'],'geometry':g}
                if not valid(pose,proposal):break
                proposal.append(pose)
                for pin,local in g['pads'].items():
                    if not anchors.get((member['ref'],pin)):continue
                    a=[at[i]+local[i] for i in range(2)]
                    b=min(anchors[(member['ref'],pin)],key=lambda q:sum(abs(a[i]-q[i]) for i in range(2)))
                    score+=sum(abs(a[i]-b[i]) for i in range(2));lines.append((a,b))
            if len(proposal)!=len(members):continue
            feasible+=1;score+=20*sum(cross(a,b,c,d) for i,(a,b) in enumerate(lines) for c,d in lines[i+1:])
            rank=(score,outward,abs(shift),shift)
            if best is None or rank<best[0]:best=(rank,proposal)
    if best is None:return None
    return {'poses':[{k:v for k,v in p.items() if k!='geometry'} for p in best[1]],'proxyCost':best[0][0],
            'tested':tested,'feasible':feasible,'driver':bank['driver'],'load':bank['load'],
            'method':'common driver/load, actual output pad row and native envelopes; route acceptance required'}
