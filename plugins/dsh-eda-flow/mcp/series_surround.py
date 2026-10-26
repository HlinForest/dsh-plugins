"""Compose a generated, pin-aligned bank with surrounding discrete parts.
Only current semantic symbols and current design connectivity enter this module.
"""
import copy

def surround(bank, all_refs, specs, pinmap, edges, gap, run):
    internal={c['id']:c for c in bank['children']}
    owner=lambda pin:pin.rsplit('.',1)[0]
    boundary=[e for e in edges if not all(owner(k) in internal for k in e['sources']+e['targets'])]
    needed={k for e in boundary for k in e['sources']+e['targets'] if owner(k) in internal}
    ports=[];tails=[]
    for key in sorted(needed):
        ref=owner(key);p=pinmap[key];c=internal[ref];low=specs[ref]['_low']
        x=c['x']-low[0]+p['pos'][0];y=c['y']-low[1]+p['pos'][1]
        dx,dy=p['direction'];px=0 if dx<0 else bank['width'] if dx>0 else x;py=0 if dy<0 else bank['height'] if dy>0 else y
        side='WEST' if dx<0 else 'EAST' if dx>0 else 'NORTH' if dy<0 else 'SOUTH'
        ports.append({'id':key,'x':px,'y':py,'width':0,'height':0,'layoutOptions':{'elk.port.side':side}})
        tails.append({'sections':[{'startPoint':{'x':x,'y':y},'endPoint':{'x':px,'y':py}}]})
    macro={'id':'@aligned:'+bank['id'],'width':bank['width'],'height':bank['height'],'ports':ports,'layoutOptions':{'elk.portConstraints':'FIXED_POS'}}
    graph={'id':bank['id'],'children':[macro,*[{k:v for k,v in specs[r].items() if not k.startswith('_')} for r in all_refs if r not in internal]],'edges':boundary,'layoutOptions':{
        'elk.algorithm':'layered','elk.direction':'RIGHT','elk.edgeRouting':'ORTHOGONAL','elk.padding':'[top=10,left=5,bottom=5,right=5]',
        'elk.spacing.nodeNode':str(gap),'elk.layered.spacing.nodeNodeBetweenLayers':str(max(gap,7.62)),
        'elk.spacing.componentComponent':str(gap),'elk.spacing.edgeNode':'2.54','elk.spacing.edgeEdge':'2.54',
        'elk.layered.spacing.edgeNodeBetweenLayers':'2.54','elk.layered.spacing.edgeEdgeBetweenLayers':'2.54'}}
    placed=run(graph)
    macro_position=next(c for c in placed['children'] if c['id']==macro['id']);x,y=macro_position['x'],macro_position['y']
    placed['children']=[c for c in placed['children'] if c['id']!=macro['id']]+[{**c,'x':c['x']+x,'y':c['y']+y} for c in bank['children']]
    for edge in copy.deepcopy(bank['edges']+tails):
        for section in edge.get('sections',[]):
            for p in [section['startPoint'],*section.get('bendPoints',[]),section['endPoint']]:p['x']+=x;p['y']+=y
        placed.setdefault('edges',[]).append(edge)
    return placed
