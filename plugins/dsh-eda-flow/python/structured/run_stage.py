"""Run a generation stage with Python file-read auditing and network disabled.

The hook covers Python file I/O. KiCad's native C++ I/O is not intercepted;
its project argument is always this run's own newly serialized output file.
"""
import argparse, json, os, runpy, sys
from pathlib import Path

ap=argparse.ArgumentParser();ap.add_argument('--stage',choices=['schematic','pcb'],required=True);ap.add_argument('--inputs',type=Path,required=True);ap.add_argument('--out',type=Path,required=True);a=ap.parse_args()
allowed=[a.inputs.resolve(),a.out.resolve(),Path(__file__).parent.resolve(),(Path(__file__).parent.parent/'vendor').resolve(),Path(sys.prefix).resolve(),Path(os.environ['WINDIR']).resolve()]
events=[];recording=True
def audit(event,args):
    if event.startswith('socket.'):raise RuntimeError('Network is disabled for deterministic generation')
    if event=='open' and recording and isinstance(args[0],(str,bytes,os.PathLike)):
        path=Path(os.fsdecode(args[0])).resolve()
        if not any(path==base or base in path.parents for base in allowed):raise RuntimeError('Read/write outside generation roots: '+str(path))
        events.append({'path':str(path),'mode':str(args[1])})
sys.addaudithook(audit)
sys.argv=['generate_'+a.stage+'.py','--inputs',str(a.inputs),'--out',str(a.out)]
try:runpy.run_path(str(Path(__file__).with_name('generate_'+a.stage+'.py')),run_name='__main__')
finally:
    recording=False;p=a.out/'checks'/('file-access-'+a.stage+'.json');p.parent.mkdir(parents=True,exist_ok=True)
    p.write_text(json.dumps({'coverage':'Python open audit; native C++ file I/O not intercepted','allowed_roots':list(map(str,allowed)),'events':events},ensure_ascii=False,indent=2),encoding='utf-8')
