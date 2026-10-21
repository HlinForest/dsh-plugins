"""Offline comparison of all pin geometry and the display body against R6 evidence."""
import sys,json,math
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'mcp'))
from native_resources import parse
from native_schematic import graphic
from design_audit import child,children
source=json.loads(Path(sys.argv[1]).read_text(encoding='utf8'))
resources=json.loads(Path(sys.argv[2]).read_text(encoding='utf8'));errors=[];pin_count=0
close=lambda a,b:len(a)==len(b) and all(abs(x-y)<.0001 for x,y in zip(a,b))
for c in source['objects']:
 ident='Evidence:R6_Display' if c['ref']=='*' else 'Evidence:R6_'+c['id'].replace('-','_')
 ast=parse(resources['symbols'][ident]['native']);pins={child(p,'number')[1]:p for u in children(ast,'symbol') for p in children(u,'pin')}
 if set(pins)!={p['number'] for p in c['pins']}:errors.append(c['ref']+': pin set differs');continue
 if not c['pins']:continue
 first=c['pins'][0];offset=[a-b for a,b in zip(map(float,child(pins[first['number']],'at')[1:3]),first['localAt'])]
 trans=lambda p:[p[i]+offset[i] for i in (0,1)]
 for p in c['pins']:
  actual=pins[p['number']];at=list(map(float,child(actual,'at')[1:]));pin_count+=1
  expected=trans(p['localAt'])
  if c['ref']=='*':expected[0]=round(round(expected[0]/1.27)*1.27,4)
  if not close(expected,at[:2]) or abs((at[2]-p['angle'])%360)>.0001 or abs(float(child(actual,'length')[1])-p['length'])>.0001 or child(actual,'name')[1]!=p['name'] or str(actual[1])!=p['type']:errors.append(c['ref']+'.'+p['number']+': pin geometry or identity differs')
 if c['ref']!='*':continue
 actual=[graphic(g) for u in children(ast,'symbol') for g in u[2:] if isinstance(g,list) and g[0] in ('rectangle','polyline','arc')]
 if len(actual)!=8:errors.append('Display: expected 2 rectangles, 2 eights and 4 arcs')
 for old in c['symbolConstraints']['graphics']:
  def matches(new):
   if new['kind']!=old['kind'] or abs(old['width']-new['width'])>.0001 or old['fill']!=new['fill']:return False
   if old['kind']=='rectangle':return close(trans(old['start']),new['start']) and close(trans(old['end']),new['end'])
   if old['kind']=='polyline':return len(old['points'])==len(new['points']) and all(close(trans(a),b) for a,b in zip(old['points'],new['points']))
   if old['kind']=='arc':
    center=trans(old['center']);angles=[old['startAngle'],old['startAngle']+old['sweepAngle']/2,old['startAngle']+old['sweepAngle']]
    points=[[center[0]+old['radius']*math.cos(math.radians(t)),center[1]+old['radius']*math.sin(math.radians(t))] for t in angles]
    return all(close(p,new[key]) for p,key in zip(points,('start','mid','end')))
   return False
  hit=next((i for i,g in enumerate(actual) if matches(g)),None)
  if hit is None:errors.append('Display: unmatched '+old['kind'])
  else:actual.pop(hit)
result={'status':'failed' if errors else 'passed','errors':errors,'pinsCompared':pin_count,'displayGeometry':'2 rectangles / 2 continuous eights / 4 near-full arcs; independent original dimensions','connectionGridAdaptation':'Display pin 9 and pin 5 x offsets shift -0.508 mm to 1.27 mm connection grid; identities, lengths, directions and body unchanged','scope':'No old CAD used at runtime; offline comparison only. Pin-text orientation is intentionally external horizontal text.'}
Path(sys.argv[3]).write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8');print(json.dumps(result));sys.exit(bool(errors))
