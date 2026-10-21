"""Frozen component-library instances, independent of page placement and routing."""
import collections,copy,csv,hashlib,json,math
from pathlib import Path
import xml.etree.ElementTree as ET

def load(root):
    p=Path(root)/'.fixed-components.json'
    if not p.exists():return None
    data=p.read_bytes()
    if hashlib.sha256(data).hexdigest()!=(Path(root)/'.fixed-components.sha256').read_text().strip():
        raise ValueError('Fixed library fingerprint mismatch')
    lib=json.loads(data)
    if lib.get('schema')!='fixed-component-constraints/2':raise ValueError('Unsupported fixed library')
    return lib

def symbol(c):
    graphics=[]
    for source in c['symbolConstraints']['graphics']:
        g={k:copy.deepcopy(v) for k,v in source.items() if k not in ['source','sourceText']}
        if g['kind']=='arc':
            cx,cy=g.pop('center');r=g.pop('radius');a=g.pop('startAngle');span=g.pop('sweepAngle')
            for key,angle in [('start',a),('mid',a+span/2),('end',a+span)]:
                g[key]=[round(cx+r*math.cos(math.radians(angle)),9),round(cy+r*math.sin(math.radians(angle)),9)]
        elif g['kind']=='text':
            g['at']=[*g['at'],g.pop('angle')]
            size=g.pop('fontMm');g['font']={'size':[size,size],'face':'SimSun','bold':g.pop('bold'),'justify':g.pop('align').split()}
        graphics.append(g)
    pins=[{'number':p['number'],'name':p['name'],'at':[*p['localAt'],p['angle']],'length':p['length'],'type':p['type'],
           'name_font':{'size':[p['nameFontMm']]*2},'number_font':{'size':[p['numberFontMm']]*2}} for p in c['pins']]
    return {'name':'Fixed_'+str(c['source']['schDocRecord']),'reference_prefix':'X','description':'Frozen original symbol '+c['ref'],
            'pins':pins,'graphics':graphics,'pin_names_visible':all(p['nameVisible'] for p in c['pins']),
            'pin_numbers_visible':all(p['numberVisible'] for p in c['pins']),'pin_name_offset':0.762}

def properties(c):
    props={f['name']:f['value'] for f in c['symbolConstraints']['fields']}
    props.update(Reference=c['ref'],Value=c['value'],OriginalFootprint=c['originalFootprint'],OriginalLibrary=c['originalLibrary'],
        SourceRecord=str(c['source']['schDocRecord']),ManufacturerOrderCode=c.get('manufacturerOrderCode') or '',
        MaterialCode=c.get('materialCode',''),MaterialDescription=c.get('materialDescription',''),AssemblyType=c.get('assemblyType',''),
        PreferredGrade=c.get('preferredGrade',''),Footprint='')
    return props

def place(c,spec):
    s=symbol(c);x,y,*angles=spec['at'];angle=angles[0] if angles else 0
    if angle not in [0,90,180,270]:raise ValueError('Fixed components permit only rigid 0/90/180/270 rotation')
    points=[]
    for p in s['pins']:points.append(p['at'][:2])
    for g in s['graphics']:
        points.extend(g.get('points',[]))
        points.extend(g[k][:2] for k in ['start','mid','end','at','center'] if k in g)
    a=math.radians(angle)
    world=[[x+px*math.cos(a)-py*math.sin(a),y-px*math.sin(a)-py*math.cos(a)] for px,py in points] or [[x,y]]
    left=min(p[0] for p in world);top=min(p[1] for p in world)
    source={f['name']:f for f in c['symbolConstraints']['fields']};overrides={f['name']:f for f in spec.get('fields',[])}
    known=properties(c)
    if set(overrides)-set(known):raise ValueError('Unknown fixed component field')
    props=[];visible=[n for n in known if source.get(n,{}).get('visible',False)]
    for name,val in known.items():
        f=source.get(name,{});show=f.get('visible',False);size=f.get('fontMm',1.27)
        pos=[left,top-2.54*(len(visible)-visible.index(name)),angle%180] if show else [x,y,0]
        if name in overrides:pos=overrides[name]['at'];pos=[*pos[:2],pos[2] if len(pos)>2 else angle%180]
        props.append({'name':name,'value':val,'at':pos,'visible':show,'font':{'size':[size,size],'face':'SimSun','justify':['left','bottom']}})
    return s,{'id':c['id'],'kind':'component','symbol':s['name'],'reference':c['ref'],'value':c['value'],'footprint':'',
        'at':[x,y,angle],'in_bom':c['in_bom'],'on_board':c['on_board'],'dnp':c['dnp'],'properties':props}

