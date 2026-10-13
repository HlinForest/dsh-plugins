"""R6-specific executable stages. The generic flow does not know board names or geometry."""
from pathlib import Path
import collections, csv, html, json, os, shutil, sys, zipfile
import xml.etree.ElementTree as ET
from runner import read, write, digest, command, copytree
from content import project_snapshot, associations

def schematic(req, out):
    case = Path(req['caseDir']); prior = Path(req['dependencies']['2'])
    source = next((prior / '00_native').glob('*.SchDoc'))
    command([sys.executable, case / 'recipes/schematic.py', source, out], out / 'generate.json')
    project = out / 'MD50PG_R5_SourceRestored.kicad_sch'
    (out / 'previews').mkdir(exist_ok=True)
    command([req['cli'], 'sch', 'export', 'netlist', '--format', 'kicadxml', '-o', out / 'checks/restored.xml', project], out / 'netlist-command.json')
    command([req['cli'], 'sch', 'export', 'svg', '-o', str(out / 'previews') + os.sep, project], out / 'preview-command.json')
    command([req['cli'], 'sch', 'erc', '--format', 'json', '-o', out / 'checks/erc.json', project], out / 'erc-command.json')
    return {'summary': '已从原始记录生成原理图、符号库、BOM 草稿及本次 ERC。', 'gaps': ['原理图字体、电源符号采用 R6 历史转换方案；不是 Altium 页面像素一致。']}


def bom(req, out):
    import pcbnew as p
    evidence = Path(req['dependencies']['2']); sch = Path(req['dependencies']['4'])
    for src in sch.iterdir():
        if src.name in {'checks', 'previews'}: copytree(src, out / src.name)
        elif src.suffix in {'.kicad_sch', '.kicad_sym', '.csv'} or src.name == 'sym-lib-table': shutil.copyfile(src, out / src.name)
    copytree(evidence / '00_native', out / 'native_original')
    (out / 'pcb_reference').mkdir(exist_ok=True)
    shutil.copyfile(evidence / 'native-import.kicad_pcb', out / 'pcb_reference/MD50PG_native_import.kicad_pcb')
    original = [{'path': x.name, 'sha256': digest(x)} for x in (out / 'native_original').iterdir()]
    write(out / 'checks/original_hashes.json', original)
    copytree(evidence / '04_assets/native_fonts', out / 'assets/native_fonts')
    (out / 'assets/native_models').mkdir(parents=True, exist_ok=True)
    models = []
    for m in read(evidence / '04_assets/native_models/manifest.json'):
        filename = Path(m['path']).name
        target = out / 'assets/native_models' / filename; shutil.copyfile(evidence / m['path'], target)
        models.append({'output': target.relative_to(out).as_posix(), 'native_metadata': m['metadata'], 'sha256': digest(target)})
    write(out / 'assets/native_models/manifest.json', models)
    graph = read(out / 'checks/native_connectivity.json')
    group = lambda nodes: tuple(sorted(tuple(n) for n in nodes))
    tree = ET.parse(out / 'checks/restored.xml')
    compiled = {group((n.get('ref'), n.get('pin')) for n in net.findall('node')): net.get('name') for net in tree.findall('./nets/net')}
    board = p.LoadBoard(str(evidence / 'native-import.kicad_pcb'))
    pinset = {(n['ref'], n['pin']) for n in graph['pins']}; groups = collections.defaultdict(set)
    for fp in board.GetFootprints():
        for pad in fp.Pads():
            node = (fp.GetReference(), pad.GetNumber())
            if node in pinset:
                groups[pad.GetNetname()].add(node)
    pcb_groups = {group(nodes): name for name, nodes in groups.items()}
    native_groups = {group(n['nodes']): n for n in graph['nets']}
    if set(pcb_groups) != set(compiled) or set(compiled) != set(native_groups):
        raise ValueError('本次原板导入、原生连接和生成网表不一致，不能自动建立网络映射。')
    mapping = [{'nodes': k, 'native_labels': native_groups[k]['labels'], 'kicad_name': compiled[k],
                'bundle_derived_pcb_net': pcb_groups[k], 'nc': native_groups[k]['nc']} for k in compiled]
    write(out / 'checks/verification.json', {'net_mapping': mapping, 'basis': 'Fresh native import + fresh compiled netlist + native records'})
    library = out / 'provisional.pretty'; library.mkdir(exist_ok=True)
    io = p.PCB_IO_MGR.FindPlugin(p.PCB_IO_MGR.KICAD_SEXP)
    for i, fp in enumerate(board.GetFootprints()):
        fp.SetFPID(p.LIB_ID('provisional', f'instance_{i:03d}')); io.FootprintSave(str(library), fp)
    with next(out.glob('BOM_*.csv')).open(encoding='utf-8-sig', newline='') as file:
        rows = list(csv.reader(file))
    return {'summary': f'本次生成逐位号 BOM、{len(list(board.GetFootprints()))} 个板内封装、{len(mapping)} 组网络映射及模型依赖。',
            'table': {'columns': rows[0], 'rows': rows[1:]},
            'gaps': ['采购资料未齐全，BOM 保持草稿。']}


