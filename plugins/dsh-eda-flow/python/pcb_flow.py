"""Generic PCB generation and refinement from current inputs and verified generated candidates.
All structured exchanges use record_io; native DRC output is a text report.
"""
import sys, os, re, math, shutil, subprocess, copy, csv, hashlib, time, xml.etree.ElementTree as ET
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'mcp'))
from record_io import read_json as read, write_json as write
import pcbnew as pcb
from native_resources import parse as parse_native
from native_schematic import child
from pcb_footprints import bind_imports, electrical_identity, verify_pad_assignments
from pcb_process import assembly_sides, placement_report, add_copper, native_process, refresh_copper_report
from pcb_signal_placement import signal_filter_relations
from pcb_refinement import FeedbackSearch,prefer_candidate,quality_dominates,repair_shortlist,repair_time_budget
from pcb_trace_simplification import shorten_tracks
from pcb_power_pose import PowerPoseScore
from pcb_power_corridors import PowerCorridors
from pcb_route_cleanup import remove_redundant_tracks,route_metrics,merge_collinear_tracks
from pcb_candidate_history import prior_candidates,prepare_candidate

def run(args, cwd, timeout=180):
    p=subprocess.run([str(x) for x in args],cwd=cwd,capture_output=True,text=True,encoding='utf-8',errors='replace',timeout=timeout,creationflags=0x08000000 if os.name=='nt' else 0)
    if p.returncode not in (0,5): raise ValueError(p.stdout[-2000:]+'\n'+p.stderr[-2000:])
    return p

def parse_drc(text):
    counts={}
    for key,pattern in [('violations',r'\*\* Found (\d+) DRC violations \*\*'),('unconnected',r'\*\* Found (\d+) unconnected pads \*\*'),('parity',r'\*\* Found (\d+) Footprint errors \*\*')]:
        m=re.search(pattern,text,re.I)
        if not m: raise ValueError('Missing DRC report section: '+key)
        counts[key]=int(m[1])
    counts['errors']=len(re.findall(r';\s*error\b',text))
    counts['warnings']=len(re.findall(r';\s*warning\b',text))
    if counts['errors']+counts['warnings'] != counts['violations']+counts['unconnected']+counts['parity']:raise ValueError('DRC diagnostic count mismatch')
    counts['passed']=counts['errors']==0 and counts['unconnected']==0 and counts['parity']==0
    return counts

def resolve_silk_collisions(board, report):
    """Keep source artwork on fabrication layers when actual DRC rejects its silk."""
    changed=[];parts={f.GetReference():f for f in board.GetFootprints()}
    for match in re.finditer(r'\[(silk_over_copper|silk_overlap|silk_edge_clearance)\]:([\s\S]*?)(?=\n\[|\n\*\*|\Z)',report):
        rows=re.findall(r'@\(([-\d.]+) mm, ([-\d.]+) mm\): ([^\r\n]+)',match[2])
        # Prefer moving a field over moving graphical artwork.
        rows.sort(key=lambda row:0 if ' field of ' in row[2] else 1)
        for x,y,description in rows:
            owner=re.search(r' of (.+?)(?: on .+)?$',description)
            if not owner or owner[1] not in parts:continue
            fp=parts[owner[1]];items=list(fp.GetFields()) if ' field of ' in description else list(fp.GraphicalItems())
            matches=[item for item in items if item.GetLayer() in (pcb.F_SilkS,pcb.B_SilkS) and abs(pcb.ToMM(item.GetPosition().x)-float(x))<.001 and abs(pcb.ToMM(item.GetPosition().y)-float(y))<.001]
            if not matches:continue
            for item in matches:
                old=item.GetLayer();item.SetLayer(pcb.F_Fab if old==pcb.F_SilkS else pcb.B_Fab)
                changed.append({'reference':owner[1],'reason':match[1],'item':description,'xMm':float(x),'yMm':float(y),'action':'preserved on fabrication layer'})
            break
    return changed

def netlist(cli,sch):
    dest=sch.parent/'pcb-netlist.xml'
    run([cli,'sch','export','netlist','--format','kicadxml','-o',dest,sch],sch.parent)
    root=ET.parse(dest).getroot(); comps=[]
    for c in root.findall('./components/comp'):
        if c.get('ref','').startswith('#') or any(x.get('name')=='exclude_from_board' for x in c.findall('property')):continue
        comps.append({'ref':c.get('ref'),'value':c.findtext('value',''),'footprint':c.findtext('footprint',''),'fields':{f.get('name'):f.text or '' for f in c.findall('./fields/field')},'uuid':c.findtext('tstamps',''),'sheet':c.find('sheetpath').get('tstamps','') if c.find('sheetpath') is not None else ''})
    nets=[{'name':n.get('name'),'nodes':[(x.get('ref'),x.get('pin')) for x in n.findall('node')]} for n in root.findall('./nets/net')]
    return comps,nets

