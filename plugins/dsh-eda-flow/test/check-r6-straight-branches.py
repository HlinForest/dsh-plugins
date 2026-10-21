import json,sys
from pathlib import Path
root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root/'mcp'))
from native_schematic import parse
from design_audit import child,children
import functional_layout as geom
p=Path(sys.argv[1]);ast,s=parse(p)
pins={}
for item in s['items'].values():
 if item.get('reference'):
  for pin in s['symbols'][item['symbol']]['pins']:pins[item['reference']+'.'+pin['number']]=geom.world(item,pin['at'])
pairs=[('U1.5','R2.2'),('U1.6','R4.2'),('U1.7','R6.2'),('U1.8','R8.2'),('U1.9','R9.1'),('U1.10','R7.1'),('U1.11','R5.1')]
errors=[f'{a} -> {b}: vertical offset {abs(pins[a][1]-pins[b][1]):.3f} mm' for a,b in pairs if abs(pins[a][1]-pins[b][1])>.001]
for a,b in pairs:
 lo,hi=sorted([pins[a][0],pins[b][0]]);y=pins[a][1];covered=lo
 spans=[]
 for wire in children(ast,'wire'):
  pts=children(child(wire,'pts'),'xy');x1,y1=map(float,pts[0][1:]);x2,y2=map(float,pts[1][1:])
  if abs(y1-y)<.001 and abs(y2-y)<.001:spans.append(sorted([x1,x2]))
 for x1,x2 in sorted(spans):
  if x1<=covered+.001:covered=max(covered,x2)
 if covered<hi-.001:errors.append(f'{a} -> {b}: missing continuous horizontal wire')
print(json.dumps({'status':'failed' if errors else 'passed','alignedBranches':7-len(errors),'errors':errors},indent=2))
sys.exit(bool(errors))