def pcb(req, out):
    config = out / 'recipe-config.json'; write(config, req['plan'])
    command([sys.executable, Path(req['caseDir']) / 'recipes/pcb.py', out, req['dependencies']['5'], req['dependencies']['2'], config], out / 'generate.json')
    board = out / 'MD50PG_R6.kicad_pcb'; sch = out / 'MD50PG_R6.kicad_sch'
    (out / 'previews').mkdir(exist_ok=True)
    command([req['cli'], 'sch', 'export', 'netlist', '--format', 'kicadxml', '-o', out / 'checks/restored.xml', sch], out / 'netlist-command.json')
    command([req['cli'], 'sch', 'export', 'svg', '-o', str(out / 'previews') + os.sep, sch], out / 'schematic-preview-command.json')
    for name, layers in [('PCB_front', 'F.Cu,F.Silkscreen,Edge.Cuts,Dwgs.User'), ('PCB_back', 'B.Cu,B.Silkscreen,Edge.Cuts')]:
        command([req['cli'], 'pcb', 'export', 'svg', '--layers', layers, '--page-size-mode', '2', '-o', out / 'previews' / (name + '.svg'), board], out / (name + '-command.json'))
    command([req['cli'], 'pcb', 'render', '--width', '1400', '--height', '900', '--quality', 'basic', '--background', 'opaque', '-o', out / 'previews/PCB_3D.png', board], out / 'render-command.json')
    return {'summary': '已生成本次 R6 PCB、封装库、局部模型和原理图绑定，并重新导出预览。', 'gaps': req['plan']['limitations']}


def normalized_project(root):
    return project_snapshot(root)

def verification(req, out):
    copytree(Path(req['dependencies']['6']), out / 'project'); project = out / 'project'
    sch = project / 'MD50PG_R6.kicad_sch'; board = project / 'MD50PG_R6.kicad_pcb'
    command([req['cli'], 'sch', 'erc', '--format', 'json', '-o', project / 'checks/erc.json', sch], out / 'erc-command.json')
    command([req['cli'], 'pcb', 'drc', '--schematic-parity', '--format', 'json', '-o', project / 'checks/drc.json', board], out / 'drc-command.json')
    command([sys.executable, Path(req['caseDir']) / 'recipes/verify.py', project, req['dependencies']['2']], out / 'verify-command.json')
    verification = read(project / 'checks/verification.json')
    verification['objectAssociations'] = associations(project)
    # Regenerate the diagnostic table too; never reuse a historical DRC CSV.
    drc = read(project / 'checks/drc.json')
    with (project / 'DRC_原版保留告警.csv').open('w', encoding='utf-8-sig', newline='') as file:
        writer = csv.writer(file); writer.writerow(['类别','级别','说明','对象','坐标mm','UUID'])
        for violation in drc['violations']:
            for item in violation.get('items', []):
                writer.writerow([violation['type'], violation['severity'], violation['description'], item['description'], json.dumps(item.get('pos', {})), item.get('uuid', '')])
    fingerprint = normalized_project(project); write(out / 'project-content.json', fingerprint)
    baseline = read(Path(req['caseDir']) / 'baseline-content.json')['files']
    differences = sorted(k for k in set(baseline) | set(fingerprint) if baseline.get(k) != fingerprint.get(k))
    verification['historicalR6Baseline'] = {'compared': len(fingerprint), 'differences': differences, 'match': not differences,
        'method': 'Semantic object identities and resolved UUID reference edges; original R6 files are not generation inputs.'}
    if differences: raise ValueError('本次工程与 R6 独立基准不一致：' + ', '.join(differences))
    write(out / 'verification.json', verification)
    manifest = [{'path': f.relative_to(project).as_posix(), 'bytes': f.stat().st_size, 'sha256': digest(f)} for f in sorted(project.rglob('*')) if f.is_file()]
    write(project / 'delivery-manifest.json', {'files': manifest, 'mode': 'preset-generated', 'completeOneToOneVerified': False})
    body = '<h1>本次 R6 默认流程执行报告</h1><p>由原始资料和预置方案实际生成；模型调用为 0。原生完整 1:1 未认证。</p>'
    body += '<h2>检查结果</h2><pre>' + html.escape(json.dumps(verification, ensure_ascii=False, indent=2)) + '</pre>'
    body += ''.join('<figure><img style="width:100%" src="project/previews/' + name + '"><figcaption>' + label + '</figcaption></figure>' for name, label in [('MD50PG_R6.svg', '本次原理图'), ('PCB_front.svg', '本次 PCB 正面'), ('PCB_back.svg', '本次 PCB 背面'), ('PCB_3D.png', '本次 3D')])
    document = '<!doctype html><meta charset="utf-8"><title>R6 运行报告</title><style>body{max-width:1080px;margin:40px auto;font:16px/1.7 sans-serif;padding:24px;color:#20353d}pre{white-space:pre-wrap;background:#f2f6f8;padding:20px}</style>' + body
    (out / 'REPORT.html').write_text(document, encoding='utf-8')
    with zipfile.ZipFile(out / 'R6-generated.zip', 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('REPORT.html', document.replace('src="project/previews/', 'src="MD50PG_R6/previews/'))
        for file in sorted(project.rglob('*')):
            if file.is_file(): z.write(file, 'MD50PG_R6/' + file.relative_to(project).as_posix())
    return {'summary': '本次 R6 阶段核验完成，生成独立报告和工程 ZIP；重放需执行重放操作。', 'gaps': req['plan']['limitations'], 'verification': verification}

