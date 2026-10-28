"""Presentation alternatives for a small powered module and one interface.

Recognition uses current electrical connectivity only. No values, net names,
reference designators or coordinates from an example board are accepted.
"""
import copy,itertools
from functional_groups import _kind,_is_kind,decoupling_hints


def recognize(refs,design,resources):
    refs=set(refs);comps={c['ref']:c for c in design['components'] if c['ref'] in refs}
    kinds={r:_kind(c,resources) for r,c in comps.items()}
    hubs=[r for r in refs if _is_kind(kinds.get(r),'infrared-receiver')]
    ports=[r for r in refs if _is_kind(kinds.get(r),'connector') and len(comps[r]['pins'])>2]
    if len(hubs)!=1 or len(ports)!=1:return None
    hub,port=hubs[0],ports[0]
    if len(comps[hub]['pins'])!=3:return None
    keys=lambda r:[r+'.'+str(p['number']) for p in comps[r]['pins']]
    netof={k:n['name'] for n in design['nets'] for k in n['nodes']}
    roles={}
    for p in comps[hub]['pins']:
        role=('return' if str(p.get('name','')).upper() in {'GND','SGND','AGND','DGND','PGND','VSS'}
              else 'supply' if p.get('type')=='power_in'
              else 'signal' if p.get('type') in {'output','open_collector','open_emitter'} else None)
        if role is None or role in roles:return None
        roles[role]=hub+'.'+str(p['number'])
    if set(roles)!={'supply','return','signal'} or len({netof.get(k) for k in roles.values()})!=3:return None
    if any(k not in netof for k in keys(hub)):return None
    port_keys=[k for k in keys(port) if k in netof]
    if set(keys(port))-set(port_keys)-set(design.get('nc',[])):return None
    if len({netof[k] for k in port_keys})!=len(port_keys):return None
    resistors={r for r in refs-{hub,port} if _is_kind(kinds[r],'resistor') and len(keys(r))==2}
    if len(resistors)>4:return None
    capacitors=refs-{hub,port}-resistors
    if not capacitors or any(not _is_kind(kinds[r],'capacitor') or len(keys(r))!=2 for r in capacitors):return None
    # One resistor per path is supported; ambiguity is retained for the
    # ordinary layout path, rather than choosing the first matching branch.
    paths={}
    for role,start in roles.items():
        options=[]
        for end in port_keys:
            if netof[start]==netof[end]:options.append({'start':start,'end':end,'series':None})
            for r in resistors:
                for a,b in itertools.permutations(keys(r)):
                    if netof.get(a)==netof[start] and netof.get(b)==netof[end] and netof[a]!=netof[b]:
                        options.append({'start':start,'end':end,'series':r,'near':a,'far':b})
        if not options:return None
        paths[role]=options
    matches=[]
    for choice in itertools.product(*(paths[k] for k in ('supply','return','signal'))):
        selected=dict(zip(('supply','return','signal'),choice))
        used=[p['series'] for p in choice if p['series']]
        if len(set(used))!=len(used) or len({p['end'] for p in choice})!=3:continue
        extra=resistors-set(used)
        if len(extra)>1:continue
        pull=None
        if extra:
            r=next(iter(extra));out=netof[roles['signal']]
            pairs=[(a,b) for a,b in itertools.permutations(keys(r)) if netof.get(a)==out and netof.get(b) in {netof[roles['supply']],netof[selected['supply']['end']]}]
            if len(pairs)!=1:continue
            pull={'ref':r,'signal':pairs[0][0],'rail':pairs[0][1]}
        matches.append((selected,pull))
    if len(matches)!=1:return None
    paths,pull=matches[0]
    supply,ret=netof[roles['supply']],netof[roles['return']]
    caps=[]
    owned=decoupling_hints(design).get(hub,{})
    for r in sorted(capacitors):
        pairs=[(a,b) for a,b in itertools.permutations(keys(r)) if netof.get(a)==supply and netof.get(b)==ret]
        if len(pairs)!=1 or len(capacitors)>1 and r not in owned:return None
        caps.append({'ref':r,'supply':pairs[0][0],'return':pairs[0][1]})
    return {'hub':hub,'interface':port,'roles':roles,'paths':paths,'pull':pull,'caps':caps,'references':sorted(refs)}


