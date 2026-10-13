"""Rebuild this confirmed, single-page SchDoc from its native records.

No data from revoked PCB or earlier reconstruction is used. Native units/pin
flags follow KiCad's documented Altium importer. Outputs are derived, not an
Altium compile or proof of manufacturing readiness.
"""
from pathlib import Path
import sys, json, struct, hashlib, uuid, math, collections, csv, shutil
sys.path.insert(0, str(Path(__file__).resolve().parents[3] / 'python/vendor'))
import olefile

SOURCE=Path(sys.argv[1]); OUT=Path(sys.argv[2]); OUT.mkdir(parents=True,exist_ok=True)
EXPECTED='bd063b92a9a3dd99c2b28ec22438179d58d35468e11352cf11e9310e48ace99e'
assert hashlib.sha256(SOURCE.read_bytes()).hexdigest()==EXPECTED, 'R6 source mismatch'
NS = uuid.UUID('8115d36d-a3c0-4e8a-93ee-581ad52eaef7')
def uid(s): return str(uuid.uuid5(NS, str(s)))
def dump(name, obj):
    p = OUT / name; p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(obj, ensure_ascii=False, indent=2), encoding='utf-8')
def q(s): return json.dumps(str(s), ensure_ascii=False)
def n(v): return ('%.6f' % v).rstrip('0').rstrip('.') or '0'
def num(r, k, default=0): return float(r.get(k, default))
def integer(r, k, default=0): return int(r.get(k, default))
def txt(r, k='Text'): return r.get('%UTF8%'+k, r.get(k, ''))
def rawnum(r,k): return num(r,k)+num(r,k+'_Frac')/100000
def point(r, prefix='Location'): return (rawnum(r,prefix+'.X'),rawnum(r,prefix+'.Y'))
def xy(p): return ' '.join(n(x) for x in p)
SCALE = .254
# A4 landscape is the native default; CustomX/Y are inactive without UseCustomSheet.
PAGE_H = 209.55  # 165 native 50-mil grid steps; uniform -0.45 mm page translation.
def sheet(p): return (round(p[0]*SCALE,6),round(PAGE_H-p[1]*SCALE,6))
def local(p, origin): return ((p[0]-origin[0])*SCALE,(p[1]-origin[1])*SCALE)

ole = olefile.OleFileIO(SOURCE)
data = ole.openstream('FileHeader').read()
records = []; pos = 0
while pos < len(data):
    length = struct.unpack_from('<I', data,pos)[0]
    assert not length >> 24, 'Unexpected binary record'
    payload = data[pos+4:pos+4+length].rstrip(b'\0')
    fields = {}
    for chunk in payload.split(b'|'):
        if b'=' not in chunk: continue
        key, value = chunk.split(b'=',1)
        key = key.decode('ascii')
        # Legacy code-page fallbacks remain in raw native binary; UTF8 duplicates take precedence.
        fields[key] = value.decode('utf-8' if key.startswith('%UTF8%') else 'gb18030', errors='replace')
    records.append(dict(index=len(records),offset=pos,fields=fields))
    pos += 4+length
assert pos == len(data) and len(records) == 1054
R = [r['fields'] for r in records]
dump('checks/native_records.json', records)
children = collections.defaultdict(list)
for i,r in enumerate(R):
    if 'OwnerIndex' in r: children[integer(r,'OwnerIndex')+1].append(i)
sheet_settings = next(r for r in R if r.get('RECORD')=='31')
assert 'UseCustomSheet' not in sheet_settings and 'SheetStyle' not in sheet_settings
fonts = {i:dict(size=num(sheet_settings,'Size'+str(i))*.127,
                bold=sheet_settings.get('Bold'+str(i))=='T') for i in range(1,9)}
def effects(size=1.27, hidden=False, justify='', bold=False):
    return f'(effects (font (face "SimSun") (size {n(size)} {n(size)})'+(' (bold yes)' if bold else '')+')'+(f' (justify {justify})' if justify else '')+(' (hide yes)' if hidden else '')+')'
