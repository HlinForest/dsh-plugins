"""Reproducible R6 conversion repairs. Never edit the confirmed source snapshots."""
from pathlib import Path
import collections, copy, csv, hashlib, json, math, shutil, struct, sys, xml.etree.ElementTree as ET
import sexpdata as sx
import pcbnew as p

OUT=Path(sys.argv[1]); R5=Path(sys.argv[2]); BUNDLE=Path(sys.argv[3])
CONFIG=json.loads(Path(sys.argv[4]).read_text(encoding='utf-8'))
OUT.mkdir(parents=True,exist_ok=True)
sys.path.insert(0,str(Path(__file__).resolve().parents[3]/'python/vendor'))
import olefile
NAME='MD50PG_R6'
S=sx.Symbol
def tag(x):return str(x[0]) if isinstance(x,list) and x else ''
def children(x,k):return [v for v in x if tag(v)==k]
def one(x,k):return next((v for v in x if tag(v)==k),None)
def prop(x,k):return next((v for v in children(x,'property') if v[1]==k),None)
def setprop(x,k,v):
    field=prop(x,k)
    if field is None:
        field=copy.deepcopy(prop(x,'Footprint'));field[1]=k;x.append(field)
    field[2]=v
def write_sexp(path,x):
    # A newline per top-level object keeps generated files easy to inspect.
    path.write_text('('+str(x[0])+'\n'+'\n'.join(sx.dumps(v) for v in x[1:])+')\n',encoding='utf8')
def js(path,x):
    path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(x,ensure_ascii=False,indent=2),encoding='utf8')
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def vec(x,y):return p.VECTOR2I(round(x*1e6),round(y*1e6))
def mm(v):return [v.x/1e6,v.y/1e6]
def pid(x):return x.m_Uuid.AsString()

source=R5/'pcb_reference/MD50PG_native_import.kicad_pcb'
assert source.is_file(), 'Missing fresh native import'
assert sha(R5/'native_original/MD50PG.SchDoc')=='bd063b92a9a3dd99c2b28ec22438179d58d35468e11352cf11e9310e48ace99e'
assert sha(R5/'native_original/MD50PG_1.0 (2021.06.18).PcbDoc')=='d2bdae6819254dae24ec9e8b63f7605b84a4015688ffdfd57b9f6fd2616a8e40'
for dirname in ('native_original','models','MD50PG_Placed.pretty','checks','previews','reference'):(OUT/dirname).mkdir(exist_ok=True)
shutil.copytree(R5/'native_original',OUT/'native_original',dirs_exist_ok=True)
shutil.copyfile(source,OUT/'reference/MD50PG_native_import_REFERENCE.kicad_pcb')
for file in ('native_connectivity.json','source_identity.json','original_hashes.json'):
    shutil.copyfile(R5/'checks'/file,OUT/'checks'/file)
shutil.copyfile(R5/'BOM_原始逐件参数.csv',OUT/'BOM_原始逐件参数.csv')
native=json.loads((R5/'checks/native_connectivity.json').read_text('utf8'))
comps={x['ref']:x for x in native['components']}
pc=json.loads((BUNDLE/'02_extracted/pcb_native/pcb_native_components.json').read_text('utf8'))['components']
pcbyref={c['designator']:c for c in pc}
sch=sx.load((R5/'MD50PG_R5_SourceRestored.kicad_sch').open(encoding='utf8'))
rootuuid=one(sch,'uuid')[1]
symbols={prop(s,'Reference')[2]:s for s in children(sch,'symbol')}
board=p.LoadBoard(str(source))
fps={f.GetReference():f for f in board.GetFootprints() if f.GetReference()}
audit={'source_pcb_import_sha256':sha(source),'source_native_pcb_sha256':sha(OUT/'native_original/MD50PG_1.0 (2021.06.18).PcbDoc'),
       'source_confirmed_by_user':True,'pad_repairs':[],'model_repairs':[],'footprints':[],
       'coordinate_transform':{'x_offset_mm':-569.887697,'y_scale':-1,'y_offset_mm':634.686501}}