def catalogue(lib,refs=None):
    rows=lib['objects']
    if refs is not None:
        unknown=set(refs)-{c['ref'] for c in rows}
        if unknown:raise ValueError('Unknown fixed references: '+','.join(sorted(unknown)))
        rows=[c for c in rows if c['ref'] in refs]
    return {'sourceTextSha256':lib['sourceTextSha256'],'pageCoordinatesIncluded':False,'completeNetlistIncluded':False,
        'components':[{'reference':c['ref'],'value':c['value'],'originalFootprint':c['originalFootprint'],
          'materialCode':c.get('materialCode',''),'role':c['objectRole'],'pinCount':len(c['pins']),
          'graphicCount':len(c['symbolConstraints']['graphics']),**({'symbol':symbol(c),'properties':properties(c)} if refs is not None else {})} for c in rows]}

def check_frozen(state,lib,complete=False):
    errors=[];expected={c['ref']:c for c in lib['objects']};seen=[]
    for item in state['items'].values():
        if item['kind']!='component':continue
        ref=item['reference'];s=state['symbols'].get(item['symbol'],{});ps={p['name']:p['value'] for p in item.get('properties',[])}
        if ref not in expected:
            if not (ref.startswith(('#PWR','#ERC')) and ps.get('Role')=='ERCHelper' and not item.get('in_bom',True) and not item.get('on_board',True) and len(s.get('pins',[]))==1 and s['pins'][0]['type']=='power_out'):
                errors.append(ref+': foreign component is not an ERC helper; use reference #PWR/#ERC, property Role=ERCHelper, in_bom=false, on_board=false, and exactly one power_out pin. Add this declaration only to a genuinely supplied rail; never change original pins or exclude ERC.')
            continue
        seen.append(ref);c=expected[ref]
        if item['id']!=c['id'] or s!=symbol(c):errors.append(ref+': fixed symbol graphics / pin geometry / identity changed')
        if item.get('mirror') or item.get('at',[0,0,0])[-1] not in [0,90,180,270]:errors.append(ref+': unsupported fixed transform')
        if item.get('value')!=c['value'] or item.get('footprint','')!='':errors.append(ref+': fixed value / footprint assignment changed')
        for flag in ['in_bom','on_board','dnp']:
            if item.get(flag,flag!='dnp')!=c[flag]:errors.append(ref+': fixed '+flag+' changed')
        for name,value in properties(c).items():
            if ps.get(name)!=value:errors.append(ref+': fixed field '+name+' changed or missing')
        presentation={f['name']:f for f in c['symbolConstraints']['fields']}
        for p in item.get('properties',[]):
            should_show=presentation.get(p['name'],{}).get('visible',False)
            if p.get('visible',True)!=should_show:errors.append(ref+': fixed field visibility '+p['name']+' changed')
    if complete:
        for ref in sorted(set(expected)-set(seen)):errors.append('Missing fixed component '+ref)
        if len(seen)!=len(set(seen)):errors.append('Duplicate fixed components')
    return errors