def prop(name,value,at=(0,0),angle=0,hidden=True,size=1.27,justify=''):
    return f'(property {q(name)} {q(value)} (at {xy(at)} {angle}) {effects(size,hidden,justify)})'
def stroke(r): return f'(stroke (width {n([.1524,.1524,.254,.4572][min(integer(r,"LineWidth"),3)])}) (type default))'
def fill(r): return '(fill (type '+('background' if r.get('IsSolid')=='T' else 'none')+'))'

def draw(r,origin):
    typ=r.get('RECORD'); trans=lambda p: local(p,origin)
    a=trans(point(r)); b=trans(point(r,'Corner'))
    if typ=='13': return f'(polyline (pts (xy {xy(a)}) (xy {xy(b)})) {stroke(r)} (fill (type none)))'
    if typ in ('6','7'):
        ps=[trans((rawnum(r,'X'+str(i)),rawnum(r,'Y'+str(i)))) for i in range(1,integer(r,'LocationCount')+1)]
        if typ=='7' and ps[-1]!=ps[0]:ps.append(ps[0])
        return '(polyline (pts '+' '.join('(xy '+xy(p)+')' for p in ps)+f') {stroke(r)} {fill(r)})'
    if typ=='14': return f'(rectangle (start {xy(a)}) (end {xy(b)}) {stroke(r)} {fill(r)})'
    if typ=='10':
        # Preserve the native rounded rectangle boundary with a sampled ellipse-corner polygon.
        x0,x1=sorted((a[0],b[0])); y0,y1=sorted((a[1],b[1]))
        rx=min(num(r,'CornerXRadius')*SCALE,(x1-x0)/2);ry=min(num(r,'CornerYRadius')*SCALE,(y1-y0)/2)
        ps=[]
        for cx,cy,start in ((x1-rx,y1-ry,0),(x0+rx,y1-ry,90),(x0+rx,y0+ry,180),(x1-rx,y0+ry,270)):
            for k in range(13):
                t=math.radians(start+k*90/12);ps.append((cx+rx*math.cos(t),cy+ry*math.sin(t)))
        ps.append(ps[0])
        return '(polyline (pts '+' '.join('(xy '+xy(p)+')' for p in ps)+f') {stroke(r)} {fill(r)})'
    if typ=='12':
        rad=rawnum(r,'Radius')*SCALE; start=num(r,'StartAngle'); end=num(r,'EndAngle',360); span=(end-start)%360
        if not span or span>359.999:return f'(circle (center {xy(a)}) (radius {n(rad)}) {stroke(r)} (fill (type none)))'
        ps=[(a[0]+rad*math.cos(math.radians(t)),a[1]+rad*math.sin(math.radians(t))) for t in (start,start+span/2,start+span)]
        return f'(arc (start {xy(ps[0])}) (mid {xy(ps[1])}) (end {xy(ps[2])}) {stroke(r)} (fill (type none)))'
    if typ=='4':
        ft=fonts[integer(r,'FontID',1)];angle=integer(r,'Orientation')*90
        return f'(text {q(txt(r))} (at {xy(a)} {angle}) {effects(ft["size"],False,"left bottom",ft["bold"])})'
    raise ValueError(typ)

