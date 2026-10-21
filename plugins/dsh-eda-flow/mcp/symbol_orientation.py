"""Topology-derived orientation for standard two-terminal symbols."""
def defaults(design,resources):
    import native_resources as nr
    from design_audit import child,children
    netof={key:n['name'] for n in design['nets'] for key in n['nodes']}
    outputs={c['ref']+'.'+p['number'] for c in design['components'] if len(c['pins'])>2 for p in c['pins'] if p['type']=='output'}
    inputs={netof.get(c['ref']+'.'+p['number']) for c in design['components'] if len(c['pins'])>2 for p in c['pins'] if p['type']=='input'}
    ground={netof.get(c['ref']+'.'+p['number']) for c in design['components'] for p in c['pins'] if p['name'].upper() in ('GND','SGND','AGND','DGND','PGND','VSS')}
    result={}
    output_angles={}; power_angles={}
    for hub in design['components']:
        raw=nr.parse(resources['symbols'][hub['librarySymbol']]['native'])
        for unit in children(raw,'symbol'):
            for pin in children(unit,'pin'):
                key=hub['ref']+'.'+child(pin,'number')[1]
                if key in outputs:output_angles[key]=float(child(pin,'at')[3])
                if len(hub['pins'])>3 and pin[1]=='power_in' and netof.get(key) not in ground:
                    power_angles.setdefault(netof.get(key),set()).add(float(child(pin,'at')[3]))
    for c in design['components']:
        symbol=resources['symbols'][c['librarySymbol']]
        if symbol.get('drawingRules',{}).get('origin')!='kicad-library' or len(c['pins'])!=2:continue
        kind=symbol.get('appearance',{}).get('kind')
        raw=nr.parse(symbol['native'])
        angles={child(p,'number')[1]:float(child(p,'at')[3]) for unit in children(raw,'symbol') for p in children(unit,'pin')}
        if kind=='resistor':
            linked=[c['ref']+'.'+p['number'] for p in c['pins'] if any(c['ref']+'.'+p['number'] in n['nodes'] and outputs.intersection(n['nodes']) for n in design['nets'])]
            result[c['ref']]=90
            if len(linked)==1:
                peers=[key for key in outputs if netof.get(key)==netof.get(linked[0])]
                facing={output_angles[key] for key in peers if key in output_angles}
                if len(facing)==1:
                    result[c['ref']]=int((next(iter(facing))+180-angles[linked[0].rsplit('.',1)[1]])%360)
            # A resistor from an output signal to a declared supply is a pull-up,
            # not a series signal resistor: put its supply terminal above it.
            supply=[p['number'] for p in c['pins'] if netof.get(c['ref']+'.'+p['number']) in set(design.get('supplied_nets',[]))-ground]
            if len(linked)==1 and len(supply)==1 and linked[0].rsplit('.',1)[1]!=supply[0]:
                result[c['ref']]=int((270-angles[supply[0]])%360)
        elif kind=='capacitor':
            gp=[p['number'] for p in c['pins'] if netof.get(c['ref']+'.'+p['number']) in ground]
            if len(gp)==1:result[c['ref']]=int((90-angles[gp[0]])%360)
            sp=[p['number'] for p in c['pins'] if power_angles.get(netof.get(c['ref']+'.'+p['number']))=={0.0}]
            if len(gp)==1 and len(sp)==1:
                result[c['ref']]=int((-angles[sp[0]])%360)
    return result
