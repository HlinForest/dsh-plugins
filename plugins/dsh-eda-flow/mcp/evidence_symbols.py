"""Create schematic-only native symbols from explicit mock datasheet pin tables.

No historical CAD, circuit connections or page placement are read here.
"""
import json, re, hashlib, math

def visual_graphics(appearance):
    """Semantic appearance comes from the extraction record; geometry is host-owned."""
    result=[]
    vertical=10.16 if appearance.get('kind')=='segmented-display' and appearance.get('pinGroups') else 0
    def line(points,width=.20,filled=False):
        result.append('(polyline (pts '+''.join(f'(xy {x:.4f} {y+vertical:.4f})' for x,y in points)+f') (stroke (width {width}) (type default)) (fill (type {"outline" if filled else "none"})))')
    def text(value,x,y,size=.9):
        result.append(f'(text {json.dumps(value)} (at {x} {y+vertical} 0) (effects (font (size {size} {size}))))')
    def circle(x,y,r):
        result.append(f'(circle (center {x} {y+vertical}) (radius {r}) (stroke (width .20) (type default)) (fill (type none)))')
    def curve(x,y,r,start,end):
        line([(x+r*math.cos(math.radians(start+(end-start)*i/24)),y+r*math.sin(math.radians(start+(end-start)*i/24))) for i in range(25)])
    kind=appearance.get('kind')
    if kind=='segmented-display':
        digits=appearance.get('digits',[]);icons=appearance.get('icons',[])
        if len(digits)!=2 or {d['position'] for d in digits}!={'left','right'}:raise ValueError('Display requires two positioned digits')
        for d in digits:
            if set(d['segments'])!=set('abcdefg'):raise ValueError('Incomplete seven-segment evidence')
            x=-6.35 if d['position']=='left' else 6.35
            # Flat hexagonal segments, explicitly mapped a..g in front view.
            segments={'a':(-3,8,3,8),'g':(-3,3,3,3),'d':(-3,-2,3,-2),'f':(-3.5,7.5,-3.5,3.5),'e':(-3.5,2.5,-3.5,-1.5),'b':(3.5,7.5,3.5,3.5),'c':(3.5,2.5,3.5,-1.5)}
            for seg in d['segments']:
                x1,y1,x2,y2=segments[seg];dx=x2-x1;dy=y2-y1;length=math.hypot(dx,dy);ux=dx/length;uy=dy/length;w=.42;t=.5
                poly=[(x+x1,y1),(x+x1+ux*t-uy*w,y1+uy*t+ux*w),(x+x2-ux*t-uy*w,y2-uy*t+ux*w),(x+x2,y2),(x+x2-ux*t+uy*w,y2-uy*t-ux*w),(x+x1+ux*t+uy*w,y1+uy*t-ux*w),(x+x1,y1)]
                line(poly,.12)
            text(d['common'],x,10.5)
        if len(icons)!=4 or {i['kind'] for i in icons}!={'wifi','timer','power','sleep'}:raise ValueError('Incomplete display icon evidence')
        for i,icon in enumerate(icons):
            x=-11.43+i*7.62;y=-7
            if icon['kind']=='wifi':
                for r in [1,1.8,2.6]:curve(x,y-1.2,r,35,145)
                circle(x,y-1.2,.18)
            elif icon['kind']=='timer':
                circle(x,y,1.8);line([(x,y+1.3),(x,y),(x+1,y-.6)])
            elif icon['kind']=='power':
                curve(x,y,1.8,135,405);line([(x,y+.2),(x,y+2.3)])
            else:
                curve(x,y,1.8,65,295);curve(x+.9,y,1.55,95,265)
            text(icon['label'],x,y-3,.8);text(icon['common']+'/'+icon['segment'],x,y-4.5,.7)
        return ' '.join(result),15.24
    if kind=='infrared-receiver':
        circle(0,0,2.1);line([(-3.8,2.3),(-2.5,1),(-3.3,1.1)],.18);line([(-3.8,.7),(-2.5,-.6),(-3.3,-.5)],.18)
    return ' '.join(result),None