def build(req):
    out=Path(req['output']);project=out/'project';shutil.copytree(req['source'],project,dirs_exist_ok=True)
    sch=project/req['schematic'];root_uuid=re.search(r'\(uuid\s+([^\s)]+)',sch.read_text(encoding='utf-8')).group(1).strip(chr(34));boardfile=sch.with_suffix('.kicad_pcb');comps,nets=netlist(req['cli'],sch)
    original=electrical_identity(comps,nets)
    bindings=bind_imports(project,sch,req.get('footprintImports',[]),req.get('components',[]))
    if bindings:
        comps,nets=netlist(req['cli'],sch)
        if original!=electrical_identity(comps,nets):raise ValueError('Footprint binding changed schematic electrical identity')
    write(project/'footprint-bindings.json',{'imports':bindings,'electricalIdentityPreserved':True,'sourceSchematic':str(Path(req['source'])/req['schematic'])})
    with (project/'PCB-BOM.csv').open('w',encoding='utf-8-sig',newline='') as stream:
        writer=csv.writer(stream);writer.writerow(['Reference','Value','Footprint'])
        writer.writerows((c['ref'],c['value'],c['footprint']) for c in comps)
    plan=req['plan']; w,h=plan['widthMm'],plan['heightMm'];gap=plan.get('componentGapMm',2.0)
    for v in [w,h,plan['clearanceMm'],plan['trackWidthMm']]:
        if not isinstance(v,(int,float)) or not math.isfinite(v) or v<=0:raise ValueError('Invalid PCB dimensions or rules')
    if not isinstance(gap,(int,float)) or not math.isfinite(gap) or w>500 or h>500 or gap<0:raise ValueError('Board exceeds supported size or negative component gap')
    board=pcb.BOARD();board.SetCopperLayerCount(2)
    if plan.get('thicknessMm'):board.GetDesignSettings().SetBoardThickness(pcb.FromMM(plan['thicknessMm']))
    settings=board.GetDesignSettings();settings.m_MinClearance=pcb.FromMM(plan['clearanceMm']);settings.m_TrackMinWidth=pcb.FromMM(plan['trackWidthMm']);settings.m_CopperEdgeClearance=pcb.FromMM(0.5)
    nc=board.GetAllNetClasses()['Default'];nc.SetClearance(pcb.FromMM(plan['clearanceMm']));nc.SetTrackWidth(pcb.FromMM(plan['trackWidthMm']));nc.SetViaDiameter(pcb.FromMM(0.8));nc.SetViaDrill(pcb.FromMM(0.4))
    point=lambda x,y:pcb.VECTOR2I(pcb.FromMM(x),pcb.FromMM(y))
    radius=plan.get('cornerRadiusMm',0)
    if radius<0 or radius>min(w,h)/2:raise ValueError('Invalid corner radius')
    edges=[((radius,0),(w-radius,0)),((w,radius),(w,h-radius)),((w-radius,h),(radius,h)),((0,h-radius),(0,radius))]
    for a,b in edges:
        shape=pcb.PCB_SHAPE();shape.SetShape(pcb.SHAPE_T_SEGMENT);shape.SetLayer(pcb.Edge_Cuts);shape.SetWidth(pcb.FromMM(.05));shape.SetStart(point(*a));shape.SetEnd(point(*b));board.Add(shape)
    if radius:
        q=radius*(1-2**-.5)
        for a,mid,b in [((0,radius),(q,q),(radius,0)),((w-radius,0),(w-q,q),(w,radius)),((w,h-radius),(w-q,h-q),(w-radius,h)),((radius,h),(q,h-q),(0,h-radius))]:
            shape=pcb.PCB_SHAPE();shape.SetShape(pcb.SHAPE_T_ARC);shape.SetLayer(pcb.Edge_Cuts);shape.SetWidth(pcb.FromMM(.05));shape.SetArcGeometry(point(*a),point(*mid),point(*b));board.Add(shape)
    pads={}; footprints={}; bridges={}; missing=[];fpRoot=Path(req['footprints'])
    for c in comps:
        if ':' not in c['footprint']:missing.append(c['ref']+' 缺少可读取的 KiCad 封装');continue
        lib,name=c['footprint'].split(':',1)
        if any(x in lib+name for x in ['..','/','\\']):raise ValueError('Invalid library identifier')
        candidates=[project/(lib+'.pretty'),project/'footprints'/(lib+'.pretty'),fpRoot/(lib+'.pretty')]
        library=next((x for x in candidates if (x/(name+'.kicad_mod')).is_file()),None)
        if not library:missing.append(c['ref']+' 找不到封装 '+c['footprint']);continue
        groups=child(parse_native((library/(name+'.kicad_mod')).read_text(encoding='utf-8')),'jumper_pad_groups',[])[1:]
        if groups:bridges[c['ref']]=groups
        fp=pcb.FootprintLoad(str(library),name)
        if not fp:raise ValueError('Cannot load footprint '+c['footprint'])
        if any(g.GetLayer()==pcb.Rescue for g in fp.GraphicalItems()):raise ValueError('Invalid footprint layer name in '+c['footprint'])
        fp.SetReference(c['ref']);fp.SetValue(c['value']);fp.SetFPID(pcb.LIB_ID(lib,name))
        symbol_path=pcb.KIID_PATH()
        for part in [root_uuid]+[x for x in c['sheet'].split('/') if x]+c['uuid'].split():symbol_path.push_back(pcb.KIID(part))
        fp.SetPath(symbol_path);fp.SetSheetfile(sch.name);fp.SetSheetname('Root');board.Add(fp);footprints[c['ref']]=fp
        for field_name,field_value in c['fields'].items():
            if field_name in ['Reference','Value','Footprint']:continue
            fp.SetField(field_name,field_value);fp.GetField(field_name).SetVisible(False)
        fp.Value().SetVisible(False);fp.Reference().SetTextSize(point(.8,.8));fp.Reference().SetTextThickness(pcb.FromMM(.12))
        # Package the exact footprints used so the delivered project is editable offline.
        local=project/(lib+'.pretty');local.mkdir(exist_ok=True);shutil.copyfile(library/(name+'.kicad_mod'),local/(name+'.kicad_mod')) if library!=local else None
        for pad in fp.Pads():pads.setdefault((c['ref'],pad.GetNumber()),[]).append(pad)
    if missing:raise ValueError('；'.join(missing))
    netmap={};expected={}
    for n in nets:
        net=pcb.NETINFO_ITEM(board,n['name']);board.Add(net);netmap[n['name']]=net
        for ref,pin in n['nodes']:
            if ref not in footprints:continue
            if (ref,pin) not in pads:raise ValueError(f'{ref}.{pin} 没有对应焊盘')
            expected[(ref,pin)]=n['name']
            for pad in pads[(ref,pin)]:pad.SetNet(net)
    # Group order is model-selected from functional requirements; packing uses actual geometry.
    order=plan.get('order',[])
    if order and (len(order)!=len(set(order)) or set(order)!=set(footprints)):raise ValueError('Placement order must cover each component once')
    order=order or sorted(footprints)
    fixed=plan.get('placements',{})
    if not set(fixed)<=set(footprints):raise ValueError('Unknown fixed placement reference')
    process=native_process(req.get('process',{}),pads)
    assembly,assembly_facts=assembly_sides(footprints,plan.get('assemblySides',{}),process)
    critical=signal_filter_relations(req.get('components',[]),expected,process)
    write(out/'signal-filter-placement.json',critical)
    critical.update({r['ref']:r for r in process.get('relations',[])})
    placed={};bodyboxes={};padboxes=[]
    power_pose=PowerPoseScore(board,process,plan,footprints)
    corridors=PowerCorridors(board,process,plan)
    def bbox(fp):
        pp=list(fp.Pads())
        if not pp:
            b=fp.GetBoundingBox(False,False);return tuple(map(pcb.ToMM,[b.GetX(),b.GetY(),b.GetRight(),b.GetBottom()]))
        bb=[p.GetBoundingBox() for p in pp]+[g.GetBoundingBox() for g in fp.GraphicalItems() if g.IsOnCopperLayer() or g.GetLayer() in (pcb.F_CrtYd,pcb.B_CrtYd,pcb.F_Fab,pcb.B_Fab)]
        return (min(pcb.ToMM(b.GetX()) for b in bb)-.35,min(pcb.ToMM(b.GetY()) for b in bb)-.35,max(pcb.ToMM(b.GetRight()) for b in bb)+.35,max(pcb.ToMM(b.GetBottom()) for b in bb)+.35)
    def overlaps(a,b,margin=0):return a[0]<b[2]+margin and a[2]>b[0]-margin and a[1]<b[3]+margin and a[3]>b[1]-margin
    def move(ref,x,y,rotation,side):
        fp=footprints[ref]
        if side not in ['F.Cu','B.Cu']:raise ValueError('Invalid assembly side '+ref)
        if (fp.GetLayer()==pcb.B_Cu)!=(side=='B.Cu'):fp.Flip(fp.GetPosition(),False)
        fp.SetOrientationDegrees(rotation);fp.SetPosition(point(x,y))
        return fp
    def register(ref):
        fp=footprints[ref];placed[ref]=tuple(map(pcb.ToMM,[fp.GetPosition().x,fp.GetPosition().y]));bodyboxes[ref]=(bbox(fp),fp.GetLayer(),bool(list(fp.Pads())))
        for p in fp.Pads():
            b=p.GetBoundingBox();padboxes.append((tuple(map(pcb.ToMM,[b.GetX(),b.GetY(),b.GetRight(),b.GetBottom()])),p.GetLayerSet(),ref))
    # Large bodies consume scarce contiguous board area. Reserve them before
    # small parts can fragment it; model order remains a tie-breaker only.
    # This uses measured/library envelopes, never reference-board placements.
    areas={ref:(lambda b:(b[2]-b[0])*(b[3]-b[1]))(bbox(footprints[ref])) for ref in order}
    rank={ref:i for i,ref in enumerate(order)}
    focus=set(req.get('routingFeedback',{}).get('nets',[]))
    focus_refs={ref for net in nets if net['name'] in focus for ref,pin in net['nodes']}
    typical=sorted(areas.values())[len(areas)//2]
    order=sorted(order,key=lambda ref:(0,-areas[ref],0,rank[ref]) if areas[ref]>4*typical else (1,0 if ref in focus_refs else 1,-areas[ref],rank[ref]))
    if critical:
        prior={ref:i for i,ref in enumerate(order)}
        order.sort(key=lambda ref:(0 if areas[ref]>4*typical else 1 if critical.get(ref,{}).get('kind')=='decoupling' else 2 if critical.get(ref,{}).get('kind')=='storage' else 3 if ref in critical else 4,prior[ref]))
        dependency_order=[]
        def visit(ref,trail=()):
            if ref in dependency_order:return
            if ref in trail:raise ValueError('Cyclic supply placement dependencies')
            if ref in critical:visit(critical[ref]['anchor']['ref'],trail+(ref,))
            dependency_order.append(ref)
        for ref in order:visit(ref)
        order=dependency_order
    write(out/'placement-order.json',{'requestedOrder':plan.get('order',[]),'effectiveOrder':order,'envelopeAreasMm2':areas,'routingFeedback':req.get('routingFeedback',{}),'method':'reserve large actual envelopes; prioritize DRC-unconnected endpoints; connectivity placement; no generated fixed datums'})
    # Fixed mechanical datums are honored; ordinary parts are newly placed by connectivity.
    for ref,spec in fixed.items():
        fp=move(ref,spec['xMm'],spec['yMm'],spec.get('rotation',0),spec.get('side',assembly.get(ref,'F.Cu')))
        if not (0<=spec['xMm']<=w and 0<=spec['yMm']<=h):raise ValueError(ref+' mechanical datum outside board')
        register(ref)
    for ref in order:
        if ref in fixed:continue
        fp=footprints[ref];side=assembly.get(ref,'F.Cu');neighbors=[]
        for n in nets:
            if any(x[0]==ref for x in n['nodes']):neighbors.extend(placed[a] for a,b in n['nodes'] if a in placed)
        target=(sum(x for x,y in neighbors)/len(neighbors),sum(y for x,y in neighbors)/len(neighbors)) if neighbors else (w/2,h/2)
        anchors={}
        for (owner,pin),net_name in expected.items():
            if owner in placed:
                anchors.setdefault(net_name,[]).extend((pcb.ToMM(q.GetPosition().x),pcb.ToMM(q.GetPosition().y)) for q in pads[(owner,pin)])
        real_anchors={name:list(points) for name,points in anchors.items()}
        # Look through unplaced series resistors when locating their controller.
        for candidate in comps:
            owner=candidate['ref']
            if owner in placed or not re.search(r'(?i)(?:ohm|Ω|\d\s*[RKM])',candidate['value']):continue
            linked={net_name for (r,pin),net_name in expected.items() if r==owner}
            if len(linked)!=2:continue
            a,b=sorted(linked)
            if a in real_anchors and b not in anchors:anchors[b]=real_anchors[a]
            if b in real_anchors and a not in anchors:anchors[a]=real_anchors[b]
        relation=critical.get(ref)
        relation_anchors=[]
        if relation:
            for role,pad_key in [('anchor','supplyPad'),('return','returnPad')]:
                endpoint=relation[role];owner=endpoint['ref']
                if owner not in placed:raise ValueError('Supply owner must be placed first: '+owner)
                points=[(pcb.ToMM(q.GetPosition().x),pcb.ToMM(q.GetPosition().y)) for q in pads[(owner,endpoint['pad'])]]
                member=pads[(ref,relation[pad_key])][0]
                if member.GetNetname()!=pads[(owner,endpoint['pad'])][0].GetNetname():raise ValueError('Supply relation does not match actual nets')
                anchors[member.GetNetname()]=points
                if role=='anchor':relation_anchors=points
        driver_nets={n['name'] for n in nets if len(n['nodes'])==2 and any(owner in placed and len({p.GetNumber() for p in footprints[owner].Pads()})>=8 for owner,pin in n['nodes'])}
        airwires=[]
        plane_nets={entry['name'] for entry in process.get('copperNets',[])}
        for net_name,points in real_anchors.items():
            # A copper domain is not a collection of imaginary straight wires.
            # Penalizing crossings of its arbitrary MST pushes signal branches
            # away from receivers even when the declared plane provides return.
            if net_name in plane_nets:continue
            points=list(dict.fromkeys(points));reached=points[:1];pending=points[1:]
            while pending:
                _,a,b=min((abs(a[0]-b[0])+abs(a[1]-b[1]),a,b) for a in reached for b in pending)
                airwires.append((a,b,net_name));reached.append(b);pending.remove(b)
        def crossing(a,b,c,d):
            def side(p,q,r):return (q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0])
            return side(a,b,c)*side(a,b,d)<-1e-8 and side(c,d,a)*side(c,d,b)<-1e-8
        foreign_corridors,corridor_lines=corridors.constraints()
        airwires.extend(corridor_lines)
        choices=[];geometry={}
        best=None
        for rotation in [0,90,180,270]:
            move(ref,0,0,rotation,side);box=bbox(fp)
            opposite=pcb.B_Cu if fp.GetLayer()==pcb.F_Cu else pcb.F_Cu
            through=[]
            for pad in fp.Pads():
                if not pad.GetLayerSet().Contains(opposite):continue
                b=pad.GetBoundingBox()
                through.append((tuple(map(pcb.ToMM,[b.GetX(),b.GetY(),b.GetRight(),b.GetBottom()])),pad.GetAttribute()==pcb.PAD_ATTRIB_PTH))
            terminals=[(pcb.ToMM(q.GetPosition().x),pcb.ToMM(q.GetPosition().y),anchors[q.GetNetname()],(6 if q.GetNetname() in driver_nets else .2 if re.search(r'GND|5V|VCC',q.GetNetname(),re.I) else 1)*(4 if q.GetNetname() in focus and areas[ref]<=4*typical else 1)) for q in fp.Pads() if q.GetNetname() in anchors]
            if relation:
                terminals=[(pcb.ToMM(q.GetPosition().x),pcb.ToMM(q.GetPosition().y),anchors[q.GetNetname()],30 if q.GetNumber()==relation['supplyPad'] else 3) for q in fp.Pads() if q.GetNetname() in anchors]
                source_pad=pads[(ref,relation['supplyPad'])][0]
                source_xy=tuple(map(pcb.ToMM,[source_pad.GetPosition().x,source_pad.GetPosition().y]))
            geometry[rotation]=[(pcb.ToMM(q.GetPosition().x),pcb.ToMM(q.GetPosition().y),q.GetNetname()) for q in fp.Pads() if q.GetNetname() in anchors]
            corridor_pad_shapes=corridors.pad_shapes(fp)
            rotation_choices=[]
            for ix in range(2,int(w-1)):
                for iy in range(2,int(h-1)):
                    a=(box[0]+ix,box[1]+iy,box[2]+ix,box[3]+iy)
                    if a[0]<.8 or a[1]<.8 or a[2]>w-.8 or a[3]>h-.8:continue
                    if any(haspads and layer==fp.GetLayer() and overlaps(a,b,gap) for b,layer,haspads in bodyboxes.values()):continue
                    if any(layers.Contains(fp.GetLayer()) and overlaps(a,b,.3) for b,layers,other in padboxes):continue
                    # A front-side through-hole or rear copper shape still
                    # occupies the rear layer. Check its actual translated
                    # pads against rear pads/courtyards before routing.
                    blocked=False
                    for pb,is_pth in through:
                        shifted=(pb[0]+ix,pb[1]+iy,pb[2]+ix,pb[3]+iy)
                        if any(layers.Contains(opposite) and overlaps(shifted,b,plan['clearanceMm']) for b,layers,other in padboxes) or (is_pth and any(layer==opposite and overlaps(shifted,b) for b,layer,haspads in bodyboxes.values())):
                            blocked=True;break
                    if blocked:continue
                    if corridors.blocked(corridor_pad_shapes,foreign_corridors,ix,iy):continue
                    if relation and relation.get('maxDistanceMm') is not None and min(math.hypot(ix+source_xy[0]-x,iy+source_xy[1]-y) for x,y in relation_anchors)>relation['maxDistanceMm']:continue
                    cost=sum(weight*min(abs(ix+px-tx)+abs(iy+py-ty) for tx,ty in points) for px,py,points,weight in terminals) if terminals else abs(ix+(box[0]+box[2])/2-target[0])+abs(iy+(box[1]+box[3])/2-target[1])
                    cost+=.0001*rotation
                    rotation_choices.append((cost,ix,iy,rotation))
            choices.extend(rotation_choices if relation and relation.get('kind') in ('decoupling','storage') else sorted(rotation_choices)[:80])
        if relation:choices=power_pose.score(ref,choices,relation,move,side)
        for cost,ix,iy,rotation in choices:
            penalty=0
            for px,py,net_name in geometry[rotation]:
                a=(ix+px,iy+py);b=min(anchors[net_name],key=lambda p:abs(a[0]-p[0])+abs(a[1]-p[1]))
                penalty+=sum(20 for c,d,other in airwires if other!=net_name and crossing(a,b,c,d))
                penalty+=sum(math.hypot(w,h) for c,d,other in corridor_lines if other!=net_name and crossing(a,b,c,d))
            score=cost+penalty
            if best is None or score<best[0]:best=(score,ix,iy,rotation)
        if best is None:
            write(out/'placement-failure.json',{'ref':ref,'relation':relation,'anchors':relation_anchors,'occupied':bodyboxes,'placed':placed})
            raise ValueError(ref+' 无可用布局空间；请调整机械约束')
        move(ref,*best[1:],side);register(ref)
        corridors.placed(ref,placed)
    write(out/'placement-power-corridors.json',{'reports':corridors.reports,'scope':'native supply and return corridors reserved during placement; no reference coordinates'})
    if req.get('placementOptimization') in ('coupled-compaction','coupled-critical'):
        snapshot={'boardMm':[w,h],'edgeMarginMm':.8,'componentGapMm':gap,'clearanceMm':plan['clearanceMm'],'priorityNets':req.get('optimizationFeedback',req.get('routingFeedback',{})).get('nets',[]),'parts':[],'nets':[],'relations':[]}
        protected=set()
        if corridors.generated:
            for relation in process.get('relations',[]):protected.update([relation['ref'],relation['anchor']['ref'],relation['return']['ref']])
            snapshot['staticCopper']=[]
            for track in board.GetTracks():
                box=track.GetBoundingBox();snapshot['staticCopper'].append({'net':track.GetNetname(),'layer':pcb.LayerName(track.GetLayer()),'boxMm':list(map(pcb.ToMM,[box.GetX(),box.GetY(),box.GetRight(),box.GetBottom()]))})
        if req['placementOptimization']=='coupled-critical':
            endpoints={ref for net in nets if net['name'] in snapshot['priorityNets'] for ref,pin in net['nodes']}
            snapshot['reorderParts']=sorted((set(critical)|endpoints)-protected-set(fixed))
        snapshot['preservedPowerParts']=sorted(protected)
        positions=lambda ps:[tuple(map(pcb.ToMM,[q.GetPosition().x,q.GetPosition().y])) for q in ps]
        for ref,fp in footprints.items():
            side=fp.GetLayer();other=pcb.B_Cu if side==pcb.F_Cu else pcb.F_Cu
            obstacles=[{'kind':'body','layer':pcb.LayerName(side),'boxMm':bbox(fp)}]
            for pad in fp.Pads():
                if pad.GetLayerSet().Contains(other):
                    box=pad.GetBoundingBox();obstacles.append({'kind':'pad','layer':pcb.LayerName(other),'boxMm':tuple(map(pcb.ToMM,[box.GetX(),box.GetY(),box.GetRight(),box.GetBottom()]))})
            copper_pads=[]
            for pad in fp.Pads():
                box=pad.GetBoundingBox();pb=list(map(pcb.ToMM,[box.GetX(),box.GetY(),box.GetRight(),box.GetBottom()]))
                for layer in [pcb.F_Cu,pcb.B_Cu]:
                    if pad.IsOnLayer(layer):copper_pads.append({'net':pad.GetNetname(),'layer':pcb.LayerName(layer),'boxMm':pb})
            snapshot['parts'].append({'ref':ref,'fixed':ref in fixed or ref in protected,'boundsMm':bbox(fp),'obstacles':obstacles,'copperPads':copper_pads})
        planes={n['name'] for n in process.get('copperNets',[])}
        for net in nets:
            terminals=[{'ref':ref,'atMm':xy} for ref,pin in net['nodes'] if (ref,pin) in pads for xy in positions(pads[(ref,pin)])]
            snapshot['nets'].append({'name':net['name'],'copper':net['name'] in planes,'terminals':terminals})
        for ref,relation in critical.items():
            for role,pad_key,weight in [('anchor','supplyPad',20),('return','returnPad',3)]:
                owner=relation[role]['ref'];pin=relation[role]['pad']
                pairs=[[a,b] for a in positions(pads[(ref,relation[pad_key])]) for b in positions(pads[(owner,pin)])]
                snapshot['relations'].append({'ref':ref,'owner':owner,'padPairsMm':pairs,'maxDistanceMm':relation.get('maxDistanceMm') if role=='anchor' else None,'weight':weight})
        write(out/'joint-placement-input.json',snapshot)
        # Reuse the configured schematic solver environment; pcbnew stays
        # in KiCad's interpreter and does not need a second OR-Tools install.
        run([req.get('solverPython',sys.executable),Path(__file__).with_name('pcb_compaction.py'),out/'joint-placement-input.json',out/'joint-placement-result.json'],out,60)
        compacted=read(out/'joint-placement-result.json')
        for ref,(dx,dy) in compacted['translations'].items():
            x,y=placed[ref];footprints[ref].SetPosition(point(x+dx,y+dy));placed[ref]=(x+dx,y+dy)
        if corridors.generated:
            foreign,_=corridors.constraints()
            for ref,fp in footprints.items():
                if ref not in protected and corridors.blocked(corridors.pad_shapes(fp),foreign,0,0):raise ValueError('Joint placement intersects reserved copper: '+ref)
        compacted['preservedPowerParts']=sorted(protected);compacted['preservedCorridorSegments']=len(corridors.generated)
        write(out/'joint-placement-result.json',compacted)
    write(out/'power-pose-candidates.json',power_pose.reports)
    power_placement=placement_report(board,process)
    if not power_placement['passed']:raise ValueError('PCB supply placement distance exceeded visible constraint')
    write(out/'process-result.json',{'inputs':process,'assembly':assembly_facts,'powerPlacement':power_placement})
    for ref,fp in footprints.items():
        box=fp.GetBoundingBox(False,False);a,b,c,d=map(pcb.ToMM,[box.GetX(),box.GetY(),box.GetRight(),box.GetBottom()]);fp.Reference().SetPosition(point((a+c)/2,b-.8));fp.Reference().SetTextAngle(pcb.EDA_ANGLE(0,pcb.DEGREES_T))
    write(out/'placement-result.json',{ref:{'xMm':xy[0],'yMm':xy[1],'rotation':footprints[ref].GetOrientationDegrees(),'side':pcb.LayerName(footprints[ref].GetLayer()),'fixed':ref in fixed} for ref,xy in placed.items()})
    libs=sorted({c['footprint'].split(':')[0] for c in comps})
    (project/'fp-lib-table').write_text('(fp_lib_table\n'+''.join(f'(lib (name "{lib}")(type KiCad)(uri "${{KIPRJMOD}}/{lib}.pretty")(options "")(descr ""))\n' for lib in libs)+')\n',encoding='utf-8')
    pcb.SaveBoard(str(boardfile),board)
    # KiCad project settings are stored in SQLite as well as their native export.
    pro=sch.with_suffix('.kicad_pro');config=read(pro) if pro.exists() else {}
    config.setdefault('board',{}).setdefault('design_settings',{}).setdefault('rules',{}).update({'min_clearance':plan['clearanceMm'],'min_track_width':plan['trackWidthMm'],'min_copper_edge_clearance':.5})
    config.setdefault('net_settings',{})['classes']=[{'name':'Default','clearance':plan['clearanceMm'],'track_width':plan['trackWidthMm'],'via_diameter':.8,'via_drill':.4}]
    write(pro,config)
    dsn=boardfile.with_suffix('.dsn');ses=boardfile.with_suffix('.ses')
    # DSN has no component-internal jumper connectivity. Represent ONLY declared
    # native jumper groups as protected temporary bridges, then remove them from
    # the imported copper. KiCad DRC must validate the real jumper-pad semantics.
    virtual=[]
    for ref,groups in bridges.items():
        for group in groups:
            terminals=[pads[(ref,str(number))][0] for number in group]
            if len({p.GetNetCode() for p in terminals})!=1 or terminals[0].GetNetCode()==0:raise ValueError('Invalid jumper net group '+ref)
            virtual_layer=pcb.F_Cu if footprints[ref].GetLayer()==pcb.B_Cu else pcb.B_Cu
            for a,b in zip(terminals,terminals[1:]):
                track=pcb.PCB_TRACK(board);track.SetStart(a.GetPosition());track.SetEnd(b.GetPosition());track.SetWidth(pcb.FromMM(.1));track.SetLayer(virtual_layer);track.SetNet(a.GetNet());track.SetLocked(True);board.Add(track)
                virtual.append({'kind':'track','net':a.GetNetname(),'layer':virtual_layer,'a':[a.GetPosition().x,a.GetPosition().y],'b':[b.GetPosition().x,b.GetPosition().y],'ref':ref})
            for pad in terminals:
                via=pcb.PCB_VIA(board);via.SetPosition(pad.GetPosition());via.SetWidth(pcb.FromMM(.2));via.SetDrill(pcb.FromMM(.1));via.SetLayerPair(pcb.F_Cu,pcb.B_Cu);via.SetNet(pad.GetNet());via.SetLocked(True);board.Add(via)
                virtual.append({'kind':'via','net':pad.GetNetname(),'a':[pad.GetPosition().x,pad.GetPosition().y],'ref':ref})
    write(out/'jumper-routing-abstractions.json',virtual)
    if not pcb.ExportSpecctraDSN(board,str(dsn)):raise ValueError('DSN export failed')
    active=plan.get('activeLayers',['F.Cu','B.Cu'])
    if not active or set(active)-{'F.Cu','B.Cu'}:raise ValueError('Unsupported routing layers')
    router_rules='(autoroute_settings (fanout off)(autoroute on)(postroute on)(vias '+('on' if plan.get('allowVias',True) else 'off')+')'+''.join('(layer_rule "'+layer+'" (active '+('on' if layer in active else 'off')+')(preferred_direction horizontal))' for layer in ['F.Cu','B.Cu'])+')'
    obstacles=[]
    for fp in board.GetFootprints():
        for g in fp.GraphicalItems():
            if not g.IsOnCopperLayer():continue
            b=g.GetBoundingBox();x0,y0,x1,y1=map(lambda n:pcb.ToMM(n)*1000,[b.GetX(),b.GetY(),b.GetRight(),b.GetBottom()]);layer=pcb.LayerName(g.GetLayer())
            obstacles.append(f'(keepout (rect {layer} {x0} {-y1} {x1} {-y0}))')
    text=dsn.read_text(encoding='utf-8');text=text.replace('(boundary',router_rules+'\n'+'\n'.join(obstacles)+'\n    (boundary',1);dsn.write_text(text)

    routed=run([req['java'],'-Xmx2048m','-Djava.awt.headless=true','-cp',str(Path(__file__).resolve().parents[1]/'vendor')+os.pathsep+req['jar'],'DshRouter',dsn,ses,'200'],project,240)
    (project/'routing.log').write_text(routed.stdout+'\n'+routed.stderr,encoding='utf-8')
    if not ses.is_file():raise ValueError('Freerouting 未生成路由结果：'+routed.stderr[-1500:])
    if not pcb.ImportSpecctraSES(board,str(ses)):raise ValueError('SES import failed')
    def near(pos,xy):return abs(pos.x-xy[0])<=200 and abs(pos.y-xy[1])<=200
    removed=0
    for t in list(board.GetTracks()):
        for v in virtual:
            if t.GetNetname()!=v['net']:continue
            hit=isinstance(t,pcb.PCB_VIA) and v['kind']=='via' and near(t.GetPosition(),v['a'])
            if not isinstance(t,pcb.PCB_VIA) and v['kind']=='track' and t.GetLayer()==v['layer']:
                hit=(near(t.GetStart(),v['a']) and near(t.GetEnd(),v['b'])) or (near(t.GetStart(),v['b']) and near(t.GetEnd(),v['a']))
            if hit:board.Remove(t);removed+=1;break
    write(out/'jumper-routing-removal.json',{'temporaryItems':len(virtual),'removed':removed,'physicalJumperGroups':sum(map(len,bridges.values()))})
    power_corridors=corridors.release_generated_locks()
    write(out/'power-corridor-result.json',power_corridors)
    copper=add_copper(board,process,plan)
    cleanup=remove_redundant_tracks(board)
    cleanup['collinear']=merge_collinear_tracks(board)
    write(out/'copper-route-cleanup.json',cleanup)
    refresh_copper_report(board,copper)
    write(out/'copper-result.json',copper)
    pcb.SaveBoard(str(boardfile),board)
    # Reopen native PCB and verify every source net assignment; DRC checks copper connectivity.
    loaded=pcb.LoadBoard(str(boardfile))
    if any(pcb.LayerName(t.GetLayer()) not in active for t in loaded.GetTracks() if not isinstance(t,pcb.PCB_VIA)):raise ValueError('Router used forbidden copper layer')
    if not plan.get('allowVias',True) and any(isinstance(t,pcb.PCB_VIA) for t in loaded.GetTracks()):raise ValueError('Router added forbidden vias')
    verified_physical_pads=verify_pad_assignments(loaded,expected)
    if len(list(loaded.GetFootprints()))!=len(comps):raise ValueError('PCB component count mismatch')
    explicit_nc=set(req.get('nc',[]));pad_rows=[]
    for fp in loaded.GetFootprints():
        for index,pad in enumerate(fp.Pads()):
            pin=pad.GetNumber();ref=fp.GetReference()
            status='auxiliary' if not pin else 'NC' if ref+'.'+pin in explicit_nc else 'connected' if pad.GetNetCode()!=0 else 'unassigned'
            pad_rows.append([ref,index,pin,status,pad.GetNetname(),pcb.ToMM(pad.GetPosition().x),pcb.ToMM(pad.GetPosition().y)])
    with (project/'PCB-pad-map.csv').open('w',encoding='utf-8-sig',newline='') as stream:
        writer=csv.writer(stream);writer.writerow(['Reference','PhysicalPadIndex','PinAndPadNumber','Status','Net','GeneratedXmm','GeneratedYmm']);writer.writerows(pad_rows)
    report=project/'drc.rpt';adjustments=[]
    for attempt in range(4):
        run([req['cli'],'pcb','drc','--schematic-parity','--format','report','--severity-all','--exit-code-violations','-o',report,boardfile],project)
        report_text=report.read_text(encoding='utf-8-sig')
        if attempt==3:break
        moved=resolve_silk_collisions(loaded,report_text)
        if not moved:break
        shutil.copyfile(report,project/('drc-before-silk-'+str(attempt)+'.rpt'));adjustments.extend(moved)
        for ref in {r['reference'] for r in moved}:
            fp=next(f for f in loaded.GetFootprints() if f.GetReference()==ref);local=pcb.FOOTPRINT(fp);local.SetPosition(point(0,0))
            if local.GetLayer()==pcb.B_Cu:local.Flip(point(0,0),False)
            local.SetOrientationDegrees(0)
            ident=str(fp.GetFPID().GetLibNickname());name=str(fp.GetFPID().GetLibItemName())
            pcb.FootprintSave(str(project/(ident+'.pretty')),local)
        pcb.SaveBoard(str(boardfile),loaded)
    write(project/'silkscreen-adjustments.json',adjustments)
    drc=parse_drc(report_text)
    simplification={'adopted':False,'reason':'native DRC must pass before trace optimization'}
    if drc['passed']:
        backup=out/'route-before-simplification.kicad_pcb';shutil.copyfile(boardfile,backup)
        before_drc=copy.deepcopy(drc);before_report=report_text;before_quality=route_metrics(loaded)
        try:
            proposal=shorten_tracks(loaded,plan['clearanceMm'],.5)
            simplification={**proposal,'adopted':False,'before':before_quality}
            if proposal['changes']:
                pcb.SaveBoard(str(boardfile),loaded)
                run([req['cli'],'pcb','drc','--schematic-parity','--format','report','--severity-all','--exit-code-violations','-o',report,boardfile],project)
                after_text=report.read_text(encoding='utf-8-sig');after_drc=parse_drc(after_text)
                after_quality=route_metrics(loaded);verify_pad_assignments(loaded,expected)
                adopted=after_drc['passed'] and after_drc['warnings']<=before_drc['warnings'] and quality_dominates(after_quality,before_quality)
                simplification.update({'adopted':adopted,'candidateDrc':after_drc,'after':after_quality})
                if adopted:drc=after_drc;report_text=after_text
                else:
                    shutil.copyfile(boardfile,out/'rejected-route-simplification.kicad_pcb')
                    shutil.copyfile(backup,boardfile);loaded=pcb.LoadBoard(str(boardfile))
                    report.write_text(before_report,encoding='utf-8');report_text=before_report;drc=before_drc
        except Exception as error:
            shutil.copyfile(backup,boardfile);loaded=pcb.LoadBoard(str(boardfile))
            report.write_text(before_report,encoding='utf-8');report_text=before_report;drc=before_drc
            simplification={'adopted':False,'reason':'kept previous complete native board','error':str(error),'before':before_quality}
    write(out/'trace-simplification.json',simplification)
    write(project/'drc.json',drc)
    # Refilling after a shortcut can alter island geometry. Report the selected
    # native board, including when a rejected proposal was restored.
    refresh_copper_report(loaded,copper)
    write(out/'copper-result.json',copper)
    export_views(req,project,boardfile)
    write(out/'pcb-result.json',{'board':'project/'+boardfile.name,'pdf':'project/PCB.pdf','previews':['project/PCB-Front.svg','project/PCB-Back.svg'],'drc':drc,'components':len(comps),'nets':len(nets),'tracks':len(list(loaded.GetTracks())),'routingQuality':route_metrics(loaded),'traceSimplification':simplification,'copperRouteCleanup':cleanup,'netMappingVerified':verified_physical_pads,'logicalPinsVerified':len(expected),'footprintImports':len(bindings),'plan':plan,'process':{'powerCorridors':power_corridors,'assembly':assembly_facts,'powerPlacement':power_placement,'copper':copper,'jumpers':process.get('jumpers',[])}})