# Restore lost copper-pad connectivity from unique geometric overlap, without moving copper.
for ref in ('D1','DISP'):
    f=fps[ref]
    for pad in f.Pads():
        if pad.GetNumber() or pad.GetNetCode()!=0 or not pad.IsOnLayer(p.B_Cu):continue
        poly=pad.GetEffectivePolygon(p.B_Cu)
        hits=[q for q in f.Pads() if q.GetNumber() and q.GetNetCode()!=0 and poly.Collide(q.GetEffectivePolygon(p.B_Cu))]
        assert len(hits)==1,(ref,pid(pad),len(hits))
        q=hits[0]
        audit['pad_repairs'].append({'ref':ref,'uuid':pid(pad),'position_mm':mm(pad.GetPosition()),'pin':q.GetNumber(),'original_net':q.GetNetname(),'overlap_match_uuid':pid(q)})
        pad.SetNumber(q.GetNumber());pad.SetNet(q.GetNet())
assert len(audit['pad_repairs'])==9

# Rename networks by independently compiled R5 pin sets, including the explicit NC.
netmap={x['bundle_derived_pcb_net']:x['kicad_name'] for x in json.loads((R5/'checks/verification.json').read_text('utf8'))['net_mapping']}
for code,net in board.GetNetsByNetcode().items():
    if code:net.SetNetname(netmap[net.GetNetname()])
nc=p.NETINFO_ITEM(board,netmap['']);board.Add(nc)
for pad in fps['U1'].Pads():
    if pad.GetNumber()=='12':pad.SetNet(nc)
pinmetadata={(x['ref'],x['pin']):x for x in native['pins']}
for ref,f in fps.items():
    for pad in f.Pads():
        info=pinmetadata.get((ref,pad.GetNumber()))
        if info:pad.SetPinFunction(info['name']);pad.SetPinType('no_connect' if (ref,pad.GetNumber())==('U1','12') else info['pin_type'])
audit['net_aliases']=netmap

# Read original native component-body model associations (not imported, sometimes blank filenames).
manifest=json.loads((R5/'assets/native_models/manifest.json').read_text('utf8'))
byid={m['native_metadata']['ID']:m for m in manifest}
for m in manifest:
    shutil.copyfile(R5/m['output'],OUT/'models'/Path(m['output']).name)
    assert sha(OUT/'models'/Path(m['output']).name)==m['sha256']
js(OUT/'models/source_manifest.json',manifest)
ole=olefile.OleFileIO(OUT/'native_original/MD50PG_1.0 (2021.06.18).PcbDoc')
raw=ole.openstream('ComponentBodies6/Data').read();offset=0;bodies=collections.defaultdict(list)
while offset<len(raw):
    assert raw[offset]==12
    ln=struct.unpack_from('<I',raw,offset+1)[0];body=raw[offset+5:offset+5+ln]
    idx=struct.unpack_from('<H',body,7)[0];k=body.find(b'|V7_LAYER=')
    if k<0:k=body.find(b'V7_LAYER=')
    assert k>=0
    textlen=struct.unpack_from('<I',body,k-4)[0]
    text=body[k:k+textlen].rstrip(b'\0').decode('gb18030')
    fields=dict(s.split('=',1) for s in text.split('|') if '=' in s)
    bodies[idx].append(fields);offset+=5+ln
assert offset==len(raw)
for c in pc:
    ref=c['designator'];f=fps[ref]
    rows=[r for r in bodies[c['source_locator']['record_index']] if r.get('MODELID') in byid]
    mods=f.Models()
    assert len(rows)==len(mods),(ref,len(rows),len(mods))
    for i,(row,model) in enumerate(zip(rows,mods)):
        original=model.m_Filename;m=byid[row['MODELID']]
        model.m_Filename='${KIPRJMOD}/models/'+Path(m['output']).name
        # SWIG vector elements are references; assign explicitly for portability.
        mods[i]=model
        audit['model_repairs'].append({'ref':ref,'body_index':i,'model_id':row['MODELID'],'before':original,'after':model.m_Filename,
            'offset_mm':[model.m_Offset.x,model.m_Offset.y,model.m_Offset.z],
            'rotation_deg':[model.m_Rotation.x,model.m_Rotation.y,model.m_Rotation.z],'native_body':row})

