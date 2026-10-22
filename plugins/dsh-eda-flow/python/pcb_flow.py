"""Generic KiCad PCB generation from the current schematic, never historical CAD.
All structured exchanges use record_io; native DRC output is a text report.
"""
import sys, os, re, math, shutil, subprocess, xml.etree.ElementTree as ET
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'mcp'))
from record_io import read_json as read, write_json as write
import pcbnew as pcb

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

def netlist(cli,sch):
    dest=sch.parent/'pcb-netlist.xml'
    run([cli,'sch','export','netlist','--format','kicadxml','-o',dest,sch],sch.parent)
    root=ET.parse(dest).getroot(); comps=[]
    for c in root.findall('./components/comp'):
        if c.get('ref','').startswith('#') or any(x.get('name')=='exclude_from_board' for x in c.findall('property')):continue
        comps.append({'ref':c.get('ref'),'value':c.findtext('value',''),'footprint':c.findtext('footprint',''),'uuid':c.findtext('tstamps',''),'sheet':c.find('sheetpath').get('tstamps','') if c.find('sheetpath') is not None else ''})
    nets=[{'name':n.get('name'),'nodes':[(x.get('ref'),x.get('pin')) for x in n.findall('node')]} for n in root.findall('./nets/net')]
    return comps,nets

