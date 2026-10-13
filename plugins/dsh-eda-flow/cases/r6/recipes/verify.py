"""Compare R6 against immutable native evidence and the independent KiCad import."""
from pathlib import Path
import collections,csv,hashlib,json,math,xml.etree.ElementTree as ET
import pcbnew as p
import sexpdata as sx

import sys
OUT=Path(sys.argv[1]); BUNDLE=Path(sys.argv[2])
def uid(x):return x.m_Uuid.AsString()
def xy(v):return (v.x,v.y)
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def group(ns):return tuple(sorted(tuple(n) for n in ns))
def tag(x):return str(x[0]) if isinstance(x,list) and x else ''
def children(x,k):return [v for v in x if tag(v)==k]
def child(x,k):return next((v for v in x if tag(v)==k),None)
def props(x):return {v[1]:v[2] for v in children(x,'property')}
def polygon(poly):
    def contour(c):return [xy(c.CPoint(i)) for i in range(c.PointCount())]
    return [(contour(poly.COutline(i)),[contour(poly.CHole(i,j)) for j in range(poly.HoleCount(i))]) for i in range(poly.OutlineCount())]
old=p.LoadBoard(str(OUT/'reference/MD50PG_native_import_REFERENCE.kicad_pcb'))
new=p.LoadBoard(str(OUT/'MD50PG_R6.kicad_pcb'))
oldfp={uid(f):f for f in old.GetFootprints()};newfp={uid(f):f for f in new.GetFootprints()}
assert set(oldfp)==set(newfp)
pad_count=0;model_count=0
for u,a in oldfp.items():
    b=newfp[u]
    assert (a.GetReference(),xy(a.GetPosition()),a.GetOrientationDegrees(),a.GetLayer())==(b.GetReference(),xy(b.GetPosition()),b.GetOrientationDegrees(),b.GetLayer())
    ap={uid(x):x for x in a.Pads()};bp={uid(x):x for x in b.Pads()};assert set(ap)==set(bp)
    for pu,x in ap.items():
        y=bp[pu]
        assert (xy(x.GetPosition()),xy(x.GetSize()),xy(x.GetDrillSize()),x.GetShape(),x.GetAttribute(),x.GetOrientationDegrees(),list(x.GetLayerSet().Seq()))==(xy(y.GetPosition()),xy(y.GetSize()),xy(y.GetDrillSize()),y.GetShape(),y.GetAttribute(),y.GetOrientationDegrees(),list(y.GetLayerSet().Seq())),(a.GetReference(),pu)
        for layer in (p.F_Cu,p.B_Cu):
            if x.IsOnLayer(layer):assert polygon(x.GetEffectivePolygon(layer))==polygon(y.GetEffectivePolygon(layer)),(a.GetReference(),pu,'copper_shape')
        pad_count+=1
    assert len(a.Models())==len(b.Models())
    for x,y in zip(a.Models(),b.Models()):
        for attr in ('m_Offset','m_Rotation','m_Scale'):
            aa,bb=getattr(x,attr),getattr(y,attr);assert (aa.x,aa.y,aa.z)==(bb.x,bb.y,bb.z)
        target=OUT/y.m_Filename.replace('${KIPRJMOD}/','');assert target.is_file();model_count+=1
oldtracks={uid(x):x for x in old.GetTracks()};newtracks={uid(x):x for x in new.GetTracks()}
assert set(oldtracks)==set(newtracks)
for u,a in oldtracks.items():
    b=newtracks[u]
    assert (xy(a.GetStart()),xy(a.GetEnd()),a.GetWidth(),a.GetLayer(),a.GetClass())==(xy(b.GetStart()),xy(b.GetEnd()),b.GetWidth(),b.GetLayer(),b.GetClass())
oldz={uid(x):x for x in old.Zones()};newz={uid(x):x for x in new.Zones()};assert set(oldz)==set(newz)
fill_count=0
for u,a in oldz.items():
    b=newz[u];assert polygon(a.Outline())==polygon(b.Outline())
    assert list(a.GetLayerSet().Seq())==list(b.GetLayerSet().Seq())
    for layer in (p.F_Cu,p.B_Cu):
        if a.HasFilledPolysForLayer(layer):
            assert polygon(a.GetFilledPolysList(layer))==polygon(b.GetFilledPolysList(layer))
            if a.GetFilledPolysList(layer).OutlineCount():fill_count+=1

