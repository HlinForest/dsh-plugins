"""Host-owned checks for a model/manual script. Never trust its success claim alone."""
import csv, json, os, sys, zipfile, subprocess
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent/'vendor'))
sys.path.insert(0,str(Path(__file__).parent/'structured'))
from common import read, write
from content import project_snapshot

def command(args, log):
    r=subprocess.run(list(map(str,args)),capture_output=True,encoding='utf-8',errors='replace',timeout=600,creationflags=getattr(subprocess,'CREATE_NO_WINDOW',0))
    write(log,{'command':list(map(str,args)),'exitCode':r.returncode,'stdout':r.stdout,'stderr':r.stderr})
    if r.returncode:raise RuntimeError(r.stderr+r.stdout)

req = read(sys.argv[1]); out = Path(req['output']); project = out / 'project'; stage = req['stage']
result = read(out / 'result.json'); result.setdefault('gaps', [])
checks = out / 'independent-checks'; checks.mkdir(exist_ok=True)
previews = out / 'previews'; previews.mkdir(exist_ok=True)
if not project.is_dir():
    raise ValueError('本步必须在 output/project 中产生可编辑文件。')
if stage in [4, 7]:
    sch = list(project.glob('*.kicad_sch'))
    if len(sch) != 1: raise ValueError('首版要求一个顶层 KiCad 原理图文件。')
    command([req['cli'], 'sch', 'export', 'netlist', '--format', 'kicadxml', '-o', checks / 'compiled.xml', sch[0]], checks / 'netlist-command.json')
    command([req['cli'], 'sch', 'erc', '--format', 'json', '-o', checks / 'erc.json', sch[0]], checks / 'erc-command.json')
    command([req['cli'], 'sch', 'export', 'svg', '-o', str(previews) + os.sep, sch[0]], checks / 'svg-command.json')
if stage in [5, 7]:
    tables = list(project.glob('*.csv'))
    if not tables: raise ValueError('未生成 BOM CSV。')
    if not list(project.glob('*.pretty/*.kicad_mod')): raise ValueError('未生成项目局部封装库。')
    with tables[0].open(encoding='utf-8-sig', newline='') as f: rows = list(csv.reader(f))
    if not rows: raise ValueError('BOM CSV 为空。')
    result['table'] = {'columns': rows[0], 'rows': rows[1:]}
if stage in [6, 7]:
    boards = list(project.glob('*.kicad_pcb'))
    if len(boards) != 1: raise ValueError('首版要求一个 KiCad PCB 文件。')
    command([req['cli'], 'pcb', 'drc', '--format', 'json', '-o', checks / 'drc.json', boards[0]], checks / 'drc-command.json')
    from front_preview import export_front
    export_front(project,req['cli'],lambda label,args:command(args,checks/(label.replace(' ','-')+'.json')))
    command([req['cli'], 'pcb', 'export', 'svg', '--mode-single','--mirror','--layers', 'B.Cu,B.SilkS,Edge.Cuts', '--page-size-mode', '2', '-o', previews / 'pcb-bottom.svg', boards[0]], checks / 'back-command.json')
    if not req.get('skip3d'):command([req['cli'], 'pcb', 'render', '--width', '1400', '--height', '900', '--quality', 'basic', '--background', 'opaque', '-o', previews / '3d-top.png', boards[0]], checks / '3d-command.json')
for report in checks.glob('*rc.json'):
    data = read(report); violations = data.get('violations', []) + [v for s in data.get('sheets', []) for v in s.get('violations', [])]
    result['gaps'].append(f'{report.name}: {len(violations)} 条规则检查记录，需工程师复核。')
result['gaps'].append('通用 AI/自定义输出尚未通过独立源证据一致性验收。ERC/DRC 不代表 1:1 或生产放行。')
result['independentChecks'] = {'toolRunsCompleted': True, 'completeOneToOneVerified': False, 'fabricationRelease': False}
if stage == 7:
    write(out / 'project-content.json', project_snapshot(project))
    with zipfile.ZipFile(out / 'project-generated.zip', 'w', zipfile.ZIP_DEFLATED) as z:
        for f in sorted(project.rglob('*')):
            if f.is_file(): z.write(f, 'project/' + f.relative_to(project).as_posix())
write(out / 'result.json', result)