def audit(project,state,lib,outputs):
    errors=check_frozen(state,lib,True);checks=[]
    def check(name,ok):
        checks.append({'name':name,'passed':bool(ok)})
        if not ok:errors.append(name)
    expected={c['ref']:c for c in lib['objects']}
    xml=ET.parse(outputs['netlist']['path']).getroot();xmlcomps={c.get('ref'):c for c in xml.findall('./components/comp')}
    nets={};members={}
    for net in xml.findall('./nets/net'):
        code=net.get('code');members[code]=[(n.get('ref'),n.get('pin')) for n in net.findall('node')]
        for node in members[code]:nets[node]=code
    for ref,c in expected.items():
        xc=xmlcomps.get(ref)
        # KiCad omits graphic-only process objects from its electrical XML netlist.
        if not c['pins']:continue
        check(ref+' actual netlist value',xc is not None and xc.findtext('value')==c['value'])
        if xc is None:continue
        fields={f.get('name'):f.text or '' for f in xc.findall('./fields/field')}
        for name in ['OriginalFootprint','OriginalLibrary','MaterialCode','MaterialDescription','ManufacturerOrderCode']:
            check(ref+' XML '+name,fields.get(name,'')==properties(c)[name])
    if 'bom' not in outputs:errors.append('Export BOM for complete fixed consistency check')
    else:
        with open(outputs['bom']['path'],encoding='utf8',newline='') as f:rows=list(csv.DictReader(f))
        included={r['Reference']:r for r in rows if r['InBOM'].lower()=='true'}
        check('All fixed objects in BOM',set(included)==set(expected))
        for ref,c in expected.items():
            row=included.get(ref,{})
            for name,value in [('Value',c['value']),('OriginalFootprint',c['originalFootprint']),('MaterialCode',c.get('materialCode','')),
                               ('MaterialDescription',c.get('materialDescription','')),('ManufacturerOrderCode',c.get('manufacturerOrderCode') or '')]:
                check(ref+' BOM '+name,row.get(name)==value)
        for name,subset in [('purchase-bom.csv',[r for r in rows if r['Reference'] in expected and expected[r['Reference']]['pins']]),
                            ('process-objects.csv',[r for r in rows if r['Reference'] in expected and not expected[r['Reference']]['pins']])]:
            with (Path(project)/name).open('w',encoding='utf-8-sig',newline='') as f:
                w=csv.DictWriter(f,fieldnames=rows[0].keys() if rows else []);w.writeheader();w.writerows(subset)
    policy=lib.get('functionalPolicy',{});parent={n:n for n in members}
    def find(n):
        if n is None:return None
        if parent[n]!=n:parent[n]=find(parent[n])
        return parent[n]
    def node(p):
        ref,pin=p.rsplit('.',1);return nets.get((ref,pin))
    def eq(a,b):return a is not None and b is not None and find(a)==find(b)
    def bridge(ref,a,b):
        x,y=node(ref+'.1'),node(ref+'.2')
        return not eq(a,b) and ((eq(x,a) and eq(y,b)) or (eq(x,b) and eq(y,a)))
    for ref in policy.get('zeroOhm',[]):
        a,b=node(ref+'.1'),node(ref+'.2')
        check(ref+' usable jumper path',a is not None and b is not None and a!=b and len(members.get(a,[]))>=2 and len(members.get(b,[]))>=2)
        if a is not None and b is not None:parent[find(a)]=find(b)
    for rule in policy.get('checks',[]):
        kind=rule['kind'];ns=[node(p) for p in rule.get('nodes',[])];ok=False
        if kind=='connected':ok=bool(ns) and all(eq(ns[0],n) for n in ns)
        elif kind=='isolated':ok=None not in ns and len({find(n) for n in ns})==len(ns)
        elif kind=='bridge':ok=bridge(rule['ref'],*ns)
        elif kind=='one-series':ok=sum(bridge(ref,*ns) for ref in rule['refs'])==1
        check(rule['name'],ok)
    nc=set(policy.get('nc',[]))
    for c in expected.values():
        for p in c['pins']:
            key=c['ref']+'.'+p['number'];n=node(key)
            check(key+(' NC' if key in nc else ' connected'),n is not None and (len(members[n])==1 if key in nc else len(members[n])>=2))
    return {'status':'passed' if not errors else 'failed','errors':errors,'checks':checks,'checkCount':len(checks),
        'fixedObjects':len(expected),'electricalComponents':sum(bool(c['pins']) for c in expected.values()),'pins':sum(len(c['pins']) for c in expected.values()),
        'symbolGraphics':sum(len(c['symbolConstraints']['graphics']) for c in expected.values()),'nets':len(members),
        'actualGeneratedNets':[{'name':net.get('name'),'nodes':[n.get('ref')+'.'+n.get('pin') for n in net.findall('node')]} for net in xml.findall('./nets/net')],
        'scope':'Frozen symbol geometry, pin geometry, original properties, actual XML/BOM and stated static functional roles. Physical PCB footprint geometry and approved purchasing MPNs remain unverified.'}

