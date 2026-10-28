"""Offline original-evidence check for the forty non-display symbol profiles.
Display geometry has a separate dedicated comparison. Never imported at runtime.
"""
import json,sys,math
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'mcp'))
import native_resources as nr
from design_audit import child,children
from native_schematic import graphic
source=json.loads(Path(sys.argv[1]).read_text(encoding='utf8'))
resources=json.loads(Path(sys.argv[2]).read_text(encoding='utf8'))
errors=[];count=0
def close(a,b):return len(a)==len(b) and all(abs(x-y)<.0001 for x,y in zip(a,b))
for c in source['objects']:
    if c['ref']=='*':continue
    count+=1;ident='Evidence:R6_'+c['id'].replace('-','_');ast=nr.parse(resources['symbols'][ident]['native'])
    actual=[graphic(g) for u in children(ast,'symbol') for g in u[2:] if isinstance(g,list) and g[0] in ['rectangle','polyline','text']]
    expected=c['symbolConstraints']['graphics']
    pins={child(p,'number')[1]:p for u in children(ast,'symbol') for p in children(u,'pin')}
    if c['pins']:
        p=c['pins'][0];at=list(map(float,child(pins[p['number']],'at')[1:3]));offset=[a-b for a,b in zip(at,p['localAt'])]
    else:
        body=next(g for g in expected if g['kind'] in ('rectangle','rounded_rectangle'))
        offset=[-min(body['start'][i],body['end'][i]) for i in range(2)]
    translate=lambda pt:[pt[i]+offset[i] for i in range(2)]
    if len(actual)!=len(expected):errors.append(c['ref']+': graphic count');continue
    for i,(old,new) in enumerate(zip(expected,actual)):
        label=c['ref']+': graphic '+str(i);kind=old['kind'];ok=True
        if kind=='text':
            ok=new['kind']=='text' and old['text']==new['text'] and close(translate(old['at']),new['at'][:2]) and close([old['fontMm']]*2,new['font']['size'])
        elif kind=='polyline':
            points=[translate(p) for p in old['points']];observed=new.get('points',[])
            ok=len(points)==len(observed) and (all(close(a,b) for a,b in zip(points,observed)) or all(close(a,b) for a,b in zip(points,reversed(observed))))
        elif kind=='rectangle':
            ok=new['kind']=='rectangle' and close(translate(old['start']),new['start']) and close(translate(old['end']),new['end'])
        elif kind=='rounded_rectangle':
            # Check native polygon extents and each chord endpoint against the
            # original ellipse/straight-edge boundary, independently of mock rows.
            x0,y0=translate(old['start']);x1,y1=translate(old['end']);rx,ry=old['rx'],old['ry'];points=new.get('points',[])
            ok=len(points)>100 and close(points[0],points[-1])
            if points:
                ok=ok and close([min(p[0] for p in points),min(p[1] for p in points),max(p[0] for p in points),max(p[1] for p in points)],[x0,y0,x1,y1])
                for x,y in points:
                    cx=min(max(x,x0+rx),x1-rx);cy=min(max(y,y0+ry),y1-ry)
                    if abs(((x-cx)/rx)**2+((y-cy)/ry)**2-1)>.001:ok=False
        else:ok=False
        if kind!='text':ok=ok and abs(old['width']-new['width'])<.0001 and old['fill']==new['fill']
        if not ok:errors.append(label)
result={'status':'failed' if errors else 'passed','errors':errors,'symbolsCompared':count,'scope':'Non-display profile shapes, text and dimensions versus independent original constraints; rounded shapes checked within numerical chord tolerance. Display checked separately.'}
Path(sys.argv[3]).write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8');print(json.dumps(result));sys.exit(bool(errors))