# Bind the source symbols to individually extracted placed footprints. Original names stay as evidence.
names={ref:('DISPLAY' if ref=='*' else ref.replace(' ','_'))+'_Original' for ref in fps}
for ref,sym in symbols.items():
    c=comps[ref]
    setprop(sym,'Altium_OriginalFootprint',c['footprint'])
    if ref not in fps:
        assert ref=='QR Code'
        one(sym,'on_board')[1]=S('no');setprop(sym,'Footprint','')
        setprop(sym,'Restoration_Note','原理图有此对象，原 PCB 无放置实例。')
    else:
        setprop(sym,'Footprint','MD50PG_Placed:'+names[ref])
        setprop(sym,'Altium_PCBPattern',pcbyref[ref]['pattern'])
    for project in children(one(sym,'instances'),'project'):project[1]=NAME
    lib=next(s for s in children(one(sch,'lib_symbols'),'symbol') if s[1]==one(sym,'lib_id')[1])
    setprop(lib,'Footprint',prop(sym,'Footprint')[2])
    if ref.startswith('RJ'):
        lib.append([S('jumper_pin_groups'),['1','2']])
    if ref=='QR Code':one(lib,'on_board')[1]=S('no')
    if ref not in fps:continue
    f=fps[ref];f.SetValue(c['value']);f.SetFPID(p.LIB_ID('MD50PG_Placed',names[ref]))
    f.SetLocked(True);f.SetBoardOnly(False)
    f.SetExcludedFromBOM(False);f.SetExcludedFromPosFiles(c['pin_count']==0)
    path=p.KIID_PATH();path.push_back(p.KIID(rootuuid));path.push_back(p.KIID(c['uuid']));f.SetPath(path)
    f.SetSheetfile(NAME+'.kicad_sch');f.SetSheetname('')
    for field in children(sym,'property'):
        if field[1] in ('Reference','Value','Footprint'):continue
        f.SetField(field[1],field[2]);f.GetField(field[1]).SetVisible(False)
    # Do not hide original visible reference/value graphics.
    audit['footprints'].append({'ref':ref,'library_id':'MD50PG_Placed:'+names[ref],
         'original_schematic_footprint':c['footprint'],'original_pcb_pattern':pcbyref[ref]['pattern'],
         'position_mm':mm(f.GetPosition()),'rotation_deg':f.GetOrientationDegrees(),'side':'B' if f.IsFlipped() else 'F','uuid':pid(f)})
for i,f in enumerate(board.GetFootprints()):
    if f.GetReference():continue
    f.SetBoardOnly(True);f.SetExcludedFromBOM(True);f.SetExcludedFromPosFiles(True)
    f.SetFPID(p.LIB_ID('MD50PG_Placed',f'AUX_{i:02d}'))

# KiCad's Arial rendering has no CJK glyph fallback. Repair the two original Chinese
# silk notes with a local CJK face; retain text, coordinates, size, rotation and layer.
audit['font_fallback_repairs']=[]
for f in board.GetFootprints():
    for t in f.GraphicalItems():
        if hasattr(t,'GetText') and any(ord(c)>127 for c in t.GetText()):
            audit['font_fallback_repairs'].append({'ref':f.GetReference(),'uuid':pid(t),'text':t.GetText(),'before':t.GetFontName(),'after':'SimSun','reason':'Original Arial face renders Chinese as missing-glyph boxes in KiCad.'})
            t.SetFontProp(CONFIG['font'])