def audit_layout(project,state,pdf_path):
    try:import pymupdf
    except ImportError:return {'status':'unavailable','errors':['PDF text geometry check requires PyMuPDF'],'fieldCount':0}
    doc=pymupdf.open(stream=Path(pdf_path).read_bytes(),filetype='pdf');page=doc[0];chars=[]
    for t in page.get_texttrace():
        for c in t['chars']:chars.append((chr(c[0]),pymupdf.Rect(c[3])))
    full=''.join(c[0] for c in chars);fields=[];errors=[];targets=[]
    for i in state['items'].values():
        if i['kind']=='component':
            for p in i.get('properties',[]):
                if p.get('visible',True) and p['value']:targets.append((i['reference']+'.'+p['name'],p['value'],p['at']))
        elif i['kind'] in ['label','text']:targets.append((i['id'],i['text'],i['at']))
    field_count=len(targets)
    # Pin annotations and original symbol text are real PDF obstacles too.
    # A net label placed directly on a short pin may collide with its number.
    annotations=[];numbers=[]
    for i in state['items'].values():
        if i['kind']!='component':continue
        sym=state['symbols'][i['symbol']];x,y,*angles=i['at'];a=math.radians(angles[0] if angles else 0)
        def world(px,py):return [x+px*math.cos(a)-py*math.sin(a),y-px*math.sin(a)-py*math.cos(a)]
        for p in sym['pins']:
            px,py,*pa=p['at'];theta=math.radians(pa[0] if pa else 0);dx,dy=math.cos(theta),math.sin(theta)
            end=world(px+dx*(p['length']+sym.get('pin_name_offset',.508)),py+dy*(p['length']+sym.get('pin_name_offset',.508)))
            middle=world(px+dx*p['length']/2,py+dy*p['length']/2)
            if sym.get('pin_names_visible',True) and p['name'] not in ['', '~']:
                annotations.append((i['reference']+'.pin'+p['number']+'.name',p['name'],end))
            if sym.get('pin_numbers_visible',True):numbers.append((i['reference']+'.pin'+p['number']+'.number',p['number'],middle))
        for index,g in enumerate(sym.get('graphics',[])):
            if g['kind']=='text' and g.get('visible',True):annotations.append((i['reference']+'.graphicText'+str(index),g['text'],world(*g['at'][:2])))
    targets+=annotations+numbers
    used=set()
    for name,text,at in targets:
        candidates=[];start=0
        while True:
            pos=full.find(text,start)
            if pos<0:break
            b=pymupdf.Rect(chars[pos][1])
            for _,bb in chars[pos+1:pos+len(text)]:b|=bb
            if not any(j in used for j in range(pos,pos+len(text))):candidates.append((math.hypot((b.x0+b.x1)/2-at[0]*72/25.4,(b.y0+b.y1)/2-at[1]*72/25.4),pos,b))
            start=pos+1
        if not candidates:errors.append('PDF missing visible text '+name);continue
        distance,pos,b=min(candidates,key=lambda x:x[0]);used.update(range(pos,pos+len(text)))
        fields.append({'name':name,'text':text,'bbox':list(b)})
        if b.x0<0 or b.y0<0 or b.x1>page.rect.width or b.y1>page.rect.height:errors.append('Text outside page '+name)
    collisions=[]
    for index,a in enumerate(fields):
        for b in fields[index+1:]:
            ra,rb=pymupdf.Rect(a['bbox']),pymupdf.Rect(b['bbox']);cross=ra&rb
            if not cross.is_empty and cross.get_area()>.1*min(ra.get_area(),rb.get_area()):
                collisions.append([a['name'],b['name']]);errors.append('Text overlap '+a['name']+' / '+b['name'])
    # A connected netlist alone does not make a readable drawing: routes must
    # stay outside symbol bodies and parts need a visible physical lead.
    wires=[i for i in state['items'].values() if i['kind']=='wire']
    body_crossings=[];label_only=[];wire_text=[];body_text=[]
    def intersects(a,b,box):
        lo,hi=0.,1.
        for axis in [0,1]:
            delta=b[axis]-a[axis]
            if abs(delta)<1e-9:
                if not box[axis]<a[axis]<box[axis+2]:return False
            else:
                v0,v1=sorted([(box[axis]-a[axis])/delta,(box[axis+2]-a[axis])/delta])
                lo=max(lo,v0);hi=min(hi,v1)
                if lo>=hi:return False
        return hi>0 and lo<1
    def touches(p,a,b):
        dx,dy=b[0]-a[0],b[1]-a[1];length=math.hypot(dx,dy)
        if length<2.5399:return False
        return abs((p[0]-a[0])*dy-(p[1]-a[1])*dx)/length<.0002 and min(a[0],b[0])-.0002<=p[0]<=max(a[0],b[0])+.0002 and min(a[1],b[1])-.0002<=p[1]<=max(a[1],b[1])+.0002
    for field in fields[:field_count]:
        box=[v*25.4/72 for v in field['bbox']]
        box=[box[0]+.12,box[1]+.12,box[2]-.12,box[3]-.12]
        for w in wires:
            if any(intersects(a,b,box) for a,b in zip(w['points'],w['points'][1:])):
                wire_text.append([w['id'],field['name']]);errors.append('Wire crosses visible text '+w['id']+' / '+field['name'])
    library=load(project)
    all_fixed=library is not None and not check_frozen(state,library,complete=True)
    for i in state['items'].values():
        if i['kind']!='component':continue
        sym=state['symbols'][i['symbol']]
        if not sym['pins'] or i['reference'].startswith(('#PWR','#ERC')):continue
        x,y,*angles=i['at'];a=math.radians(angles[0] if angles else 0)
        def world(px,py):return [x+px*math.cos(a)-py*math.sin(a),y-px*math.sin(a)-py*math.cos(a)]
        points=[];graphic_boxes=[]
        for g in sym.get('graphics',[]):
            if g['kind']=='text':continue
            gp=list(g.get('points',[]))
            gp.extend(g[k] for k in ['start','mid','end'] if k in g)
            if g['kind']=='circle':
                cx,cy=g['center'];r=g['radius'];gp.extend([[cx-r,cy-r],[cx+r,cy+r]])
            points.extend(gp)
            if gp:
                wp=[world(*p[:2]) for p in gp];pad=max(.05,float(g.get('width') or .1524)/2)
                graphic_boxes.append([min(p[0] for p in wp)-pad,min(p[1] for p in wp)-pad,max(p[0] for p in wp)+pad,max(p[1] for p in wp)+pad])
        def clear_outward_lead(pa,pb):
            # Optical arrows can extend the aggregate envelope beyond a terminal.
            # Only exempt an actual terminal's outward lead, and only when it
            # misses every individual graphic's stroke-expanded envelope.
            for pin in sym['pins']:
                px,py,angle=pin['at'];terminal=world(px,py)
                other=pb if math.dist(pa,terminal)<.0002 else pa if math.dist(pb,terminal)<.0002 else None
                if other is None:continue
                theta=math.radians(angle);outside=world(px-math.cos(theta),py-math.sin(theta))
                vx,vy=outside[0]-terminal[0],outside[1]-terminal[1]
                dx,dy=other[0]-terminal[0],other[1]-terminal[1]
                if dx*vx+dy*vy<=.0002 or abs(dx*vy-dy*vx)>.0002:continue
                if not any(intersects(pa,pb,b) for b in graphic_boxes):return True
            return False
        if points:
            pts=[world(*p[:2]) for p in points]
            box=[min(p[0] for p in pts)+.05,min(p[1] for p in pts)+.05,max(p[0] for p in pts)-.05,max(p[1] for p in pts)-.05]
            if box[0]<box[2] and box[1]<box[3]:
                for field in fields[:field_count]:
                    fb=[v*25.4/72 for v in field['bbox']]
                    if min(fb[2],box[2])-max(fb[0],box[0])>.2 and min(fb[3],box[3])-max(fb[1],box[1])>.2:
                        body_text.append([i['reference'],field['name']]);errors.append('Visible field/label overlaps body '+i['reference']+' / '+field['name'])
                for w in wires:
                    if any(intersects(pa,pb,box) and not clear_outward_lead(pa,pb) for pa,pb in zip(w['points'],w['points'][1:])):
                        body_crossings.append({'wire':w['id'],'reference':i['reference'],'bodyBoundsMm':box})
                        errors.append('Wire '+w['id']+' crosses frozen body '+i['reference']+'; reroute outside '+str([round(v,3) for v in box]))
        if all_fixed and not any(touches(world(*p['at'][:2]),pa,pb) for p in sym['pins'] for w in wires for pa,pb in zip(w['points'],w['points'][1:])):
            label_only.append(i['reference']);errors.append('Visible wiring missing for '+i['reference']+': add a real lead of at least 2.54 mm; avoid a label-only component')
    doc.close()
    return {'status':'passed' if not errors else 'failed','errors':errors,'fieldCount':field_count,'textCount':len(fields),'collisions':collisions,'fields':fields,'wireBodyCrossings':body_crossings,'labelOnlyComponents':label_only,'wireTextCrossings':wire_text,'bodyTextOverlaps':body_text,
        'scope':'Actual PDF visible text plus wire/body bounding-box intrusion and visible lead coverage; whole-page visual review remains required.'}