def build(ident, evidence, library_root=None):
    rows=[r for r in evidence if r.get('symbolId')==ident and r.get('sourceType') in ('mock-pdf-extraction','pdf-specification-appendix','model-specification-fact')]
    if len(rows)!=1:raise ValueError('Missing unique mock pin evidence: '+ident)
    row=rows[0];pins=row.get('pins',[])
    if not re.fullmatch(r'Evidence:[A-Za-z0-9_-]+',ident) or (not pins and row.get('objectRole')!='process') or len({p['number'] for p in pins})!=len(pins):raise ValueError('Invalid evidence symbol')
    types={'input','output','bidirectional','tri_state','passive','free','unspecified','power_in','power_out','open_collector','open_emitter','no_connect'}
    for p in pins:
        if p.get('type') not in types or not isinstance(p.get('number'),str) or not isinstance(p.get('name'),str):raise ValueError('Invalid evidence pin')
    if row.get('sourceType')=='model-specification-fact':
        from standard_symbols import generate
        native, drawing=generate(ident,row,library_root)
        source=json.dumps(row,ensure_ascii=False,sort_keys=True)
        return {'id':ident,'kind':'symbol','native':native,'pins':[{**p,'pad':p['number']} for p in pins],
                'sha256':hashlib.sha256(native.encode()).hexdigest(),'evidenceSha256':hashlib.sha256(source.encode()).hexdigest(),
                'provenance':{k:row[k] for k in ['id','document','page','pageIsPlaceholder','simulated','sourceType']},
                'footprint':'','appearance':{'kind':row['componentKind']},'drawingRules':drawing,
                'description':'Symbol generated from cited electrical facts; geometry owned by library/rules',
                'capability':'single-unit explicit pins; functional grid'}
    if row.get('appearance',{}).get('kind')=='stepped-two-digit-display' or row.get('appearance',{}).get('kind','').startswith('specified-'):
        if row['appearance']['kind']=='stepped-two-digit-display':from specification_display import generate
        else:from specification_profiles import generate
        native=generate(ident,row);source=json.dumps(row,ensure_ascii=False,sort_keys=True)
        return {'id':ident,'kind':'symbol','native':native,'pins':[{**p,'pad':p['number']} for p in pins],'sha256':hashlib.sha256(native.encode()).hexdigest(),'evidenceSha256':hashlib.sha256(source.encode()).hexdigest(),'provenance':{k:row[k] for k in ['id','document','page','pageIsPlaceholder','simulated','sourceType']},'footprint':'','appearance':row['appearance'],'description':'Stepped display built from dimensional mock specification; no physical footprint','capability':'single-unit explicit pins; dimension-driven body'}
    q=lambda s:json.dumps(s,ensure_ascii=False)
    name=ident.split(':')[1]
    left=[p for p in pins if p['type']!='output' and not p['name'].startswith('DG')]
    right=[p for p in pins if p not in left]
    appearance=row.get('appearance',{})
    if appearance.get('kind') not in ('segmented-display','infrared-receiver','logic-ic'):raise ValueError('Missing explicit appearance evidence')
    if appearance.get('kind')=='segmented-display':
        names={p['name'] for p in pins}
        for d in appearance.get('digits',[]):
            if d['common'] not in names or set(d['segments'])-names:raise ValueError('Display appearance references absent pin')
        for icon in appearance.get('icons',[]):
            if icon['common'] not in names or icon['segment'] not in names:raise ValueError('Icon mapping references absent pin')
    details,visualhalf=visual_graphics(appearance)
    groups=appearance.get('pinGroups')
    if groups:
        ordered=[n for side in ('left','right','top','bottom') for n in groups.get(side,[])]
        if len(ordered)!=len(set(ordered)) or set(ordered)!={p['name'] for p in pins}:raise ValueError('Functional pin groups must cover every pin once')
        byname={p['name']:p for p in pins};left=[byname[n] for n in groups['left']];right=[byname[n] for n in groups['right']]
    pitch=5.08 if groups else 2.54;height=max(len(left),len(right),2)*pitch+5.08;half=max(height/2,visualhalf or 0)
    graphics=f'(rectangle (start -15.24 {half}) (end 15.24 {-half}) (stroke (width 0.254) (type default)) (fill (type background)))'+details
    nativepins=[]
    def emit(p,x,y,angle):
        nativepins.append(f'(pin {p["type"]} line (at {x} {y} {angle}) (length 5.08) (name {q(p["name"])} (effects (font (size 1.27 1.27)))) (number {q(p["number"])} (effects (font (size 1.27 1.27)))))')
    for side,items in [(-1,left),(1,right)]:
        for i,p in enumerate(items):emit(p,side*20.32,(len(items)-1)*pitch/2-i*pitch,0 if side<0 else 180)
    if groups:
        for side,angle in [('top',270),('bottom',90)]:
            for i,n in enumerate(groups[side]):emit(byname[n],(i-(len(groups[side])-1)/2)*5.08,(half+5.08)*(1 if side=='top' else -1),angle)
    native=f'(symbol {q(ident)} (pin_names (offset 0.762)) (in_bom yes) (on_board yes) (property "Reference" "U" (at 0 {half+2.54} 0) (effects (font (size 1.27 1.27)))) (property "Value" {q(name)} (at 0 {-half-2.54} 0) (effects (font (size 1.27 1.27)))) (symbol {q(name+"_0_1")} {graphics}) (symbol {q(name+"_1_1")} {" ".join(nativepins)}))'
    source=json.dumps(row,ensure_ascii=False,sort_keys=True)
    return {'id':ident,'kind':'symbol','native':native,'pins':[{**p,'pad':p['number']} for p in pins],'sha256':hashlib.sha256(native.encode()).hexdigest(),'evidenceSha256':hashlib.sha256(source.encode()).hexdigest(),'provenance':{k:row[k] for k in ['id','document','page','pageIsPlaceholder','simulated','sourceType']},'footprint':'','appearance':appearance,'description':'Schematic symbol built from simulated datasheet pins and appearance; no physical footprint','capability':'single-unit explicit pins; deterministic host-generated graphics'}