components=[]; pins=[]; definitions=[]; instances=[]
ROOT=uid('root'); NAME='MD50PG_R5_SourceRestored'
for i,r in enumerate(R):
    if r.get('RECORD')!='1': continue
    owned=[(j,R[j]) for j in children[i]]
    refrecord=next(p for _,p in owned if p.get('RECORD')=='34')
    ref=txt(refrecord); origin=point(r); params=[p for _,p in owned if p.get('RECORD')=='41']
    paramsdict={txt(p,'Name'):txt(p) for p in params}
    value=paramsdict.get('Comment','')
    impl=[]
    for j,p in owned:
        if p.get('RECORD')=='44':impl.extend(R[k] for k in children[j] if R[k].get('RECORD')=='45')
    active=[p for p in impl if p.get('IsCurrent')=='T'];assert len(active)==1,(ref,active)
    footprint=active[0]['ModelName']
    pinrecs=[(j,p) for j,p in owned if p.get('RECORD')=='2']
    assert len(pinrecs)==integer(r,'AllPinCount',len(pinrecs))
    key='C'+str(i)+'_'+r['LibReference'].replace('/','_').replace(':','_')
    libid='MD50PG_Native:'+key
    all_name_flags={bool(integer(p,'PinConglomerate')&8) for _,p in pinrecs}
    all_num_flags={bool(integer(p,'PinConglomerate')&16) for _,p in pinrecs}
    assert len(all_name_flags)<=1 and len(all_num_flags)<=1
    pin_graphics=[]
    for j,p in pinrecs:
        flag=integer(p,'PinConglomerate');d=flag%4;length=rawnum(p,'PinLength');dx,dy=[(1,0),(0,1),(-1,0),(0,-1)][d]
        x,y=point(p);conn=(x+dx*length,y+dy*length);angle=(d*90+180)%360
        assert integer(p,'Electrical')==4 and not flag&4
        pin_graphics.append(f'(pin passive line (at {xy(local(conn,origin))} {angle}) (length {n(length*SCALE)}) (name {q(txt(p,"Name"))} {effects(1.27)}) (number {q(p["Designator"])} {effects(1.27)}))')
        pins.append(dict(ref=ref,pin=p['Designator'],name=txt(p,'Name'),record=j,connection_raw=conn,pin_type='passive',uuid=uid('pin'+str(j))))
    graphics=[draw(p,origin) for _,p in owned if p.get('RECORD') in ('4','6','7','10','12','13','14')]
    lib='\n'.join([f'(symbol {q(libid)}', '(pin_names (offset 0.762)'+(' (hide yes)' if all_name_flags=={False} else '')+')',
        '(pin_numbers (hide yes))' if all_num_flags=={False} else '', '(in_bom yes) (on_board yes)',
        prop('Reference',ref,hidden=False),prop('Value',value),prop('Footprint',footprint),prop('Datasheet',''),
        f'(symbol {q(key+"_0_1")} '+'\n'.join(graphics)+')',
        f'(symbol {q(key+"_1_1")} '+'\n'.join(pin_graphics)+')',')'])
    definitions.append(lib)
    fields=[]
    for p in [refrecord]+params:
        k=txt(p,'Name');mapped='Reference' if k=='Designator' else 'Value' if k=='Comment' else k
        ft=fonts[integer(p,'FontID',1)];angle=integer(p,'Orientation')*90
        # KiCad property rotation is limited to 0/90, so normalize upside-down text for readability.
        fields.append(prop(mapped,txt(p),sheet(point(p)),angle%180,p.get('IsHidden')=='T',ft['size'],'left bottom'))
    fields.extend([prop('Footprint',footprint,sheet(origin)),prop('Datasheet','',sheet(origin)),
        prop('Altium_SourceUniqueID',r.get('UniqueID',''),sheet(origin)),prop('Altium_LibReference',r['LibReference'],sheet(origin)),
        prop('Altium_RecordIndex',i,sheet(origin))])
    body=[f'(symbol (lib_id {q(libid)}) (at {xy(sheet(origin))} 0) (unit 1)',
          '(in_bom yes) (on_board yes) (dnp no)',f'(uuid {q(uid("component"+str(i)))})']+fields
    body.extend(f'(pin {q(p["Designator"])} (uuid {q(uid("pin"+str(j)))}))' for j,p in pinrecs)
    body.append(f'(instances (project {q(NAME)} (path {q("/"+ROOT)} (reference {q(ref)}) (unit 1)))) )')
    instances.append('\n'.join(body))
    components.append(dict(ref=ref,value=value,footprint=footprint,parameters=paramsdict,native_record=i,
        native_unique_id=r.get('UniqueID'),origin_raw=origin,pin_count=len(pinrecs),lib_id=libid,
        uuid=uid('component'+str(i)),all_models=impl))

