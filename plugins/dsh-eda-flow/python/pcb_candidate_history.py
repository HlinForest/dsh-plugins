"""Reuse only compatible, revalidated candidates from this generated project.

Past generated positions are starting geometry, never placement constraints.
Original/reference CAD is not searched. A fresh board supplies the expected
electrical and pad geometry; native DRC runs again under current project rules.
"""
import copy,json,shutil,subprocess,sys,os
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'mcp'))
from record_io import read_json as read,write_json as write

def request_identity(request):
    value=copy.deepcopy(request)
    for key in ('output','solverPython','cli','java','jar','_localRepairSeconds','_candidateTimeoutSeconds','routingFeedback','placementOptimization','optimizationFeedback'):
        value.pop(key,None)
    for key in ('components','footprintImports'):
        if key in value:value[key]=sorted(value[key],key=lambda row:row['ref'])
    if 'nc' in value:value['nc']=sorted(value['nc'])
    return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False)

def prior_candidates(request,limit=2):
    current=Path(request['output']).resolve();parent=current.parent
    signature=request_identity(request);candidates=[]
    # Only sibling output folders in the same generated workflow are considered.
    # Validation/ad-hoc sources and original AD folders are not searched.
    for directory in sorted((p for p in parent.iterdir() if p.is_dir() and not p.is_symlink() and p.resolve()!=current),key=lambda p:p.stat().st_mtime,reverse=True)[:40]:
        try:
            previous=read(directory/'pcb-request.json');result=read(directory/'pcb-result.json')
            if not result['drc']['passed'] or result['drc'].get('warnings',0):continue
            if request_identity(previous)!=signature:continue
            if not (directory/'project'/Path(request['schematic']).with_suffix('.kicad_pcb').name).is_file():continue
            candidates.append((directory,result))
            if len(candidates)>=limit:break
        except (OSError,ValueError,KeyError,TypeError):continue
    return candidates

def prepare_candidate(request,fresh_request,previous,result,destination):
    """Return a native-compatible candidate, or a recorded rejection."""
    previous=Path(previous);destination=Path(destination);destination.mkdir(parents=True,exist_ok=True)
    expected=Path(fresh_request['output'])/'project';check=destination/'history-compatibility.json'
    request_file=destination/'request.json';candidate=copy.deepcopy(request);candidate['output']=str(destination)
    candidate['_localRepairSeconds']=120;write(request_file,candidate)
    worker=Path(__file__).with_name('pcb_local_repair.py')
    p=subprocess.run([sys.executable,str(worker),'compatible',str(request_file),str(previous/'project'),str(check),str(expected)],capture_output=True,timeout=60,creationflags=0x08000000 if os.name=='nt' else 0)
    if p.returncode:raise ValueError('Historical candidate identity check did not complete')
    facts=read(check)
    if not facts['compatible']:return None,{'accepted':False,'reason':'electrical, physical or board geometry changed'}
    # Geometry-dependent reports belong to the existing candidate. The native
    # schematic, libraries and project rules come from the fresh current build.
    shutil.copytree(previous/'project',destination/'project',dirs_exist_ok=True)
    for item in expected.iterdir():
        if item.is_dir() and item.suffix=='.pretty':shutil.copytree(item,destination/'project'/item.name,dirs_exist_ok=True)
        elif item.suffix in ('.kicad_sch','.kicad_pro','.kicad_dru') or item.name in ('fp-lib-table','sym-lib-table','footprint-bindings.json','PCB-BOM.csv'):
            shutil.copyfile(item,destination/'project'/item.name)
    for item in previous.iterdir():
        if item.is_file() and item.suffix=='.json' and item.name not in ('pcb-request.json','model-log.json','pdf-sources.json','layout-attempts.json','pcb-result.json'):
            try:write(destination/item.name,read(item))
            except (OSError,ValueError):pass
    if request.get('footprintImports'):
        report=destination/'assembly-refresh.json'
        p=subprocess.run([sys.executable,str(worker),'assembly',str(request_file),str(destination/'project'),str(report)],capture_output=True,timeout=60,creationflags=0x08000000 if os.name=='nt' else 0)
        if p.returncode or not report.exists():raise ValueError('Historical imported assembly refresh did not complete')
    cloned=copy.deepcopy(result)
    for key in ('localRepair','localRepairSearch','historyCandidates','layoutAttempts'):cloned.pop(key,None)
    cloned['requestedPlan']=copy.deepcopy(request['plan'])
    return (candidate,cloned),{'accepted':True,'sourceRun':previous.name,'compatible':True}