def rotations(pattern,design,resources,explicit=()):
    """Orient passive terminals by branch role, preserving explicit geometry."""
    import native_resources as nr
    from design_audit import child,children
    from symbol_orientation import _pin_angles,_rotation_for_direction
    comps={c['ref']:c for c in design['components']};desired={}
    for p in pattern['paths'].values():
        if p['series']:desired[p['near']]=(-1,0);desired[p['far']]=(1,0)
    for c in pattern['caps']:desired[c['supply']]=(0,-1);desired[c['return']]=(0,1)
    if pattern['pull']:
        desired[pattern['pull']['rail']]=(0,-1);desired[pattern['pull']['signal']]=(0,1)
    result={}
    for ref in {k.rsplit('.',1)[0] for k in desired}:
        resource=resources['symbols'][comps[ref]['librarySymbol']]
        if ref in explicit or resource.get('drawingRules') or _kind(comps[ref],resources) not in {'capacitor','resistor'}:return None
        angles=_pin_angles(nr.parse(resource['native']),children,child)
        values={_rotation_for_direction(angles.get(k.rsplit('.',1)[1]),v) for k,v in desired.items() if k.rsplit('.',1)[0]==ref}
        if len(values)!=1 or None in values:return None
        result[ref]=values.pop()
    return result


def alternatives(design,resources,layout,explicit=(),merge_groups=True):
    fixed={r for b in resources.get('blocks',[]) for r in b.get('bindings',{}).values()}
    result=[]
    combinations=[(g,) for g in layout['groups']]
    if merge_groups:combinations.extend(itertools.combinations(layout['groups'],2))
    for source_groups in combinations:
        a=source_groups[0];refs=set().union(*(set(g['references']) for g in source_groups))
        if refs&fixed:continue
        pattern=recognize(refs,design,resources)
        if not pattern:continue
        angles=rotations(pattern,design,resources,explicit)
        if angles is None:continue
        candidate=copy.deepcopy(layout)
        first=next(g for g in candidate['groups'] if g['id']==a['id'])
        if len(source_groups)>1:
            first['references']=sorted(refs);first['title']='接口与局部电路'
        removed={g['id'] for g in source_groups[1:]}
        candidate['groups']=[g for g in candidate['groups'] if g['id'] not in removed]
        candidate['rotations'].update(angles)
        if len(source_groups)==1 and all(layout['rotations'].get(r,0)==angle for r,angle in angles.items()):continue
        result.append({'layout':candidate,'cluster':{'groups':[g['id'] for g in source_groups],'hub':pattern['hub'],'interface':pattern['interface']}})
    return result[:2]


def patterns(design,resources,groups):
    return [p for g in groups if (p:=recognize(g['references'],design,resources))]


def local_return_nodes(design,resources,groups):
    netof={k:n['name'] for n in design['nets'] for k in n['nodes']};result=set()
    for p in patterns(design,resources,groups):
        nets={netof[p['roles']['return']],netof[p['paths']['return']['end']]}
        result.update(k for n in design['nets'] if n['name'] in nets for k in n['nodes'] if k.rsplit('.',1)[0] in p['references'])
    return result


def column_fields(design,resources,groups):
    result=set()
    for p in patterns(design,resources,groups):
        result.update(c['ref'] for c in p['caps'])
        if p['pull']:result.add(p['pull']['ref'])
    comps={c['ref']:c for c in design['components']}
    fixed={r for b in resources.get('blocks',[]) for r in b.get('bindings',{}).values()}
    return {r for r in result if r not in fixed and _kind(comps[r],resources) in {'resistor','capacitor'}
            and not resources['symbols'][comps[r]['librarySymbol']].get('drawingRules')}