def export_views(req,project,boardfile):
    svg=project/'PCB.svg';pdf=project/'PCB.pdf'
    run([req['cli'],'pcb','export','svg','--layers','F.Cu,B.Cu,F.SilkS,B.SilkS,F.Fab,B.Fab,F.CrtYd,B.CrtYd,Edge.Cuts','--mode-single','--fit-page-to-board','--exclude-drawing-sheet','-o',svg,boardfile],project)
    run([req['cli'],'pcb','export','pdf','--scale','0','--layers','F.Cu,B.Cu,F.SilkS,B.SilkS,F.Fab,B.Fab,F.CrtYd,B.CrtYd,Edge.Cuts','--mode-single','-o',pdf,boardfile],project)
    for label,layers,mirrored in [('Front','F.Cu,F.SilkS,F.Fab,F.CrtYd,Edge.Cuts',False),('Back','B.Cu,B.SilkS,B.Fab,B.CrtYd,Edge.Cuts',True)]:
        for kind in ['svg','pdf']:
            args=[req['cli'],'pcb','export',kind,'--layers',layers,'--mode-single']
            if kind=='svg':args+=['--fit-page-to-board','--exclude-drawing-sheet']
            else:args+=['--scale','0']
            if mirrored:args+=['--mirror']
            run(args+['-o',project/('PCB-'+label+'.'+kind),boardfile],project)