# Separate native connectivity calculation, independent of the generated KiCad netlist.
segments=[];ports=[];junctions=[];ncs=[];sheetitems=[]
for i,r in enumerate(R):
    typ=r.get('RECORD')
    if typ=='27':
        ps=[(rawnum(r,'X'+str(k)),rawnum(r,'Y'+str(k))) for k in range(1,integer(r,'LocationCount')+1)]
        for k,(a,b) in enumerate(zip(ps,ps[1:])):
            segments.append((a,b))
            sheetitems.append(f'(wire (pts (xy {xy(sheet(a))}) (xy {xy(sheet(b))})) (stroke (width 0) (type default)) (uuid {q(uid(f"wire{i}_{k}"))}))')
    elif typ=='29':
        p=point(r);junctions.append(p)
        sheetitems.append(f'(junction (at {xy(sheet(p))}) (diameter 0) (color 0 0 0 0) (uuid {q(uid("junction"+str(i)))}))')
    elif typ=='22':
        p=point(r);ncs.append(p)
        sheetitems.append(f'(no_connect (at {xy(sheet(p))}) (uuid {q(uid("nc"+str(i)))}))')
    elif typ=='17':
        p=point(r);name=txt(r);ports.append((p,name));angle=integer(r,'Orientation')*90
        if integer(r,'Style') in (2,5):angle=0  # Keep supply/ground text horizontal and clear of adjacent vertical fields.
        # The project has one sheet: local labels preserve connectivity while native symbol style is logged.
        # Power symbol orientation points away from anchor; text at left uses 180 degrees in KiCad.
        sheetitems.append(f'(label {q(name)} (at {xy(sheet(p))} {angle}) {effects(1.27,False,"left bottom")} (uuid {q(uid("port"+str(i)))}))')
    elif typ=='4' and 'OwnerIndex' not in r:
        ft=fonts[integer(r,'FontID',1)]
        sheetitems.append(f'(text {q(txt(r))} (at {xy(sheet(point(r)))} {integer(r,"Orientation")*90}) {effects(ft["size"],False,"left bottom",ft["bold"])} (uuid {q(uid("text"+str(i)))}))')

points=set(junctions+ncs+[tuple(p['connection_raw']) for p in pins]+[p for p,_ in ports]+[p for ab in segments for p in ab])
parent={p:p for p in points}
def root(p):
    while parent[p]!=p:parent[p]=parent[parent[p]];p=parent[p]
    return p
def union(a,b):parent[root(a)]=root(b)
def on_segment(p,a,b):
    return abs((p[0]-a[0])*(b[1]-a[1])-(p[1]-a[1])*(b[0]-a[0]))<1e-8 and min(a[0],b[0])<=p[0]<=max(a[0],b[0]) and min(a[1],b[1])<=p[1]<=max(a[1],b[1])
for a,b in segments:
    for p in points:
        if on_segment(p,a,b):union(a,p)
byname={}
for p,name in ports:
    if name in byname:union(p,byname[name])
    else:byname[name]=p
groups=collections.defaultdict(lambda:dict(nodes=[],labels=set()))
for p in pins:groups[root(tuple(p['connection_raw']))]['nodes'].append([p['ref'],p['pin']])
for p,name in ports:groups[root(p)]['labels'].add(name)
nets=[]
for g in groups.values():
    assert len(g['labels'])<=1, g
    if not g['nodes']:continue
    g['nodes'].sort();g['labels']=sorted(g['labels']);g['nc']=len(g['nodes'])==1 and any(tuple(p['connection_raw']) in ncs for p in pins if [p['ref'],p['pin']]==g['nodes'][0])
    nets.append(g)
