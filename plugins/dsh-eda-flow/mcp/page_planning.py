"""Place measured functional circuits on a sheet without modifying their contents.

The interface accepts group bounds and signal affinities, never device identities,
netlist edits or saved CAD coordinates. Captions and clearances remain hard bounds.
"""
import itertools
import math
from collections import Counter
from functional_groups import _blocked_net

def _ordered_pack(groups,width,height,gap,row_breaks=(),top_margin=0,rows_only=False):
    """Prefer aligned reading rows; retain bounded packing for tight pages."""
    boxes=[{'id':g['id'],'width':p['width'],'height':p['height']+top_margin} for g,p in groups]
    if not boxes:return {'width':0,'height':0,'children':[]}
    # Minimize occupied height over contiguous rows in the requested order.
    # A shortest-column placement scatters later groups into unrelated gaps.
    rows=[(0,[])]
    for end in range(1,len(boxes)+1):
        candidates=[]
        for start in range(end):
            if any(start<b<end for b in row_breaks):continue
            row=boxes[start:end]
            if rows[start] is None or sum(b['width'] for b in row)+gap*(len(row)-1)>width:continue
            old,prior=rows[start]
            candidates.append((old+(gap if start else 0)+max(b['height'] for b in row),prior+[row]))
        rows.append(min(candidates,key=lambda v:(round(v[0],4),tuple(-len(row) for row in v[1]))) if candidates else None)
    if rows[-1] is not None and rows[-1][0]<=height:
        placed=[];y=0;used_width=0
        for row in rows[-1][1]:
            x=0
            for box in row:
                placed.append({**box,'x':x,'y':y});x+=box['width']+gap
            used_width=max(used_width,x-gap)
            y+=max(b['height'] for b in row)+gap
        return {'width':used_width,'height':rows[-1][0],'children':placed}
    if row_breaks or rows_only:return None
    rank={b['id']:i for i,b in enumerate(boxes)}
    orders=itertools.islice(itertools.permutations(boxes),10000) if len(boxes)<=8 else [sorted(boxes,key=lambda b:-b['height']),boxes]
    best=None
    for order in orders:
        placed=[]
        for box in order:
            options=[]
            for y in sorted({0,*[p['y']+p['height']+gap for p in placed]}):
                for x in sorted({0,*[p['x']+p['width']+gap for p in placed]}):
                    if x+box['width']>width or y+box['height']>height:continue
                    if any(x<p['x']+p['width']+gap-.001 and x+box['width']+gap>p['x']+.001 and y<p['y']+p['height']+gap-.001 and y+box['height']+gap>p['y']+.001 for p in placed):continue
                    if any(((y,x)<(p['y'],p['x'])) != (rank[box['id']]<rank[p['id']]) for p in placed):continue
                    options.append((y,x))
            if not options:break
            y,x=min(options);placed.append({**box,'x':x,'y':y})
        else:
            w=max(p['x']+p['width'] for p in placed);h=max(p['y']+p['height'] for p in placed)
            by_id={p['id']:p for p in placed}
            score=tuple((by_id[b['id']]['y'],by_id[b['id']]['x']) for b in boxes)+(h,w)
            if best is None or score<best[0]:best=(score,{'width':w,'height':h,'children':placed})
    return best[1] if best else None


def signal_affinities(design, groups):
    """Weight shared signal nets, excluding supply/return hubs and duplicate pins."""
    groupof = {ref: group['id'] for group in groups for ref in group['references']}
    pins = {c['ref']+'.'+str(p['number']): p for c in design['components'] for p in c['pins']}
    weights = Counter()
    for net in design['nets']:
        if _blocked_net(net['name'], set(design.get('supplied_nets', []))):
            continue
        if any(pins.get(key, {}).get('type') in ('power_in', 'power_out') for key in net['nodes']):
            continue
        owners = sorted({groupof[key.rsplit('.', 1)[0]] for key in net['nodes']
                         if key.rsplit('.', 1)[0] in groupof})
        for pair in itertools.combinations(owners, 2):
            weights[pair] += 1
    return [{'source': a, 'target': b, 'weight': weight}
            for (a, b), weight in sorted(weights.items())]


