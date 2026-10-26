"""Actual receiver/interface wires must retain direct output and separate rails."""
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
a,b=pins['D1.1'],pins['DISP.1']
assert abs(a[1]-b[1])<.001,'Receiver output and interface are not aligned'
end=min(a[0],b[0]);hi=max(a[0],b[0]);spans=[]
for w in children(ast,'wire'):
    p,q=[list(map(float,p[1:])) for p in children(child(w,'pts'),'xy')]
    if abs(p[1]-a[1])<.001 and abs(q[1]-a[1])<.001:spans.append(sorted([p[0],q[0]]))
for lo,right in sorted(spans):
    if lo<=end+.001:end=max(end,right)
assert end>=hi-.001,'Receiver output has unnecessary detours'
physical,_=geom.physical_graph(state)
rails=[('D1.1','DISP.1','R3.1'),('D1.2','DISP.2','C2.1','C3.1'),('R1.2','R3.2','DISP.3')]
for members in rails:assert len({physical.get(k,k) for k in members})==1,'Missing receiver/interface wire: '+str(members)
assert len({physical[k[0]] for k in rails})==3,'Receiver/interface rails shorted'
for n in ('1','2'):
    rows=[pins[r+'.'+n][1] for r in ('C5','C6','C7')]
    assert max(rows)-min(rows)<.001,'Input capacitors not aligned'
assert len({physical['C5.1'],physical['C6.1'],physical['C7.1']})==1,'Missing filter ground rail'
print({'status':'passed','directReceiverOutput':True,'separatePhysicalRails':3,'alignedFilterCaps':3})