dump('checks/native_connectivity.json',dict(nets=nets,pins=pins,components=components))
dump('checks/source_identity.json',dict(status='CONFIRMED_BY_USER',confirmation='包内原生 Altium 工程正确，以它为准',
    source_sha256=EXPECTED,bundle_sha256='40076b007e542000d1e32d5ae9e5e1d736a72e40fdfef2a6bdbc0a0629a9da68',
    excluded_previous_source_sha256='7b63a8b546fd5891400f933f6e01e304fb9bc4035cd5f425769eadb3f9f0c600'))
dump('checks/conversion_notes.json',dict(source_records=len(R),components=len(components),pins=len(pins),wire_polylines=65,
    wire_segments=len(segments),junctions=len(junctions),ports=len(ports),no_connects=len(ncs),nets=len(nets),
    unit_mm=.254,unit_basis='KiCad official altium_parser_sch.cpp Altium2KiCadUnit: 10 mil per integer unit, fraction unit = 1/10000 mil',
    source_url='https://docs.kicad.org/doxygen/altium__parser__sch_8cpp_source.html',
    limits=['Native 41 components and every source parameter retained; 29 have electrical pins.',
    'Relative page positions, pin endpoints and wire vertices retained. A4 Y origin = 209.55 mm, a uniform -0.45 mm translation for 50-mil grid alignment.',
    'Power-port glyphs converted to same-name single-sheet labels; colors/font metrics follow KiCad theme.',
    'Rounded rectangles sampled at 7.5 degree intervals; text rotations normalized to 0/90 for KiCad properties.',
    'Native pin electrical type is passive for all 85 pins. ERC cannot establish IC electrical correctness.',
    'Footprint model names retained verbatim. Original external libraries are not present; do not auto-substitute.',
    'Native designator * is preserved, including any KiCad annotation warning.',
    'Native Altium compiled netlist and original PDF not supplied; use native geometric net extraction + PCB membership cross-check.']))
OUT.joinpath(NAME+'.kicad_sch').write_text('\n'.join(['(kicad_sch (version 20250114) (generator "eeschema")',f'(uuid {q(ROOT)})','(paper "A4")',
    '(lib_symbols '+'\n'.join(definitions)+')']+sheetitems+instances+[')']),encoding='utf-8')
libtext='\n'.join(definitions).replace('"MD50PG_Native:','"')
OUT.joinpath('MD50PG_Native.kicad_sym').write_text('(kicad_symbol_lib (version 20241209) (generator "kicad_symbol_editor")\n'+libtext+'\n)',encoding='utf-8')
OUT.joinpath('sym-lib-table').write_text('(sym_lib_table (version 7) (lib (name "MD50PG_Native") (type "KiCad") (uri "${KIPRJMOD}/MD50PG_Native.kicad_sym") (options "") (descr "Confirmed native SchDoc instance symbols")))',encoding='utf-8')
OUT.joinpath(NAME+'.kicad_pro').write_text(json.dumps({'meta':{'filename':NAME+'.kicad_pro','version':1}},indent=2),encoding='utf-8')
# UTF-8 BOM keeps native strings intact in Chinese Excel; do not infer omitted specs.
with OUT.joinpath('BOM_原始逐件参数.csv').open('w',encoding='utf-8-sig',newline='') as f:
    w=csv.writer(f);w.writerow(['原位号','原值字符串','原封装名称','物料编码','物料描述','优选等级','装配类型','电气针脚数','SchDoc记录'])
    for c in components:w.writerow([c['ref'],c['value'],c['footprint']]+[c['parameters'].get(k,'') for k in ('物料编码','物料描述','优选等级','装配类型')]+[c['pin_count'],c['native_record']])
print(json.dumps(dict(schematic=NAME+'.kicad_sch',components=len(components),pins=len(pins),net_groups=len(nets)),ensure_ascii=False))
