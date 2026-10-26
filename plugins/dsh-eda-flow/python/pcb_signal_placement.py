"""Derive local filter placement from reviewed roles and actual native nets."""

def signal_filter_relations(components,expected,process):
    returns={n['name'] for n in process.get('copperNets',[]) if n.get('kind')=='return'}
    result={}
    for component in components:
        if component.get('electricalRole')!='interface-filter':continue
        ref=component['ref'];members={pin:net for (owner,pin),net in expected.items() if owner==ref}
        if len(members)!=2:continue
        ground=[pin for pin,net in members.items() if net in returns]
        if len(ground)!=1:continue
        return_pin=ground[0];signal_pin=next(pin for pin in members if pin!=return_pin)
        targets=[]
        for owner in components:
            if owner['ref']==ref:continue
            inputs=[str(p.get('pad',p['number'])) for p in owner.get('pins',[]) if p.get('type')=='input' and expected.get((owner['ref'],str(p.get('pad',p['number']))))==members[signal_pin]]
            grounds=[str(p.get('pad',p['number'])) for p in owner.get('pins',[]) if p.get('type')=='power_in' and expected.get((owner['ref'],str(p.get('pad',p['number']))))==members[return_pin]]
            targets.extend((owner['ref'],pin,ground) for pin in inputs for ground in grounds)
        if len(targets)!=1:continue
        owner,pin,ground=targets[0]
        result[ref]={'ref':ref,'kind':'signal-filter','anchor':{'ref':owner,'pad':pin},'return':{'ref':owner,'pad':ground},
                     'supplyPad':signal_pin,'returnPad':return_pin,'supplyNet':members[signal_pin],'returnNet':members[return_pin],
                     'basis':'reviewed interface-filter role, unique input receiver and actual return net; placement preference only'}
    return result
