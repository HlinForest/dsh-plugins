"""Check the generated connector filters, including continuous straight leads."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'mcp'))
from generic_layout import io_path
from native_schematic import parse
from design_audit import child,children
import functional_layout as geom
ast,state=parse(io_path(sys.argv[1]));pins={}
for item in state['items'].values():
    if item.get('reference') in {'DISP','C5','C6','C7'}:
        for p in state['symbols'][item['symbol']]['pins']:
            pins[item['reference']+'.'+p['number']]=geom.world(item,p['at'])
assert len(pins)==12,pins
for n in ('1','2'):
    ys=[pins[r+'.'+n][1] for r in ('C5','C6','C7')]
    assert max(ys)-min(ys)<.001,'Filter capacitors must share a row'
segments=[]
for wire in children(ast,'wire'):
    pts=children(child(wire,'pts'),'xy')
    segments.append([list(map(float,p[1:])) for p in pts])
def covered(a,b):
    axis=0 if abs(a[1]-b[1])<.001 else 1
    other=1-axis;lo,hi=sorted([a[axis],b[axis]]);end=lo
    spans=sorted(sorted([p[axis],q[axis]]) for p,q in segments
                 if abs(p[other]-a[other])<.001 and abs(q[other]-a[other])<.001)
    for x,y in spans:
        if x<=end+.001:end=max(end,y)
    return end>=hi-.001
for connector,cap in [('4','C5'),('5','C6'),('6','C7')]:
    a=pins['DISP.'+connector]
    b=min((pins[cap+'.1'],pins[cap+'.2']),key=lambda p:p[1])
    elbow=[b[0],a[1]]
    assert covered(a,elbow) and covered(elbow,b),'Unnecessary detour in '+cap
print({'status':'passed','alignedCapacitors':3,'singleBendBranches':3})