def build(req):
    out=Path(req['output']);project=out/'project';shutil.copytree(req['source'],project,dirs_exist_ok=True)
    sch=project/req['schematic'];boardfile=sch.with_suffix('.kicad_pcb');comps,nets=netlist(req['cli'],sch)
    plan=req['plan']; w,h=plan['widthMm'],plan['heightMm'];gap=plan.get('componentGapMm',2.0)
    for v in [w,h,gap,plan['clearanceMm'],plan['trackWidthMm']]:
        if not isinstance(v,(int,float)) or not math.isfinite(v) or v<=0:raise ValueError('Invalid PCB dimensions or rules')
    if w>500 or h>500 or gap<1:raise ValueError('Board exceeds supported size or component gap below 1mm')
    board=pcb.BOARD();board.SetCopperLayerCount(2)
    settings=board.GetDesignSettings();settings.m_MinClearance=pcb.FromMM(plan['clearanceMm']);settings.m_TrackMinWidth=pcb.FromMM(plan['trackWidthMm']);settings.m_CopperEdgeClearance=pcb.FromMM(0.5)
    nc=board.GetAllNetClasses()['Default'];nc.SetClearance(pcb.FromMM(plan['clearanceMm']));nc.SetTrackWidth(pcb.FromMM(plan['trackWidthMm']));nc.SetViaDiameter(pcb.FromMM(0.8));nc.SetViaDrill(pcb.FromMM(0.4))
    point=lambda x,y:pcb.VECTOR2I(pcb.FromMM(x),pcb.FromMM(y))
    for a,b in [((0,0),(w,0)),((w,0),(w,h)),((w,h),(0,h)),((0,h),(0,0))]:
        shape=pcb.PCB_SHAPE();shape.SetShape(pcb.SHAPE_T_SEGMENT);shape.SetLayer(pcb.Edge_Cuts);shape.SetWidth(pcb.FromMM(.05));shape.SetStart(point(*a));shape.SetEnd(point(*b));board.Add(shape)
    pads={}; footprints={}; missing=[];fpRoot=Path(req['footprints'])
    for c in comps:
        if ':' not in c['footprint']:missing.append(c['ref']+' 缺少可读取的 KiCad 封装');continue
        lib,name=c['footprint'].split(':',1)
        if any(x in lib+name for x in ['..','/','\\']):raise ValueError('Invalid library identifier')
        candidates=[project/(lib+'.pretty'),fpRoot/(lib+'.pretty')]
        library=next((x for x in candidates if (x/(name+'.kicad_mod')).is_file()),None)
        if not library:missing.append(c['ref']+' 找不到封装 '+c['footprint']);continue
        fp=pcb.FootprintLoad(str(library),name)
        if not fp:raise ValueError('Cannot load footprint '+c['footprint'])
        fp.SetReference(c['ref']);fp.SetValue(c['value']);board.Add(fp);footprints[c['ref']]=fp
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
    x=y=3.;row=0.;boxes=[]
    fixed=plan.get('placements',{})
    if fixed and set(fixed)!=set(footprints):raise ValueError('Explicit placement must cover every component')
    for ref in order:
        fp=footprints[ref];spec=fixed.get(ref)
        fp.SetOrientationDegrees(spec.get('rotation',0) if spec else 0)
        box=fp.GetBoundingBox(False,False);bw=pcb.ToMM(box.GetWidth());bh=pcb.ToMM(box.GetHeight())
        if spec:fp.SetPosition(point(spec['xMm'],spec['yMm']))
        else:
            if x+bw>w-3:x=3.;y+=row+gap;row=0.
            if y+bh>h-3:raise ValueError('实际封装无法放入板框；请增大板框或提供布局约束')
            fp.SetPosition(point(x-pcb.ToMM(box.GetX()),y-pcb.ToMM(box.GetY())));x+=bw+gap;row=max(row,bh)
        box=fp.GetBoundingBox(False,False);a,b,c,d=map(pcb.ToMM,[box.GetX(),box.GetY(),box.GetRight(),box.GetBottom()])
        if a<1 or b<1 or c>w-1 or d>h-1:raise ValueError(ref+' 超出板框安全边界')
        if any(a<oc+gap and c>oa-gap and b<od+gap and d>ob-gap for oa,ob,oc,od in boxes):raise ValueError(ref+' 与其他封装间距不足')
        boxes.append((a,b,c,d));fp.Reference().SetPosition(point((a+c)/2,b-0.8))
    libs=sorted({c['footprint'].split(':')[0] for c in comps})
    (project/'fp-lib-table').write_text('(fp_lib_table\n'+''.join(f'(lib (name "{lib}")(type KiCad)(uri "${{KIPRJMOD}}/{lib}.pretty")(options "")(descr ""))\n' for lib in libs)+')\n',encoding='utf-8')
    pcb.SaveBoard(str(boardfile),board)
    # KiCad project settings are stored in SQLite as well as their native export.
    pro=sch.with_suffix('.kicad_pro');config=read(pro) if pro.exists() else {}
    config.setdefault('board',{}).setdefault('design_settings',{}).setdefault('rules',{}).update({'min_clearance':plan['clearanceMm'],'min_track_width':plan['trackWidthMm'],'min_copper_edge_clearance':.5})
    config.setdefault('net_settings',{})['classes']=[{'name':'Default','clearance':plan['clearanceMm'],'track_width':plan['trackWidthMm'],'via_diameter':.8,'via_drill':.4}]
    write(pro,config)
    dsn=boardfile.with_suffix('.dsn');ses=boardfile.with_suffix('.ses')
    if not pcb.ExportSpecctraDSN(board,str(dsn)):raise ValueError('DSN export failed')
    routed=run([req['java'],'-Djava.awt.headless=true','-jar',req['jar'],'-de',dsn,'-do',ses,'-mp','20','-mt','1','-da','--user_data_path='+str(out/'router-settings'),'--gui.enabled=false','--api_server.enabled=false','-l','en'],project,300)
    (project/'routing.log').write_text(routed.stdout+'\n'+routed.stderr,encoding='utf-8')
    if not ses.is_file():raise ValueError('Freerouting 未生成路由结果：'+routed.stderr[-1500:])
    if not pcb.ImportSpecctraSES(board,str(ses)):raise ValueError('SES import failed')
    pcb.SaveBoard(str(boardfile),board)
    # Reopen native PCB and verify every source net assignment; DRC checks copper connectivity.
    loaded=pcb.LoadBoard(str(boardfile));actual={(f.GetReference(),pad.GetNumber()):pad.GetNetname() for f in loaded.GetFootprints() for pad in f.Pads()}
    for key,name in expected.items():
        if actual.get(key)!=name:raise ValueError('PCB net mapping changed: '+'.'.join(key))
    if len(list(loaded.GetFootprints()))!=len(comps):raise ValueError('PCB component count mismatch')
    report=project/'drc.rpt';run([req['cli'],'pcb','drc','--format','report','--severity-all','--exit-code-violations','-o',report,boardfile],project)
    drc=parse_drc(report.read_text(encoding='utf-8-sig'));write(project/'drc.json',drc)
    svg=project/'PCB.svg';pdf=project/'PCB.pdf'
    run([req['cli'],'pcb','export','svg','--layers','F.Cu,B.Cu,F.SilkS,Edge.Cuts','--mode-single','--fit-page-to-board','--exclude-drawing-sheet','-o',svg,boardfile],project)
    run([req['cli'],'pcb','export','pdf','--layers','F.Cu,B.Cu,F.SilkS,Edge.Cuts','--mode-single','-o',pdf,boardfile],project)
    write(out/'pcb-result.json',{'board':'project/'+boardfile.name,'pdf':'project/PCB.pdf','previews':['project/PCB.svg'],'drc':drc,'components':len(comps),'nets':len(nets),'tracks':len(list(loaded.GetTracks())),'netMappingVerified':len(expected),'plan':plan})

if __name__=='__main__':build(read(sys.argv[1]))
