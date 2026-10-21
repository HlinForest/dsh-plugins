"""Grid-constrained compaction of a layered placement, without changing topology."""
import math
from ortools.sat.python import cp_model

def compact(graph, grid=1.27):
    nodes=graph.get('children',[])
    if len(nodes)<2:return graph
    m=cp_model.CpModel(); xy={};sizes={};limit=math.ceil(2000/grid);pad=math.ceil(5.08/grid)
    for n in nodes:
        xy[n['id']]=[m.new_int_var(pad,limit,n['id']+a) for a in ('x','y')]
        sizes[n['id']]=[math.ceil(n[k]/grid) for k in ('width','height')]
    # Preserve ELK's relative ordering while removing empty channels.
    for i,a in enumerate(nodes):
        for b in nodes[i+1:]:
            relations=[]
            for axis,(k,size) in enumerate([('x','width'),('y','height')]):
                if a[k]+a[size]<=b[k]+.01:relations.append((axis,a,b,b[k]-a[k]-a[size]))
                elif b[k]+b[size]<=a[k]+.01:relations.append((axis,b,a,a[k]-b[k]-b[size]))
            if not relations:raise ValueError('Overlapping ELK obstacles')
            axis,first,last,_=min(relations,key=lambda x:x[3])
            count=lambda n:sum(p.get('layoutOptions',{}).get('elk.port.side') in ('WEST','EAST') for p in n.get('ports',[]))
            clearance=max(7.62,2.54*(max(count(first),count(last))+1)) if axis==0 else 3.81
            m.add(xy[last['id']][axis]>=xy[first['id']][axis]+sizes[first['id']][axis]+math.ceil(clearance/grid))
    w=m.new_int_var(1,limit*2,'width');h=m.new_int_var(1,limit*2,'height')
    for n in nodes:
        for axis,bound in enumerate([w,h]):m.add(bound>=xy[n['id']][axis]+sizes[n['id']][axis]+pad)
    ports={p['id']:(n,p) for n in nodes for p in n.get('ports',[])};costs=[]
    # A branched net with facing horizontal terminals has a straight signal trunk.
    # Vertical terminals attach below/above that trunk, rather than bending it.
    clusters=[]
    for edge in graph.get('edges',[]):
        members=set(edge['sources']+edge['targets']);merged=[]
        for cluster in clusters:
            if members & cluster:members |= cluster
            else:merged.append(cluster)
        clusters=merged+[members]
    align_costs=[]
    for members in clusters:
        horizontal=[ports[k] for k in members if ports[k][1].get('layoutOptions',{}).get('elk.port.side') in ('WEST','EAST')]
        if len(horizontal)<2:continue
        first,fp=horizontal[0];trunk=xy[first['id']][1]+round(fp['y']/grid)
        for n,p in horizontal[1:]:
            delta=m.new_int_var(0,limit*2,f'align{len(align_costs)}')
            m.add_abs_equality(delta,xy[n['id']][1]+round(p['y']/grid)-trunk)
            align_costs.append(delta)
        for key in members:
            n,p=ports[key];side=p.get('layoutOptions',{}).get('elk.port.side')
            if side in ('NORTH','SOUTH'):
                slack=m.new_int_var(0,limit*2,f'tap{len(align_costs)}')
                if side=='NORTH':m.add(xy[n['id']][1]+round(p['y']/grid)+slack>=trunk+math.ceil(3.81/grid))
                else:m.add(xy[n['id']][1]+round(p['y']/grid)-slack<=trunk-math.ceil(3.81/grid))
                align_costs.append(slack)
    for e in graph.get('edges',[]):
        for a in e['sources']:
            for b in e['targets']:
                an,ap=ports[a];bn,bp=ports[b]
                for axis,k in enumerate(['x','y']):
                    diff=m.new_int_var(0,limit*2,f'd{len(costs)}')
                    m.add_abs_equality(diff,xy[an['id']][axis]+round(ap[k]/grid)-xy[bn['id']][axis]-round(bp[k]/grid));costs.append(diff)
    # Alignment is a preference, not an electrical constraint. A net can have
    # multiple fixed pins on one symbol at different heights.
    m.minimize(100*sum(align_costs)+4*(w+h)+sum(costs));solver=cp_model.CpSolver();solver.parameters.max_time_in_seconds=5;solver.parameters.num_search_workers=1
    status=solver.solve(m)
    if status not in (cp_model.OPTIMAL,cp_model.FEASIBLE):raise ValueError('Constraint placement did not find a feasible layout')
    for n in nodes:n.update(x=solver.value(xy[n['id']][0])*grid,y=solver.value(xy[n['id']][1])*grid)
    graph.update(width=solver.value(w)*grid,height=solver.value(h)*grid,placementSolver='OR-Tools CP-SAT')
    return graph