# Native positions provide a separate check, not a comparison of two derived boards only.
pcs=json.loads((BUNDLE/'02_extracted/pcb_native/pcb_native_components.json').read_text('utf8'))['components']
nativebyref={c['designator']:c for c in pcs}
audit=json.loads((OUT/'checks/conversion_audit.json').read_text('utf8'))
model_residuals=[]
for m in audit['model_repairs']:
    c=nativebyref[m['ref']];r=m['native_body']
    mil=lambda text:float(text.removesuffix('mil'))*.0254
    dx=mil(r['MODEL.2D.X'])-c['position']['x']['mm'];dy=mil(r['MODEL.2D.Y'])-c['position']['y']['mm']
    angle=math.radians(c['rotation']['degrees']);lx=dx*math.cos(angle)+dy*math.sin(angle);ly=-dx*math.sin(angle)+dy*math.cos(angle)
    if c['layer']=='BOTTOM':ly=-ly
    expected=[lx,ly,mil(r['MODEL.3D.DZ'])]
    residual=max(abs(a-b) for a,b in zip(expected,m['offset_mm']));assert residual<.00002,(m['ref'],residual)
    model_residuals.append(residual)
refs={f.GetReference():f for f in new.GetFootprints() if f.GetReference()}
placements=[]
for c in pcs:
    f=refs[c['designator']];nx,ny=c['position']['x']['mm'],c['position']['y']['mm']
    px,py=f.GetPosition().x/1e6,f.GetPosition().y/1e6
    residual=math.hypot(px-(nx-569.887697),py-(-ny+634.686501))
    assert residual<.00001,(c['designator'],residual)
    assert abs((f.GetOrientationDegrees()-c['rotation']['degrees']+180)%360-180)<1e-6
    assert f.IsFlipped()==(c['layer']=='BOTTOM')
    placements.append([c['designator'],nx,ny,px,py,f.GetOrientationDegrees(),'Bottom' if f.IsFlipped() else 'Top',residual,'一致'])
with (OUT/'位置核对_40个原始器件.csv').open('w',encoding='utf-8-sig',newline='') as f:
    w=csv.writer(f);w.writerow(['位号','原Altium X mm','原Altium Y mm','KiCad X mm','KiCad Y mm','角度','面','转换残差 mm','结果']);w.writerows(placements)

native=json.loads((OUT/'checks/native_connectivity.json').read_text('utf8'))
tree=ET.parse(OUT/'checks/restored.xml')
ng={group(n['nodes']):n for n in native['nets']}
rg={group((n.get('ref'),n.get('pin')) for n in net.findall('node')):net.get('name') for net in tree.findall('./nets/net')}
assert set(ng)==set(rg)
pinset={tuple(n) for net in native['nets'] for n in net['nodes']};assert len(pinset)==85
pg=collections.defaultdict(set)
for f in new.GetFootprints():
    for pad in f.Pads():
        pair=(f.GetReference(),pad.GetNumber())
        if pair in pinset:pg[pad.GetNetname()].add(pair)
pg={group(v):k for k,v in pg.items()};assert pg==rg
with (OUT/'连接核对_85引脚.csv').open('w',encoding='utf-8-sig',newline='') as f:
    w=csv.writer(f);w.writerow(['原位号','引脚','原引脚名','原网络标签','R6原理图网络','R6 PCB网络','结果'])
    for pin in native['pins']:
        g=next(g for g in ng if (pin['ref'],pin['pin']) in g)
        w.writerow([pin['ref'],pin['pin'],pin['name'],'/'.join(ng[g]['labels']),rg[g],pg[g],'NC一致' if ng[g]['nc'] else '一致'])