def build_candidate(req):
    """Isolate native board lifetimes and bound the entire candidate process tree."""
    out=Path(req['output']);request=out/'request.json';write(request,req)
    args=[sys.executable,str(Path(__file__).resolve()),'--candidate',str(request)]
    p=subprocess.Popen(args,cwd=out,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf-8',errors='replace',creationflags=0x08000000 if os.name=='nt' else 0,start_new_session=os.name!='nt')
    timed_out=False
    try:stdout,stderr=p.communicate(timeout=min(300,max(15,float(req.get('_candidateTimeoutSeconds',300)))))
    except subprocess.TimeoutExpired:
        timed_out=True
        if os.name=='nt':subprocess.run(['taskkill','/PID',str(p.pid),'/T','/F'],capture_output=True,timeout=15)
        else:
            import signal
            os.killpg(p.pid,signal.SIGKILL)
        stdout,stderr=p.communicate(timeout=15)
    write(out/'candidate-process.json',{'exitCode':p.returncode,'timedOut':timed_out,'stdout':stdout[-20000:],'stderr':stderr[-20000:]})
    if timed_out:raise TimeoutError('单个布局候选超过运行时限；已保留此前完成的候选')
    if p.returncode:raise RuntimeError('原生布局候选进程退出 '+str(p.returncode)+': '+(stderr or stdout)[-1200:])

def publish_candidate(req,best,attempts,repair_runs,history_runs,checkpoint=False):
    out=Path(req['output']);minimum=req['plan'].get('componentGapMm',2.0)
    candidate,original=best;result=copy.deepcopy(original);selected=Path(candidate['output'])
    shutil.copytree(selected/'project',out/'project',dirs_exist_ok=True)
    for name in ['placement-result.json','placement-order.json','signal-filter-placement.json','copper-route-cleanup.json','jumper-routing-abstractions.json','jumper-routing-removal.json','process-result.json','copper-result.json']:
        write(out/name,read(selected/name))
    if (selected/'trace-simplification.json').exists():write(out/'trace-simplification.json',read(selected/'trace-simplification.json'))
    for name in ['power-pose-candidates.json','placement-power-corridors.json','power-corridor-result.json']:
        if (selected/name).exists():write(out/name,read(selected/name))
    if (selected/'local-repair.json').exists():
        write(out/'local-repair.json',read(selected/'local-repair.json'))
        shutil.copytree(selected/'postroute-repair',out/'postroute-repair',dirs_exist_ok=True)
    result['selectedPlacementOptimization']=candidate.get('placementOptimization','greedy')
    if (selected/'joint-placement-result.json').exists():write(out/'joint-placement-result.json',read(selected/'joint-placement-result.json'))
    result['requestedPlan']=req['plan'];result['layoutAttempts']=attempts;result['selectedComponentGapMm']=candidate['plan'].get('componentGapMm',minimum)
    result['localRepairSearch']=repair_runs
    result['historyCandidates']=history_runs
    result.setdefault('selectedCandidateSource',{'kind':'fresh-generated'})
    write(out/'history-candidates.json',history_runs)
    result['generationStatus']='checkpoint' if checkpoint else 'complete'
    write(out/'pcb-result.json',result)

def generate_with_refinement(req):
    out=Path(req['output']);minimum=req['plan'].get('componentGapMm',2.0)
    search=FeedbackSearch(minimum,bool(req.get('process',{}).get('relations')),[n['name'] for n in req.get('process',{}).get('copperNets',[])])
    attempts=[];best=None;completed=[];history_runs=[];checkpoint_saved=False;started=time.monotonic();pending_quality=None;quality_phase=False;quality_attempts=0;pending_repair=None;repair_attempts=0
    while True:
        remaining=480-(time.monotonic()-started)
        if remaining<15:
            write(out/'search-budget.json',{'exhausted':True,'limitSeconds':480,'hasCompletedCandidate':best is not None})
            break
        if pending_repair is not None:
            variant=pending_repair;pending_repair=None;repair_attempts+=1
        elif quality_phase:
            if pending_quality is None:break
            variant=pending_quality;pending_quality=None;quality_attempts+=1
        else:
            variant=search.next()
            if variant is None:break
        index=len(attempts);gap=variant['componentGapMm']
        candidate=copy.deepcopy(req);candidate['plan']['componentGapMm']=gap;candidate['routingFeedback']={'nets':variant['nets']}
        if variant.get('placementOptimization'):candidate['placementOptimization']=variant['placementOptimization']
        if variant.get('optimizationFeedback'):candidate['optimizationFeedback']=variant['optimizationFeedback']
        # Use the full output path as identity without repeating its UUID in
        # the scratch path. Long library and footprint names must still fit
        # Windows file-copy APIs in ordinary project directories.
        work_id=hashlib.sha256(str(out.resolve()).encode('utf8')).hexdigest()[:20]
        candidate['output']=str(out.parent.parent.parent/'pcb-work'/work_id/str(index+1));Path(candidate['output']).mkdir(parents=True,exist_ok=True)
        candidate['_candidateTimeoutSeconds']=min(300,remaining)
        write(Path(candidate['output'])/'request.json',candidate)
        print('PCB layout attempt '+str(index+1)+': component gap '+str(gap)+' mm',flush=True)
        try:
            build_candidate(candidate);result=read(Path(candidate['output'])/'pcb-result.json')
            completed.append((candidate,result))
            if 'copper' in result.get('process',{}):
                search.bind_native_copper(result['process']['copper']['zones'])
            entry={'attempt':index+1,'componentGapMm':gap,'routingFeedback':candidate['routingFeedback'],'drc':result['drc'],'routingQuality':result['routingQuality'],'placementOptimization':candidate.get('placementOptimization','greedy'),'optimizationFeedback':candidate.get('optimizationFeedback',{})};attempts.append(entry)
            improved=prefer_candidate(result,best[1] if best else None)
            entry['selectedAsBest']=improved
            if improved:best=(candidate,result)
            if len(completed)==1:
                for history_index,(previous,previous_result) in enumerate(prior_candidates(req)):
                    history_out=Path(candidate['output']).parent/('history-'+str(history_index+1))
                    history_row={'sourceRun':previous.name,'adopted':False}
                    try:
                        prepared,compatibility=prepare_candidate(req,candidate,previous,previous_result,history_out)
                        history_row['compatibility']=compatibility
                        if prepared:
                            history_request,history_result=prepared
                            history_result=repair_selected(history_request,history_result)
                            history_row.update({'drc':history_result['drc'],'routingQuality':history_result['routingQuality'],'adopted':history_result.get('localRepair',{}).get('adopted',False)})
                            if history_row['adopted'] and history_result['drc']['passed'] and prefer_candidate(history_result,best[1]):
                                history_result['selectedCandidateSource']={'kind':'revalidated-generated-history','sourceRun':previous.name}
                                best=(history_request,history_result)
                    except Exception as error:history_row['reason']=str(error)
                    history_runs.append(history_row);write(out/'history-candidates.json',history_runs)
            if best[1]['drc']['passed'] and not best[1]['drc']['warnings'] and not checkpoint_saved:
                publish_candidate(req,best,attempts,[],history_runs,checkpoint=True);checkpoint_saved=True
            # An independently revalidated historical board is also a complete
            # incumbent: search for quality improvements instead of spending the
            # remaining disconnected-layout frontier.
            if result['drc']['passed'] or best[1]['drc']['passed'] and not quality_phase:
                pending_repair=None
                if not quality_phase:
                    quality_phase=True
                    if not candidate.get('placementOptimization'):
                        pending_quality={**variant,'placementOptimization':'coupled-compaction'}
                continue
            report=(Path(candidate['output'])/'project/drc.rpt').read_text(encoding='utf-8-sig')
            unconnected=re.findall(r'\[unconnected_items\]:([\s\S]*?)(?=\n\[|\n\*\*|\Z)',report)
            names=[name for block in unconnected for name in re.findall(r'\[([^\]]+)\]',block)]
            if quality_phase and names and quality_attempts<3:
                focus=sorted(set(names)|set(variant.get('optimizationFeedback',{}).get('nets',[])))
                if focus!=variant.get('optimizationFeedback',{}).get('nets',[]):
                    pending_quality={**variant,'optimizationFeedback':{'nets':focus}}
            else:
                search.feedback(variant,names)
                related=bool(req.get('process',{}).get('relations')) or bool(read(Path(candidate['output'])/'signal-filter-placement.json'))
                if not quality_phase and related and names and repair_attempts<2:
                    focus=sorted(set(names)-search.copper or set(names))
                    previous=set(variant.get('optimizationFeedback',{}).get('nets',[]))
                    if candidate.get('placementOptimization')!='coupled-critical' or not set(focus)<=previous:
                        pending_repair={**variant,'placementOptimization':'coupled-critical','optimizationFeedback':{'nets':sorted(previous|set(focus))}}
        except Exception as error:
            attempts.append({'attempt':index+1,'componentGapMm':gap,'error':str(error)})
        write(out/'layout-attempts.json',attempts)
    write(out/'layout-attempts.json',attempts)
    if best is None:raise ValueError('No PCB candidate completed: '+str(attempts))
    repair_runs=[]
    if not best[1]['drc']['passed']:
        deadline=min(time.monotonic()+360,started+780)
        seeds=repair_shortlist(completed)
        for seed_index,(seed,seed_result) in enumerate(seeds):
            remaining=deadline-time.monotonic()
            if remaining<15:break
            budget=repair_time_budget(remaining,len(seeds)-seed_index)
            if not budget:break
            local=copy.deepcopy(seed);local['_localRepairSeconds']=budget
            print('PCB local repair seed: '+str(Path(seed['output']).name),flush=True)
            repaired=repair_selected(local,seed_result)
            repair_runs.append({'attempt':int(Path(seed['output']).name),'adopted':repaired.get('localRepair',{}).get('adopted',False),'drc':repaired['drc'],'routingQuality':repaired['routingQuality'],'reason':repaired.get('localRepair',{}).get('reason')})
            if prefer_candidate(repaired,best[1]):best=(seed,repaired)
            if repaired['drc']['passed']:break
    write(out/'local-repair-search.json',repair_runs)
    publish_candidate(req,best,attempts,repair_runs,history_runs)

def repair_selected(req,result):
    """Repair the best incomplete board once, then refresh all selected evidence."""
    out=Path(req['output']);project=out/'project';work=out/'postroute-repair';work.mkdir(exist_ok=True)
    request_file=work/'repair-request.json';write(request_file,req)
    summary={'adopted':False};boardfile=project/Path(req['schematic']).with_suffix('.kicad_pcb').name
    original_result=copy.deepcopy(result);rollback={};committing=False
    try:
        run([sys.executable,Path(__file__).with_name('pcb_repair_flow.py'),request_file,project,work],out,330)
        summary=read(work/'result.json')
        if summary.get('adopted'):
            candidate=Path(summary['candidate']);candidate_file=candidate/boardfile.name;loaded=pcb.LoadBoard(str(candidate_file))
            comps,nets=netlist(req['cli'],project/req['schematic']);expected={(ref,pin):net['name'] for net in nets for ref,pin in net['nodes']}
            verified=verify_pad_assignments(loaded,expected)
            if len(list(loaded.GetFootprints()))!=len(comps):raise ValueError('Local repair changed component count')
            process_info=read(out/'process-result.json');power=placement_report(loaded,process_info['inputs'])
            if not power['passed']:raise ValueError('Local repair violates visible supply distance')
            report=candidate/'drc.rpt'
            run([req['cli'],'pcb','drc','--schematic-parity','--format','report','--severity-all','--exit-code-violations','-o',report,candidate_file],candidate)
            drc=parse_drc(report.read_text(encoding='utf-8-sig'))
            if not drc['passed'] or drc['warnings']:raise ValueError('Final local repair DRC did not pass')
            # Previews are generated from the candidate before it can replace
            # the selected native file; an export failure retains the original.
            export_views(req,candidate,candidate_file)
            shutil.copyfile(boardfile,work/'before-selected-repair.kicad_pcb')
            touched=[project/name for name in [boardfile.name,'drc.rpt','drc.json','PCB.svg','PCB.pdf','PCB-Front.svg','PCB-Front.pdf','PCB-Back.svg','PCB-Back.pdf','PCB-pad-map.csv']]
            touched += [out/name for name in ['placement-result.json','copper-result.json','process-result.json','trace-simplification.json']]
            rollback={file:file.read_bytes() if file.exists() else None for file in touched};committing=True
            for name in [boardfile.name,'drc.rpt','PCB.svg','PCB.pdf','PCB-Front.svg','PCB-Front.pdf','PCB-Back.svg','PCB-Back.pdf']:
                shutil.copyfile(candidate/name,project/name)
            placements={fp.GetReference():{'xMm':pcb.ToMM(fp.GetPosition().x),'yMm':pcb.ToMM(fp.GetPosition().y),'rotation':fp.GetOrientationDegrees(),'side':pcb.LayerName(fp.GetLayer()),'fixed':fp.GetReference() in req['plan'].get('placements',{})} for fp in loaded.GetFootprints()}
            write(out/'placement-result.json',placements)
            explicit_nc=set(req.get('nc',[]));rows=[]
            for fp in loaded.GetFootprints():
                for index,pad in enumerate(fp.Pads()):
                    pin=pad.GetNumber();ref=fp.GetReference();status='auxiliary' if not pin else 'NC' if ref+'.'+pin in explicit_nc else 'connected' if pad.GetNetCode() else 'unassigned'
                    rows.append([ref,index,pin,status,pad.GetNetname(),pcb.ToMM(pad.GetPosition().x),pcb.ToMM(pad.GetPosition().y)])
            with (project/'PCB-pad-map.csv').open('w',encoding='utf-8-sig',newline='') as stream:
                writer=csv.writer(stream);writer.writerow(['Reference','PhysicalPadIndex','PinAndPadNumber','Status','Net','GeneratedXmm','GeneratedYmm']);writer.writerows(rows)
            copper=read(out/'copper-result.json');refresh_copper_report(loaded,copper);write(out/'copper-result.json',copper)
            process_info['powerPlacement']=power;write(out/'process-result.json',process_info);write(project/'drc.json',drc)
            result=copy.deepcopy(result);result.update({'drc':drc,'tracks':len(list(loaded.GetTracks())),'routingQuality':route_metrics(loaded),'netMappingVerified':verified})
            result['process']['powerPlacement']=power;result['process']['copper']=copper
            if summary.get('simplification',{}).get('passed'):
                result['traceSimplification']=summary['simplification'];write(out/'trace-simplification.json',summary['simplification'])
    except Exception as error:
        if committing:
            for file,data in rollback.items():
                if data is None:file.unlink(missing_ok=True)
                else:file.write_bytes(data)
            result=original_result
        summary={'adopted':False,'reason':'kept selected candidate; local repair failed','error':str(error)}
    write(out/'local-repair.json',summary);result['localRepair']=summary;write(out/'pcb-result.json',result);return result

if __name__=='__main__':
    if len(sys.argv)>2 and sys.argv[1]=='--candidate':build(read(sys.argv[2]))
    else:generate_with_refinement(read(sys.argv[1]))
