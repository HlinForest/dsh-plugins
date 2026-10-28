"""Joint translations of generated placements using actual pad/body geometry.

The input is the current generator's own placement, never a reference board.
Rotations, sides, topology, footprints and mechanical datums are unchanged.
Routing quality must be measured after routing: HPWL is only a search proxy.
"""
import math
from ortools.sat.python import cp_model


def compact(snapshot, step_mm=.5, seconds=20, deterministic_time=4.0):
    parts=sorted(snapshot['parts'],key=lambda p:p['ref']);byref={p['ref']:p for p in parts}
    reorder=set(snapshot.get('reorderParts',[]))
    if not reorder<=set(byref):raise ValueError('Unknown component in joint reordering')
    if len(parts)<2:return {'status':'unchanged','translations':{},'reason':'fewer than two parts'}
    if not 0<step_mm<=1:raise ValueError('Compaction step must be positive and at most 1 mm')
    scale=1000;unit=lambda n:round(n*scale);step=unit(step_mm)
    width,height=map(unit,snapshot['boardMm']);margin=unit(snapshot.get('edgeMarginMm',.8))
    model=cp_model.CpModel();xy={};movement=[];ranges={};limit=4*(width+height)
    for part in parts:
        ref=part['ref'];bounds=part['boundsMm'];vars=[]
        for axis,span in enumerate([width,height]):
            lo=math.ceil((margin-unit(bounds[axis]))/step);hi=math.floor((span-margin-unit(bounds[axis+2]))/step)
            if lo>hi:return {'status':'infeasible','translations':{},'reason':'envelope outside board '+ref}
            if part.get('fixed'):
                if not lo<=0<=hi:return {'status':'infeasible','translations':{},'reason':'fixed envelope outside board '+ref}
                lo=hi=0
            v=model.new_int_var(lo,hi,ref+':'+str(axis));model.add_hint(v,0);vars.append(v)
            d=model.new_int_var(0,limit,ref+':move'+str(axis));model.add_abs_equality(d,v);movement.append(d)
            ranges[(ref,axis)]=(lo,hi)
        xy[ref]=vars
    # Obstacles retain their physical side. A front body can overlap a back
    # body, but plated holes and copper on both sides reserve both sides.
    separation_count=0
    for i,a in enumerate(parts):
        for b in parts[i+1:]:
            for ao in a['obstacles']:
                for bo in b['obstacles']:
                    if ao['layer']!=bo['layer']:continue
                    kind={ao['kind'],bo['kind']}
                    gap=unit(snapshot['componentGapMm'] if kind=={'body'} else snapshot['clearanceMm'] if kind=={'pad'} else .3)
                    av=list(map(unit,ao['boxMm']));bv=list(map(unit,bo['boxMm']));ax,ay=xy[a['ref']];bx,by=xy[b['ref']]
                    # Preserve a currently valid separating axis. This is a
                    # compaction neighbourhood, not a global reordering claim.
                    # Use the dominant separating axis; a tiny incidental diagonal
                    # gap must not freeze otherwise legal translations.
                    # It avoids spending the search budget permuting obstacles
                    # that the generator already legally placed.
                    slack=[bv[0]-av[2]-gap,av[0]-bv[2]-gap,bv[1]-av[3]-gap,av[1]-bv[3]-gap]
                    legal=[k for k in range(4) if slack[k]>=0]
                    if not legal:return {'status':'infeasible','translations':{},'reason':'input obstacles overlap '+a['ref']+' '+b['ref']}
                    axis=max(legal,key=lambda k:(slack[k],-k));separation_count+=1
                    directions=[ax*step+av[2]+gap<=bx*step+bv[0],bx*step+bv[2]+gap<=ax*step+av[0],
                                ay*step+av[3]+gap<=by*step+bv[1],by*step+bv[3]+gap<=ay*step+av[1]]
                    if a['ref'] in reorder or b['ref'] in reorder:
                        # A failed branch may have been greedily placed on the
                        # wrong side of its receiver. Choose separation jointly
                        # instead of freezing that earlier placement decision.
                        choices=[model.new_bool_var('separate'+str(separation_count)+':'+str(k)) for k in range(4)]
                        for k,choice in enumerate(choices):
                            model.add(directions[k]).only_enforce_if(choice)
                            model.add_hint(choice,k==axis)
                        model.add_exactly_one(choices)
                    else:model.add(directions[axis])
    # Pre-routed owner circuits stay in their generated poses during this
    # neighbourhood. Moving foreign pads must respect their actual copper.
    copper_separations=0
    for part in parts:
        if part.get('fixed'):continue
        ax,ay=xy[part['ref']]
        for pad in part.get('copperPads',[]):
            for obstacle in snapshot.get('staticCopper',[]):
                if pad['layer']!=obstacle['layer'] or pad['net']==obstacle['net']:continue
                av=list(map(unit,pad['boxMm']));bv=list(map(unit,obstacle['boxMm']));gap=unit(snapshot['clearanceMm']+.003)
                directions=[ax*step+av[2]+gap<=bv[0],bv[2]+gap<=ax*step+av[0],ay*step+av[3]+gap<=bv[1],bv[3]+gap<=ay*step+av[1]]
                choices=[model.new_bool_var('copper'+str(copper_separations)+':'+str(k)) for k in range(4)]
                for direction,choice in zip(directions,choices):model.add(direction).only_enforce_if(choice)
                model.add_bool_or(choices);copper_separations+=1
    terms=[];objective_specs=[]
    priority={str(n) for n in snapshot.get('priorityNets',[])}
    for net in sorted(snapshot.get('nets',[]),key=lambda n:n['name']):
        terminals=net['terminals']
        if len({p['ref'] for p in terminals})<2:continue
        weight=(1 if net.get('copper') else 10)*(8 if net['name'] in priority else 1)
        for axis in range(2):
            coords=[xy[p['ref']][axis]*step+unit(p['atMm'][axis]) for p in terminals]
            low=model.new_int_var(-limit,limit,'lo'+str(len(terms)));high=model.new_int_var(-limit,limit,'hi'+str(len(terms)))
            model.add_min_equality(low,coords);model.add_max_equality(high,coords);terms.append(weight*(high-low))
        objective_specs.append((net,weight))
    for index,rel in enumerate(snapshot.get('relations',[])):
        a,b=rel['ref'],rel['owner'];dx=xy[a][0]-xy[b][0];dy=xy[a][1]-xy[b][1]
        pairs=rel['padPairsMm'];max_distance=rel.get('maxDistanceMm')
        if max_distance is not None:
            allowed=set()
            for ap,bp in pairs:
                px,py=ap[0]-bp[0],ap[1]-bp[1]
                for x in range(math.ceil((-max_distance-px)/step_mm),math.floor((max_distance-px)/step_mm)+1):
                    for y in range(math.ceil((-max_distance-py)/step_mm),math.floor((max_distance-py)/step_mm)+1):
                        if math.hypot(px+x*step_mm,py+y*step_mm)<=max_distance+1e-8:allowed.add((x,y))
            if not allowed:return {'status':'infeasible','translations':{},'reason':'no valid proximity '+a}
            rx=model.new_int_var(-limit,limit,'rx'+str(index));ry=model.new_int_var(-limit,limit,'ry'+str(index))
            model.add(rx==dx);model.add(ry==dy);model.add_allowed_assignments([rx,ry],sorted(allowed))
        distances=[]
        for pi,(ap,bp) in enumerate(pairs):
            ds=[]
            for axis,delta in enumerate([dx,dy]):
                v=model.new_int_var(0,limit,'near'+str(index)+':'+str(pi)+':'+str(axis))
                model.add_abs_equality(v,delta*step+unit(ap[axis]-bp[axis]));ds.append(v)
            d=model.new_int_var(0,limit,'nearPair'+str(index)+':'+str(pi));model.add(d==sum(ds));distances.append(d)
        near=model.new_int_var(0,limit,'nearest'+str(index));model.add_min_equality(near,distances)
        terms.append(rel.get('weight',20)*near)
    def cost(delta):
        total=0
        for net,weight in objective_specs:
            points=[[unit(p['atMm'][a]+delta.get(p['ref'],[0,0])[a]) for a in range(2)] for p in net['terminals']]
            total+=weight*sum(max(p[a] for p in points)-min(p[a] for p in points) for a in range(2))
        for rel in snapshot.get('relations',[]):
            ad=delta.get(rel['ref'],[0,0]);bd=delta.get(rel['owner'],[0,0])
            total+=rel.get('weight',20)*min(sum(abs(unit(ap[a]+ad[a]-bp[a]-bd[a])) for a in range(2)) for ap,bp in rel['padPairsMm'])
        return total/scale
    # Wire/proximity cost dominates movement; movement only breaks exact ties.
    objective=sum(terms);move_bound=sum(max(abs(lo),abs(hi)) for lo,hi in ranges.values())
    before=cost({})
    model.add(objective<=round(before*scale)-1)
    model.minimize(objective*(move_bound+1)+sum(movement))
    solver=cp_model.CpSolver();solver.parameters.max_time_in_seconds=seconds;solver.parameters.max_deterministic_time=deterministic_time
    solver.parameters.num_search_workers=1;solver.parameters.random_seed=0
    status=solver.solve(model)
    if status not in (cp_model.FEASIBLE,cp_model.OPTIMAL):return {'status':solver.status_name(status),'translations':{},'constraints':separation_count,'beforeProxyCost':before,'reason':'No strictly improving placement found within the model and search budget'}
    translations={ref:[solver.value(v)*step_mm for v in vs] for ref,vs in xy.items()}
    after=cost(translations)
    accepted=after<before-1e-6
    return {'status':solver.status_name(status),'translations':translations if accepted else {},'acceptedProxyImprovement':accepted,
            'beforeProxyCost':before,'afterProxyCost':after,'movedParts':sum(any(abs(v)>1e-8 for v in ds) for ds in translations.values()) if accepted else 0,
            'constraints':separation_count,'copperSeparations':copper_separations,'stepMm':step_mm,'wallTimeSeconds':solver.wall_time,
            'reorderedParts':sorted(reorder),
            'scope':'Generated placement translations with joint separation for declared related parts; actual routed connectivity and quality must be checked separately.' if reorder else 'Generated placement translations within existing obstacle separation order; actual routed connectivity and quality must be checked separately.'}


if __name__=='__main__':
    import sys
    from pathlib import Path
    sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'mcp'))
    from record_io import read_json,write_json
    write_json(sys.argv[2],compact(read_json(sys.argv[1])))
