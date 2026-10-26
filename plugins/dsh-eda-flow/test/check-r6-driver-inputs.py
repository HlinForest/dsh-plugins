"""Read actual CAD: input shunts belong beside U1 and connect to its input rows."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'mcp'))
from generic_layout import io_path
from native_schematic import parse
from design_audit import child,children
import functional_layout as geom
ast,state=parse(io_path(sys.argv[1]));pins={}
for item in state['items'].values():
    if item.get('reference'):
        for p in state['symbols'][item['symbol']]['pins']:
            pins[item['reference']+'.'+p['number']]=geom.world(item,p['at'])
physical,_=geom.physical_graph(state)
columns=sorted(pins[r+'.2'][0] for r in ('C5','C6','C7'))
assert max(b-a for a,b in zip(columns,columns[1:]))<=10.16+.001,'Input capacitor columns spread too far'
for cap,hp in [('C7','U1.1'),('C6','U1.2'),('C5','U1.3')]:
    a,b=pins[cap+'.2'],pins[hp]
    assert a[0]<b[0] and a[1]>b[1],(cap,'Must branch down on driver left')
    assert physical[cap+'.2']==physical[hp],(cap,'Missing real input wire')
    spans=[]
    for w in children(ast,'wire'):
        p,q=[list(map(float,p[1:])) for p in children(child(w,'pts'),'xy')]
        if abs(p[1]-b[1])<.001 and abs(q[1]-b[1])<.001:spans.append(sorted([p[0],q[0]]))
    end=a[0]
    for lo,hi in sorted(spans):
        if lo<=end+.001:end=max(end,hi)
    assert end>=b[0]-.001,(cap,'Input wire detours')
    assert abs(a[1]-b[1])<35,(cap,'Filter too far from driver')
    name={'C7':'DIN','C6':'CLK','C5':'STB'}[cap]
    assert any(l[1]==name and float(child(l,'at')[1])<min(columns) and abs(float(child(l,'at')[2])-b[1])<.001 for l in children(ast,'label')),'Input label must lead the straight horizontal row'
assert len({physical[k] for k in ['C5.1','C6.1','C7.1']})==1
assert physical['C5.1']!=physical['U1.14'],'Filter ground must use SGND, not a wire around the driver'
labels=[l for l in children(ast,'label') if l[1]=='SGND']
for pin in ['C5.1','U1.14']:
    assert any(any(geom.on(list(map(float,child(l,'at')[1:3])),a,b) and
                       any(geom.on(pins[k],a,b) for k in pins if physical.get(k)==physical[pin])
                       for a,b in geom.physical_graph(state)[1]) for l in labels),'Missing attached SGND label'
print({'status':'passed','driverInputShunts':3,'straightInputRows':3,'separateNamedGroundRails':True})