def _score(packed, connections):
    boxes = {b['id']: b for b in packed['children']}
    result = 8*(packed['width']+packed['height'])
    for link in connections:
        a, b = boxes[link['source']], boxes[link['target']]
        # Center distance pulls a small interface toward the middle of a wide
        # module even when it is already adjacent, leaving its other peer far
        # away. Edge separation measures actual whitespace between blocks.
        result += 2*link['weight']*sum(max(0,a[axis]-b[axis]-b[size],b[axis]-a[axis]-a[size])
                                       for axis,size in [('x','width'),('y','height')])
    return round(result, 5)


def _seed_pack(groups, width, height, gap, margin, connections, initial):
    """Bounded measured row/column candidates, without prescribed coordinates."""
    groups = sorted(groups, key=lambda pair: pair[0]['id'])
    if len(groups) <= 6:
        orders = itertools.permutations(groups)
    else:
        orders = [groups, list(reversed(groups)),
                  sorted(groups, key=lambda p:(-p[1]['height'],p[0]['id'])),
                  sorted(groups, key=lambda p:(-p[1]['width'],p[0]['id'])),
                  sorted(groups, key=lambda p:(-p[1]['width']*p[1]['height'],p[0]['id']))]
    best = initial
    tested = feasible = 0
    def key(candidate):
        return (_score(candidate, connections), candidate['width']+candidate['height'],
                tuple((b['id'],b['y'],b['x']) for b in sorted(candidate['children'],key=lambda b:b['id'])))
    for order in orders:
        for columns in (False, True):
            tested += 1
            if columns:
                rotated = [(g, {'width':p['height']+margin,'height':p['width']}) for g,p in order]
                candidate = _ordered_pack(rotated, height, width, gap, rows_only=True)
                if candidate:
                    candidate = {'width':candidate['height'],'height':candidate['width'],
                                 'children':[{'id':b['id'],'x':b['y'],'y':b['x'],'width':b['height'],'height':b['width']} for b in candidate['children']]}
            else:
                candidate = _ordered_pack(order, width, height, gap, top_margin=margin, rows_only=True)
            if candidate:
                feasible += 1
                if best is None or key(candidate)<key(best):
                    best = candidate
    return best, {'tested':tested,'feasible':feasible,'seedScore':_score(best,connections) if best else None}