shutil.copytree(R5/'assets/native_fonts',OUT/'reference/native_fonts',dirs_exist_ok=True)

# Preserve imported and panel construction geometry on reference layers.
moved=[]
for d in board.GetDrawings():
    old=d.GetLayer();target=None
    if old==p.Edge_Cuts:target=p.Eco1_User
    elif old==p.Dwgs_User:target=p.Cmts_User
    elif d.GetClass().startswith('PCB_DIM'):target=p.Cmts_User
    elif old==p.F_SilkS:
        box=d.GetBoundingBox()
        if box.GetLeft()/1e6<106 or box.GetRight()/1e6>191 or box.GetTop()/1e6<75 or box.GetBottom()/1e6>135:target=p.Eco2_User
    if target is not None:
        moved.append({'uuid':pid(d),'from':board.GetLayerName(old),'to':p.LayerName(target)});d.SetLayer(target)
audit['reference_layer_moves']=moved
left,top,width,height,radius=[CONFIG['outline'][k] for k in ['left','top','width','height','radius']]
right,bottom=left+width,top+height
def line(a,b):
    s=p.PCB_SHAPE(board);s.SetShape(p.SHAPE_T_SEGMENT);s.SetStart(vec(*a));s.SetEnd(vec(*b));s.SetLayer(p.Edge_Cuts);s.SetWidth(50000);board.Add(s)
def arc(a,mid,b):
    s=p.PCB_SHAPE(board);s.SetShape(p.SHAPE_T_ARC);s.SetArcGeometry(vec(*a),vec(*mid),vec(*b));s.SetLayer(p.Edge_Cuts);s.SetWidth(50000);board.Add(s)
r=radius;u=r/math.sqrt(2)
line((left+r,top),(right-r,top));line((right,top+r),(right,bottom-r));line((right-r,bottom),(left+r,bottom));line((left,bottom-r),(left,top+r))
arc((left,top+r),(left+r-u,top+r-u),(left+r,top))
arc((right-r,top),(right-r+u,top+r-u),(right,top+r))
arc((right,bottom-r),(right-r+u,bottom-r+u),(right-r,bottom))
arc((left+r,bottom),(left+r-u,bottom-r+u),(left,bottom-r))
for a,b,h in [((left,bottom),(right,bottom),6),((left,top),(left,bottom),8)]:
    d=p.PCB_DIM_ALIGNED(board);d.SetStart(vec(*a));d.SetEnd(vec(*b));d.SetHeight(round(h*1e6));d.SetLayer(p.Dwgs_User)
    d.SetUnitsMode(p.DIM_UNITS_MODE_MM);d.SetUnitsFormat(p.DIM_UNITS_FORMAT_BARE_SUFFIX);d.SetPrecision(2)
    d.SetTextSize(vec(1.4,1.4));d.SetTextThickness(180000);d.SetLineThickness(150000);d.SetArrowLength(1000000);d.Update();board.Add(d)
audit['outline']={'nominal_mm':[width,height],'corner_radius_mm':r,'left_top_mm':[left,top],
    'native_dimension_projections_mm':[82.46700296,57.51019994],
    'imported_edge_bbox_mm':[82.70276,57.71376],
    'method':'Closed R3 rounded rectangle at original dimension datums, nominal dimensions rounded to two decimals as requested. Original imported Edge.Cuts retained on Eco1.User. All copper and component coordinates unchanged.'}
audit['source_stackup_thickness_mm']=board.GetDesignSettings().GetBoardThickness()/1e6

schpath=OUT/(NAME+'.kicad_sch');write_sexp(schpath,sch)
# Library embedded definitions and external symbols have identical footprint/jumper definitions.
lib=sx.load((R5/'MD50PG_Native.kicad_sym').open(encoding='utf8'))
newlib=[lib[0]]+[v for v in lib[1:] if tag(v)!='symbol']
for symbol in children(one(sch,'lib_symbols'),'symbol'):
    symbol=copy.deepcopy(symbol);symbol[1]=symbol[1].split(':',1)[1];newlib.append(symbol)