ct={e.get('ref'):e for e in tree.findall('./components/comp')}
assert len(ct)==41
for c in native['components']:
    e=ct[c['ref']];assert e.findtext('value')==c['value']
    fields={x.get('name'):x.text or '' for x in e.findall('./fields/field')}
    for k,v in c['parameters'].items():
        if k!='Comment':assert fields[k]==v,(c['ref'],k)
    assert fields['Altium_OriginalFootprint']==c['footprint']
    if c['ref'] in refs:
        assert e.findtext('footprint')==refs[c['ref']].GetFPID().GetUniStringLibId()
        assert refs[c['ref']].GetValue()==c['value']

sch=sx.load((OUT/'MD50PG_R6.kicad_sch').open(encoding='utf8'))
board=sx.load((OUT/'MD50PG_R6.kicad_pcb').open(encoding='utf8'))
for fp in children(board,'footprint'):
    name=fp[1].split(':',1)[1];lib=sx.load((OUT/'MD50PG_Placed.pretty'/(name+'.kicad_mod')).open(encoding='utf8'))
    if props(fp)['Reference'].startswith('RJ'):
        assert child(fp,'jumper_pad_groups')==child(lib,'jumper_pad_groups')==[sx.Symbol('jumper_pad_groups'),['1','2']]
assert len(children(board,'footprint'))==len(list((OUT/'MD50PG_Placed.pretty').glob('*.kicad_mod')))==74
qr=next(x for x in children(sch,'symbol') if props(x)['Reference']=='QR Code')
assert str(child(qr,'on_board')[1])=='no'
edgepoints=[v for x in new.GetDrawings() if x.GetLayer()==p.Edge_Cuts for v in (x.GetStart(),x.GetEnd())]
width=(max(v.x for v in edgepoints)-min(v.x for v in edgepoints))/1e6
height=(max(v.y for v in edgepoints)-min(v.y for v in edgepoints))/1e6
assert (width,height)==(82.47,57.51)
assert {d.GetText() for d in new.GetDrawings() if d.GetLayer()==p.Dwgs_User and d.GetClass().startswith('PCB_DIM')}=={'82.47 mm','57.51 mm'}
drc=json.loads((OUT/'checks/drc.json').read_text('utf8'));erc=json.loads((OUT/'checks/erc.json').read_text('utf8'))
ev=[v for sheet in erc['sheets'] for v in sheet['violations']]
assert not any(v['severity']=='error' for v in drc['violations']+ev)
assert drc['unconnected_items']==[] and drc['schematic_parity']==[]
result={'status':'R6_RECIPE_CHECKS_PASSED','completeOneToOneVerified':False,'native_named_placements_matched':len(placements),
    'max_native_coordinate_residual_mm':max(r[7] for r in placements),'all_footprint_placements_unchanged':len(oldfp),
    'pad_geometries_unchanged':pad_count,'tracks_unchanged':len(oldtracks),'vias':sum(t.GetClass()=='PCB_VIA' for t in new.GetTracks()),
    'zone_outlines_unchanged':len(oldz),'filled_zone_geometry_unchanged':fill_count,
    'source_model_transforms_unchanged_and_local_files_resolved':model_count,
    'native_model_body_positions_matched':len(model_residuals),'max_model_position_residual_mm':max(model_residuals),
    'schematic_components_with_exact_original_values_and_parameters':41,'electrical_pin_memberships_matched':85,
    'net_and_NC_partitions_matched':len(ng),'local_footprint_library_files':74,
    'board_dimensions_mm':[width,height],'drc_errors':0,'unconnected_items':0,'schematic_parity_issues':0,
    'drc_warnings':dict(collections.Counter(v['type'] for v in drc['violations'])),'erc_errors':0,
    'erc_warnings':dict(collections.Counter(v['type'] for v in ev)),
    'native_rule_translation':audit['rule_translation'],
    'source_annotation_note':'Original display designator * is preserved; KiCad netlist export warns about annotation. No silent renumbering.',
    'fabrication_release':False,'physical_fit_verified':False,
    'outline_exception':'Eight closed R3 outline segments implement the requested nominal 82.47 x 57.51 mm. Imported outline is preserved on Eco1.User.',
    'source_import_note':'This run imported the confirmed native PcbDoc anew. The intermediate is generated in this run; no historical R5/R6 deliverable is read.'}
(OUT/'checks/verification.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps(result,ensure_ascii=False,indent=2))
