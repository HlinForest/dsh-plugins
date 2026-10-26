"""R6 receiver must keep parallel filter capacitors aligned and the circuit compact."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'mcp'))
from generic_layout import io_path
from native_schematic import parse
import functional_layout as geom
_,state=parse(io_path(sys.argv[1]));pins={}
refs={'D1','R1','R3','C2','C3'}
for item in state['items'].values():
 if item.get('reference') in refs:
  for p in state['symbols'][item['symbol']]['pins']:pins[item['reference']+'.'+p['number']]=geom.world(item,p['at'])
assert len(pins)==11,pins
for number in ('1','2'):assert abs(pins['C2.'+number][1]-pins['C3.'+number][1])<.001,'Parallel filter capacitors misaligned'
height=max(p[1] for p in pins.values())-min(p[1] for p in pins.values())
assert height<=40,'Receiver circuit contains unnecessarily tall detours: '+str(height)
print({'status':'passed','receiverPinSpanMm':round(height,3)})
