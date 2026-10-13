"""Replay the Codex-authored local trial using only the frozen inputs and KiCad."""
import argparse, datetime, os, platform, shutil, subprocess, sys, time
from common import *

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--inputs',type=Path,required=True);ap.add_argument('--out',type=Path,required=True);ap.add_argument('--kicad-cli',type=Path);ap.add_argument('--skip-3d',action='store_true');a=ap.parse_args()
    inp=a.inputs.resolve();out=a.out.resolve();cli=a.kicad_cli or Path(sys.executable).with_name('kicad-cli.exe')
    if out.exists() and any(out.iterdir()):raise SystemExit('Output directory must be empty; choose a new directory.')
    manifest=read(inp/'manifest.json')
    for name,sha in manifest['files'].items():
        assert digest(inp/name)==sha,'Input changed: '+name
    out.mkdir(parents=True,exist_ok=True);checks=out/'checks';checks.mkdir();previews=out/'previews';previews.mkdir()
    cfg=read(inp/'01_task/requirements.json');stem=cfg['stem'];sch=out/(stem+'.kicad_sch');pcb=out/(stem+'.kicad_pcb')
    log={'started':datetime.datetime.now().astimezone().isoformat(),'actor':'Current Codex conversation; model identifier not exposed to this runner','deepseek_requests':0,
         'python':sys.version,'platform':platform.platform(),'input_manifest_sha256':digest(inp/'manifest.json'),
         'tool_hashes':{p.name:digest(p) for p in Path(__file__).parent.glob('*.py')},'steps':[]}
    def call(label,args):
        args=list(map(str,args));start=time.monotonic();print(label,flush=True)
        record={'stage':label,'command':args,'cwd':str(out),'started':datetime.datetime.now().astimezone().isoformat()}
        proc=subprocess.run(args,cwd=out,capture_output=True,encoding='utf-8',errors='replace',env={**os.environ,'PYTHONUTF8':'1'})
        record.update({'exit_code':proc.returncode,'seconds':round(time.monotonic()-start,3),'stdout':proc.stdout,'stderr':proc.stderr});log['steps'].append(record);write(checks/'execution.json',log)
        if proc.returncode:raise RuntimeError(label+' failed: '+proc.stderr+proc.stdout)
        return proc.stdout.strip()
    log['kicad_version']=call('KiCad version',[cli,'version'])
    call('Build schematic and per-reference BOM',[sys.executable,Path(__file__).with_name('run_stage.py'),'--stage','schematic','--inputs',inp,'--out',out])
    call('Compile generated schematic',[cli,'sch','export','netlist','--format','kicadxml','--output',checks/'compiled.xml',sch])
    call('Build footprints, PCB, models and rules',[sys.executable,Path(__file__).with_name('run_stage.py'),'--stage','pcb','--inputs',inp,'--out',out])
    call('ERC',[cli,'sch','erc','--format','json','--output',checks/'erc.json',sch])
    call('DRC and schematic parity',[cli,'pcb','drc','--schematic-parity','--format','json','--output',checks/'drc.json',pcb])
    call('Schematic SVG',[cli,'sch','export','svg','--exclude-drawing-sheet','--output',str(previews)+os.sep,sch])
    call('Schematic PDF',[cli,'sch','export','pdf','--exclude-drawing-sheet','--output',previews/(stem+'.pdf'),sch])
    from front_preview import export_front
    export_front(out,cli,call)
    for side,layers in [('bottom','B.Cu,B.SilkS,Edge.Cuts')]:
        call(side+' PCB SVG',[cli,'pcb','export','svg','--mode-single','--page-size-mode','2','--exclude-drawing-sheet','--layers',layers,'--output',previews/('pcb-'+side+'.svg'),*(['--mirror'] if side=='bottom' else []),pcb])
    if not a.skip_3d:
        for side in ['top','bottom']:
            call(side+' 3D preview',[cli,'pcb','render','--width','1500','--height','1100','--side',side,'--background','opaque','--quality','basic','--output',previews/('3d-'+side+'.png'),pcb])
    log['finished']=datetime.datetime.now().astimezone().isoformat()
    log['output_hashes']={p.relative_to(out).as_posix():digest(p) for p in sorted(out.rglob('*')) if p.is_file() and 'checks' not in p.relative_to(out).parts}
    write(checks/'execution.json',log);print('Completed: '+str(out),flush=True)

if __name__=='__main__':main()
