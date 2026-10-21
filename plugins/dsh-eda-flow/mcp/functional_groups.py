"""Infer schematic reading groups from component roles and net adjacency."""
import re

def groups(design,resources):
    if not any(s.get('drawingRules') for s in resources.get('symbols',{}).values()):return None
    comps={c['ref']:c for c in design['components']}
    kind=lambda r:resources['symbols'][comps[r]['librarySymbol']].get('appearance',{}).get('kind')
    netof={k:n['name'] for n in design['nets'] for k in n['nodes']}
    members={n['name']:{k.rsplit('.',1)[0] for k in n['nodes']} for n in design['nets']}
    nets=lambda r:{netof.get(r+'.'+p['number']) for p in comps[r]['pins']}-{None}
    isground=lambda n:bool(re.fullmatch(r'(?:[ASDP]?GND|GROUND|0)',n,re.I))
    assigned=set();result=[]
    def add(title,refs):
        selected=[r for r in comps if r in refs and r not in assigned]
        if selected:result.append({'id':'functional-'+str(len(result)+1),'title':title,'references':selected});assigned.update(selected)
    receivers=[r for r in comps if kind(r)=='infrared-receiver']
    drivers=[r for r,c in comps.items() if kind(r)=='logic-ic' and sum(p['type']=='output' for p in c['pins'])>=3]
    for r in receivers:
        active={netof.get(r+'.'+p['number']) for p in comps[r]['pins'] if p['name'].upper() not in ('GND','VSS','SGND')}-{None}
        adjacent=set().union(*(members[n] for n in active))
        owned={r}|{a for a in adjacent if kind(a) in ('resistor','capacitor','connector')}
        add('接口与接收',owned)
    for r in drivers:
        active=nets(r);owned={r}
        for a,c in comps.items():
            if a in assigned or len(c['pins'])!=2 or kind(a) not in ('resistor','capacitor'):continue
            local=nets(a)
            if len(local)==1:continue
            significant={n for n in local if not isground(n)}
            if significant&active:
                # Do not assign a shared supply capacitor to an arbitrary IC.
                owners=[h for h in drivers if significant&nets(h)]
                if len(owners)==1:owned.add(a)
        add('驱动与滤波',owned)
    links={r for r,c in comps.items() if len(c['pins'])==2 and len(nets(r))==1}
    add('零欧跨线',links)
    add('显示模块',{r for r in comps if kind(r)=='display'})
    leftovers={r for r in comps if r not in assigned and comps[r].get('objectRole')!='process'}
    if leftovers:add('其他电路',leftovers)
    add('工艺与装配说明',{r for r,c in comps.items() if c.get('objectRole')=='process'})
    return result
