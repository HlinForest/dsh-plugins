"""Host tools selected by a recorded model plan; stages consume full frozen inputs."""
import sys, os, json, shutil, subprocess, csv, zipfile, collections
from pathlib import Path
HERE=Path(__file__).resolve().parent
sys.path.insert(0,str(HERE/'structured'))
from common import *

def main():
    req=read(sys.argv[1]);out=Path(req['output']);stage=req['stage'];project=out/'project';cli=req['cli'];plan=req['plan']
    gaps=[];result={'summary':plan['summary'],'gaps':gaps}
    if stage<4:
        for key in ['components','parameters','connections','citations']:
            if isinstance(plan.get(key),list):result[key]=plan[key]
        if req.get('inputsBundle'):
            inp=Path(req['inputsBundle']);manifest=read(inp/'manifest.json')
            for name,sha in manifest['files'].items():assert digest(inp/name)==sha,'Input hash mismatch: '+name
            if stage==3:
                rows=read(inp/'03_components/components.json')
                result['table']={'columns':['位号','型号/原始值','参数数'], 'rows':[[r['reference'],next((p['value'] for p in r['parameters'] if p['name']=='Comment'),''),len(r['parameters'])] for r in rows]}
            result['inputFilesVerified']=len(manifest['files'])
        if stage==1:
            if not req['inputs'].get('requirements','').strip():gaps.append('请补充功能需求。')
            for key,label in [('layerPolicy','板层'),('packagePolicy','封装'),('outlinePolicy','板框'),('rulePolicy','制造规则')]:
                if not req['inputs'].get('constraints',{}).get(key):gaps.append(label+'要求待确认。')
        write(out/'design-inputs.json',{'engineer':req['inputs'],'model':plan,'prepared':read(out/'prepared/intake.json')})
        write(out/'result.json',result);return
    inp=Path(req['inputsBundle']);project.mkdir(exist_ok=True)
    calls=[]
    def call(label,args):
        args=list(map(str,args));print(json.dumps({'event':'command','name':label,'args':args}),flush=True)
        r=subprocess.run(args,cwd=project,capture_output=True,encoding='utf-8',errors='replace',timeout=600,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
        calls.append({'name':label,'command':args,'exitCode':r.returncode,'stdout':r.stdout,'stderr':r.stderr});write(out/'commands.json',calls)
        if r.returncode:raise RuntimeError(label+': '+r.stderr+r.stdout)
        return r.stdout
    stem=read(inp/'01_task/requirements.json')['stem']
    if stage>4:
        upstream=Path(req['dependencies'][str(stage-1)])/'project'
        shutil.copytree(upstream,project,dirs_exist_ok=True,ignore=shutil.ignore_patterns('__pycache__','*.lck'))
    (project/'checks').mkdir(exist_ok=True);(project/'previews').mkdir(exist_ok=True)
    sch=project/(stem+'.kicad_sch');pcb=project/(stem+'.kicad_pcb')
    if stage==4:
        call('生成原理图',[sys.executable,HERE/'structured/run_stage.py','--stage','schematic','--inputs',inp,'--out',project])
        call('编译连接',[cli,'sch','export','netlist','--format','kicadxml','-o',project/'checks/compiled.xml',sch])
        call('原理图检查',[cli,'sch','erc','--format','json','-o',project/'checks/erc.json',sch])
        call('原理图预览',[cli,'sch','export','svg','--exclude-drawing-sheet','-o',str(project/'previews')+os.sep,sch])
        call('原理图 PDF',[cli,'sch','export','pdf','--exclude-drawing-sheet','-o',project/'previews/schematic.pdf',sch])
    if stage==5:
        # Materialize standalone footprint geometry directly, before PCB assembly.
        lib=project/'DisplayBoard_Placed.pretty';lib.mkdir(exist_ok=True)
        for row in read(inp/'05_footprints/instances.json'):
            fp=decode(row['data']);ref=prop(fp).get('Reference','');name=safe(ref)+'_Original' if ref else 'AUX_'+str(row['source_index']).zfill(4)
            fp[0]=S('footprint');fp[1]=name
            fp[:]=[v for v in fp if tag(v) not in {'uuid','path','sheetfile','sheetname','at','model'}]
            fp[2:2]=[node('version',20260206),node('generator','pcbnew')]
            save_sexp(lib/(name+'.kicad_mod'),fp)
        save_sexp(project/'fp-lib-table',node('fp_lib_table',node('lib',node('name','DisplayBoard_Placed'),node('type','KiCad'),node('uri','${KIPRJMOD}/DisplayBoard_Placed.pretty'),node('options',''),node('descr','Input footprint geometry'))))
        with next(project.glob('BOM_*.csv')).open(encoding='utf-8-sig',newline='') as f:rows=list(csv.reader(f))
        result['table']={'columns':rows[0],'rows':rows[1:]}
        write(out/'footprint-mapping.json',{'footprints':len(list(lib.glob('*.kicad_mod'))),'source':'05_footprints/instances.json'})
    if stage==6:
        call('生成 PCB',[sys.executable,HERE/'structured/run_stage.py','--stage','pcb','--inputs',inp,'--out',project])
    if stage in [6,7]:
        call('工程原理图检查',[cli,'sch','erc','--format','json','-o',project/'checks/erc.json',sch])
        call('PCB 检查',[cli,'pcb','drc','--schematic-parity','--format','json','-o',project/'checks/drc.json',pcb])
        from front_preview import export_front
        export_front(project,cli,call)
        call('背面预览',[cli,'pcb','export','svg','--mode-single','--page-size-mode','2','--exclude-drawing-sheet','--mirror','--layers','B.Cu,B.SilkS,Edge.Cuts','-o',project/'previews/pcb-bottom.svg',pcb])
        if stage==6 and not req.get('skip3d'):
            for side in ['top','bottom']:call('3D '+side,[cli,'pcb','render','--width','1400','--height','1000','--side',side,'--quality','basic','--background','opaque','-o',project/'previews'/('3d-'+side+'.png'),pcb])
        import pcbnew as p
        board=p.LoadBoard(str(pcb))
        layercheck={'configuredCopperLayers':board.GetCopperLayerCount(),'trackLayers':dict(collections.Counter(board.GetLayerName(t.GetLayer()) for t in board.GetTracks())),'vias':sum(isinstance(t,p.PCB_VIA) for t in board.GetTracks()),'frontCopperPads':sum(pad.IsOnLayer(p.F_Cu) for f in board.GetFootprints() for pad in f.Pads()),'manufacturingCopperLayers':None,'holePlatingConfirmed':False}
        write(out/'layer-review.json',layercheck);result['layerReview']=layercheck
        gaps.append('制造铜层数与通孔金属化待工程师确认；当前工程保留源层叠和焊盘。')
    if stage==7:
        from snapshot import snapshot
        actual=snapshot(project);expected=read(HERE.parent/'cases/display-board/expected-content.json')
        different=[k for k in set(actual)|set(expected) if actual.get(k)!=expected.get(k)]
        write(out/'project-content.json',actual);write(out/'comparison.json',{'equal':not different,'categories':len(expected),'differences':sorted(different),'basis':'历史目标的语义摘要，仅核验阶段使用'})
        result['comparison']={'equal':not different,'categories':len(expected),'differences':sorted(different)}
        if different:gaps.append('与显示板目标有差异：'+', '.join(sorted(different)))
        gaps.extend(['缺原 Altium 编译网表与原始页面 PDF。','数码管没有原始 3D 模型；保留二维图形。'])
        with zipfile.ZipFile(out/'DisplayBoard.zip','w',zipfile.ZIP_DEFLATED) as z:
            for f in sorted(project.rglob('*')):
                if f.is_file():z.write(f,'DisplayBoard/'+f.relative_to(project).as_posix())
    for name in ['erc','drc']:
        report=project/'checks'/(name+'.json')
        if report.exists():
            d=read(report);violations=d.get('violations',[])+[v for sheet in d.get('sheets',[]) for v in sheet.get('violations',[])]
            result[name]=dict(collections.Counter(v.get('severity','unknown') for v in violations))
            if violations:gaps.append(name.upper()+'：'+str(len(violations))+' 条检查记录待复核。')
    write(out/'result.json',result)

if __name__=='__main__':main()
