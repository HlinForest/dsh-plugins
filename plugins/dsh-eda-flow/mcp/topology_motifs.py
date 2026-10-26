"""Bounded, reference/name independent matching of reviewed electrical motifs.

No electrical edits: a match supplies only a bijection for presentation reuse.
Unmatched parts remain available to the ordinary layout engine.
"""
import copy, hashlib, json
from pathlib import Path

def digest(value):
    return hashlib.sha256(json.dumps(value,sort_keys=True,ensure_ascii=False).encode()).hexdigest()

def native_kind(c):
    return digest({k:c.get(k) for k in ('librarySymbol','footprint','value','mpn','pins','dnp','in_bom','on_board')})

def fixed_kind(c):
    import fixed_components as fc
    s=fc.symbol(c)
    return digest({'value':c['value'],'symbol':{k:v for k,v in s.items() if k not in ('name','description','reference_prefix')}})

def model(components,design,kind):
    return {'parts':{c['ref']:{'kind':kind(c),'pins':[str(p['number']) for p in c['pins']]} for c in components},
            'nets':copy.deepcopy(design['nets']),'nc':list(design['nc'])}

def find_match(pattern,host,excluded=(),budget=20000):
    """Injective parts and nets; every template pin and NC is checked.

    Boundary nets may have more external members in the host. Two distinct
    template nets can never be collapsed, including the sides of a 0R part.
    """
    pn={k:n['name'] for n in pattern['nets'] for k in n['nodes']}
    hn={k:n['name'] for n in host['nets'] for k in n['nodes']}
    pnc=set(pattern['nc']);hnc=set(host['nc']);excluded=set(excluded)
    candidates={r:sorted(h for h,c in host['parts'].items() if h not in excluded and c==p) for r,p in pattern['parts'].items()}
    if any(not c for c in candidates.values()):return None
    order=sorted(candidates,key=lambda r:(len(candidates[r]),-len(pattern['parts'][r]['pins']),r))
    count=0
    def visit(i,bindings,nets):
        nonlocal count
        count+=1
        if count>budget:return None
        if i==len(order):return {'bindings':bindings,'netBindings':nets}
        r=order[i]
        for h in candidates[r]:
            if h in bindings.values():continue
            nextnets=dict(nets);ok=True
            for pin in pattern['parts'][r]['pins']:
                pk=r+'.'+pin;hk=h+'.'+pin
                if (pk in pnc)!=(hk in hnc):ok=False;break
                if pk in pnc:continue
                a=pn.get(pk);b=hn.get(hk)
                if a is None or b is None or a in nextnets and nextnets[a]!=b or a not in nextnets and b in nextnets.values():ok=False;break
                nextnets[a]=b
            if ok:
                result=visit(i+1,{**bindings,r:h},nextnets)
                if result:return result
        return None
    return visit(0,{}, {})

def native_matches(resources,d):
    """Discover reviewed library fragments without requiring blockInstances."""
    # Mock PDF demos must derive their CAD from visible specification facts.
    # Do not even scan historical frozen CAD fragments in this mode.
    if resources.get('mockEvidence'):return []
    import native_resources as nr
    from design_audit import child,children
    host=model(d['components'],d,native_kind); used={r for b in resources.get('blocks',[]) for r in b['bindings'].values()};found=[]
    root=Path(__file__).parent.parent/'libraries'/'blocks'
    for path in sorted(root.glob('*.json')):
        block=json.loads(path.read_text(encoding='utf8'))
        if 'design' not in block or not block.get('autoDetect',True):continue
        fragment=(root/block['fragment']).resolve()
        if not fragment.is_relative_to(root.resolve()):raise ValueError('Unsafe motif path')
        native=fragment.read_text(encoding='utf8')
        if nr.sha(native)!=block['fragmentSha256']:raise ValueError('Reviewed motif fragment changed')
        syms=children(child(nr.parse(native),'lib_symbols',[]),'symbol')
        if any(s[1] not in resources['symbols'] or s!=nr.parse(resources['symbols'][s[1]]['native']) for s in syms):continue
        pattern=model(block['design']['components'],block['design'],native_kind)
        while True:
            match=find_match(pattern,host,used)
            if not match:break
            used.update(match['bindings'].values())
            found.append({**match,'blockId':block['id'],'version':block['version'],'native':native,
                          **{k:block[k] for k in ('width','height','origin','validation','limitations')},'automatic':True})
    return found