def _constraint_pack(boxes, width, height, gap, connections, seed):
    from ortools.sat.python import cp_model
    # Centi-mm is a solver precision, not a supplied component coordinate.
    # Whole groups are translated onto the connection grid by the compiler.
    scale = 100
    units = lambda value: math.ceil(value * scale - 1e-7)
    W, H = math.floor(width * scale + 1e-7), math.floor(height * scale + 1e-7)
    clearance = units(gap)
    model = cp_model.CpModel()
    requested_boxes = boxes
    boxes = sorted(boxes, key=lambda b: b['id'])
    connections = sorted(({**c, 'source': min(c['source'], c['target']),
                           'target': max(c['source'], c['target'])} for c in connections),
                         key=lambda c: (c['source'], c['target'], c['weight']))
    positions = {}; sizes = {}; intervals = [[], []]
    for index, box in enumerate(boxes):
        ident = box['id']; w, h = units(box['width']), units(box['height'])
        if w > W or h > H:
            return None
        sizes[ident] = (w, h)
        x = model.new_int_var(0, W-w, f'x{index}')
        y = model.new_int_var(0, H-h, f'y{index}')
        positions[ident] = (x, y)
        intervals[0].append(model.new_fixed_size_interval_var(x, w+clearance, f'ix{index}'))
        intervals[1].append(model.new_fixed_size_interval_var(y, h+clearance, f'iy{index}'))
    model.add_no_overlap_2d(*intervals)
    bound_x = model.new_int_var(0, W, 'used_width')
    bound_y = model.new_int_var(0, H, 'used_height')
    model.add_max_equality(bound_x, [positions[b['id']][0]+sizes[b['id']][0] for b in boxes])
    model.add_max_equality(bound_y, [positions[b['id']][1]+sizes[b['id']][1] for b in boxes])
    distance_costs = []
    for index, connection in enumerate(connections):
        a, b = connection['source'], connection['target']
        if a not in positions or b not in positions or a == b:
            raise ValueError('Signal affinity must join two existing groups')
        weight = connection['weight']
        if not isinstance(weight, int) or weight <= 0:
            raise ValueError('Signal affinity weight must be a positive integer')
        for axis, limit in enumerate((W, H)):
            delta = model.new_int_var(0, limit, f'd{index}_{axis}')
            model.add_max_equality(delta,[0,positions[a][axis]-positions[b][axis]-sizes[b][axis],
                                          positions[b][axis]-positions[a][axis]-sizes[a][axis]])
            distance_costs.append(2*weight*delta)
    # Compact envelope plus proximity of electrically related functional groups.
    # Neither input array order nor a board-specific visual template is a hard constraint.
    model.minimize(8*(bound_x+bound_y)+sum(distance_costs))
    if seed:
        for box in seed['children']:
            for axis, key in enumerate(('x', 'y')):
                model.add_hint(positions[box['id']][axis], units(box[key]))
    solver = cp_model.CpSolver()
    solver.parameters.num_search_workers = 1
    solver.parameters.random_seed = 0
    solver.parameters.max_deterministic_time = 0.5
    solver.parameters.max_time_in_seconds = 5
    status = solver.solve(model)
    if status not in (cp_model.FEASIBLE, cp_model.OPTIMAL):
        return None
    placed = [{**b, 'x': solver.value(positions[b['id']][0])/scale,
               'y': solver.value(positions[b['id']][1])/scale} for b in requested_boxes]
    return {'width': solver.value(bound_x)/scale, 'height': solver.value(bound_y)/scale,
            'children': placed, 'strategy': 'constraint-topology',
            'solverStatus': solver.status_name(status), 'connections': connections,
            'objective': solver.objective_value}


def pack_groups(groups, width, height, gap, row_breaks=(), top_margin=0, connections=()):
    """Fit groups before page promotion, keeping explicit row boundaries intact.

    Ordered rows remain the fast path without signal relationships. If they fail,
    solve the actual rectangle constraints rather than promoting the sheet solely
    because serialized group order prevents an otherwise valid column packing.
    """
    boxes = [{'id': g['id'], 'width': p['width'], 'height': p['height']+top_margin}
             for g, p in groups]
    values = [width, height, gap, top_margin, *[b[k] for b in boxes for k in ('width', 'height')]]
    if any(not math.isfinite(v) or v < 0 for v in values):
        raise ValueError('Page and group dimensions must be finite and non-negative')
    if len({b['id'] for b in boxes}) != len(boxes):
        raise ValueError('Group IDs must be unique')
    # Canonicalize both the solver and its initial packing hint. A hint built
    # from serialized input order otherwise changes a bounded search result.
    seeded_groups = sorted(groups, key=lambda pair: pair[0]['id']) if connections and not row_breaks else groups
    ordered = _ordered_pack(seeded_groups, width, height, gap, row_breaks, top_margin)
    if not boxes or row_breaks or (ordered is not None and not connections):
        return ordered
    seeded, search = _seed_pack(groups, width, height, gap, top_margin, connections, ordered)
    solved = _constraint_pack(boxes, width, height, gap, list(connections), seeded)
    # CP-SAT may return a feasible but worse layout within its time bound.
    # Retain the measured candidate unless the actual objective improves.
    result = solved if solved and (seeded is None or _score(solved,connections)<_score(seeded,connections)) else seeded
    if result:
        result.setdefault('strategy','topology-seeded-rows-columns')
        result['candidateSearch'] = {**search, 'solverScore':_score(solved,connections) if solved else None,
                                     'selectedScore':_score(result,connections)}
        rank = {box['id']: i for i, box in enumerate(boxes)}
        result['children'].sort(key=lambda box: rank[box['id']])
    return result
