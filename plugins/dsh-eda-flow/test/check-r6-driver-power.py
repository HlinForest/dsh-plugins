"""Check actual driver decoupling orientation, compactness and physical rails."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'mcp'))
from generic_layout import io_path
from native_schematic import parse
import functional_layout as geom
_,state=parse(io_path(sys.argv[1]));pins={}
for item in state['items'].values():
    if item.get('reference') in {'U1','C1','C4','C8'}:
        for pin in state['symbols'][item['symbol']]['pins']:
            pins[item['reference']+'.'+pin['number']]=geom.world(item,pin['at'])
assert len(pins)==22,pins
rows=[]
for ref in ('C1','C4','C8'):
    a,b=pins[ref+'.1'],pins[ref+'.2']
    assert abs(a[1]-b[1])<.001,'Decoupling capacitor is not horizontal: '+ref
    rows.append(a[1])
assert max(rows)<min(v[1] for k,v in pins.items() if k.startswith('U1.')),'Decoupling must remain above driver'
assert max(rows)-min(rows)<=20.32,'Excessive decoupling row spacing'
physical,_=geom.physical_graph(state)
for members in [('U1.4','C1.1','C4.2','C8.2'),('U1.14','C1.2','C4.1','C8.1')]:
    assert len({physical.get(k,k) for k in members})==1,'Missing actual supply rail: '+str(members)
print({'status':'passed','parallelCapacitors':3,'physicalPowerRails':2})