write_sexp(OUT/'MD50PG_Native.kicad_sym',newlib)
(OUT/'sym-lib-table').write_text('(sym_lib_table\n (lib (name "MD50PG_Native")(type "KiCad")(uri "${KIPRJMOD}/MD50PG_Native.kicad_sym")(options "")(descr "Confirmed native symbols"))\n)\n',encoding='utf8')
(OUT/'fp-lib-table').write_text('(fp_lib_table\n (lib (name "MD50PG_Placed")(type "KiCad")(uri "${KIPRJMOD}/MD50PG_Placed.pretty")(options "")(descr "Native placed footprint geometry"))\n)\n',encoding='utf8')
native_rules=json.loads((BUNDLE/'02_extracted/pcb_native/pcb_native_rules.json').read_text('utf8'))
js(OUT/'reference/altium_rules_36.json',native_rules)
js(OUT/(NAME+'.kicad_pro'),{'meta':{'filename':NAME+'.kicad_pro','version':1},
    'board':{'design_settings':{'rules':{'min_clearance':0.254,'min_track_width':0.254}}},
    'net_settings':{'meta':{'version':4},'classes':[{'name':'Default','clearance':0.254,'track_width':0.3,'via_diameter':1.27,'via_drill':0.7112,'bus_width':12,'wire_width':6}]}})
(OUT/(NAME+'.kicad_dru')).write_text('''(version 1)
# Original Altium Rules6/Data: NET TO ALL, Width, HoleSize, RoutingVias.
# No violation exclusions. Full 36 native rules are preserved in reference/.
(rule "Altium NET TO ALL 10mil" (constraint clearance (min 10mil)))
(rule "Altium Width" (constraint track_width (min 10mil) (opt 11.811mil) (max 39.3701mil)))
(rule "Altium HoleSize" (condition "A.Type == 'Pad' || A.Type == 'Via'") (constraint hole_size (min 1mil) (max 100mil)))
(rule "Altium RoutingVias" (condition "A.Type == 'Via'") (constraint via_diameter (min 50mil) (max 50mil)) (constraint hole_size (min 28mil) (max 28mil)))
''',encoding='utf8')
audit['rule_translation']={'native_rule_count':36,'explicit_custom_rules':['NET TO ALL','Width','HoleSize','RoutingVias'],
    'preserved_in_pcb':'Imported pad mask/paste margins, solid zone connections, 0.254 mm zone clearance and rule-area geometry.',
    'limit':'Altium-specific autorouting, testpoint, collision and Keep-Out-layer scope semantics are preserved as source evidence, not claimed as fully equivalent KiCad rule translation. Default KiCad silk/text checks remain enabled.'}
pcbpath=OUT/(NAME+'.kicad_pcb');p.SaveBoard(str(pcbpath),board)
pcb=sx.load(pcbpath.open(encoding='utf8'))
for f in children(pcb,'footprint'):
    if prop(f,'Reference')[2].startswith('RJ'):f.append([S('jumper_pad_groups'),['1','2']])
write_sexp(pcbpath,pcb)
board=p.LoadBoard(str(pcbpath))
plugin=p.PCB_IO_MGR.FindPlugin(p.PCB_IO_MGR.KICAD_SEXP)
for f in board.GetFootprints():
    plugin.FootprintSave(str(OUT/'MD50PG_Placed.pretty'),f)
p.SaveBoard(str(pcbpath),board)
js(OUT/'checks/conversion_audit.json',audit)
print(json.dumps({'status':'BUILT','footprints':len(list(board.GetFootprints())),'library_files':len(list((OUT/'MD50PG_Placed.pretty').glob('*.kicad_mod'))),'custom_pads_repaired':len(audit['pad_repairs']),'model_links_repaired':len(audit['model_repairs']),'tracks':len(list(board.GetTracks())),'zones':len(list(board.Zones()))},ensure_ascii=False))
