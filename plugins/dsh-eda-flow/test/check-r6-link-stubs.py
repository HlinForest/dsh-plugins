import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'mcp'))
from native_schematic import parse
from design_audit import child,children
import functional_layout as geom
ast,state=parse(Path(sys.argv[1]));wires=[]
for wire in children(ast,'wire'):
 pts=children(child(wire,'pts'),'xy');wires.append([tuple(map(float,p[1:])) for p in pts])
errors=[]
for item in state['items'].values():
 ref=item.get('reference','')
 if not ref.startswith('RJ'):continue
 for pin in state['symbols'][item['symbol']]['pins']:
  pos=tuple(geom.world(item,pin['at']));seen={pos};pending=[pos]
  while pending:
   current=pending.pop()
   for a,b in wires:
    if geom.on(current,a,b):
     for endpoint in (a,b):
      if endpoint not in seen:seen.add(endpoint);pending.append(endpoint)
  if any(abs(p[1]-pos[1])>.001 or abs(p[0]-pos[0])>3.811 for p in seen):errors.append(ref+'.'+pin['number']+': same-net stub became inter-component route')
print({'status':'failed' if errors else 'passed','errors':errors});sys.exit(bool(errors))
