"""Local, model-free stage execution. Inputs and outputs are explicit directories."""
from pathlib import Path
import argparse, collections, csv, hashlib, html, json, os, re, shutil, subprocess, sys, uuid, zipfile
import xml.etree.ElementTree as ET

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE / 'vendor'))
import native
from content import project_snapshot, associations


def read(p):
    return json.loads(Path(p).read_text(encoding='utf-8-sig'))


def write(p, value):
    p = Path(p); p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')


def digest(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def command(args, log, cwd=None):
    print(json.dumps({'event': 'command', 'name': Path(args[0]).name, 'args': list(map(str, args[1:]))}), flush=True)
    r = subprocess.run(list(map(str, args)), cwd=cwd, capture_output=True, text=True, encoding='utf-8', errors='replace',
                       env={**os.environ, 'PYTHONUTF8': '1'}, timeout=600, creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    write(log, {'command': list(map(str, args)), 'exitCode': r.returncode, 'stdout': r.stdout, 'stderr': r.stderr})
    if r.returncode:
        raise RuntimeError((r.stderr or r.stdout or 'Command failed')[-3500:] + '\nLog: ' + str(log))
    return r


def copytree(a, b):
    shutil.copytree(a, b, dirs_exist_ok=True, ignore=shutil.ignore_patterns('__pycache__', '*.pyc', '*.lck'))


def pcb_modules():
    import wx
    # Old polygon imports can warn; log instead of blocking an unattended worker on a dialog.
    logger = wx.LogStderr(); wx.Log.SetActiveTarget(logger)
    import pcbnew
    return pcbnew, logger


def extraction(req, out):
    sources = {}
    (out / '00_native').mkdir()
    for key in ('schematic', 'pcb', 'nativeProject'):
        if not req['inputs'].get(key):
            continue
        src = Path(req['inputs'][key]); dest = out / '00_native' / src.name
        shutil.copyfile(src, dest); sources[key] = dest.relative_to(out).as_posix()
    if not sources.get('schematic') or not sources.get('pcb'):
        write(out / 'design-basis.json', req['inputs'])
        return {'summary': '已保存设计依据；未提供的源资料保持缺项。',
                'gaps': [] if req['mode'] == 'new' else ['原始 SchDoc/PcbDoc 未齐全；后续仅能形成假设草稿，不能验收为 1:1 复原。']}
    report = native.extract(out, sources); write(out / 'extraction.json', report)
    if not report['eligible']:
        raise ValueError('当前解析器不能完整解释：' + '; '.join(report['issues']) + '。已保留原始记录。')
    rows = read(out / '02_extracted/native_pcb/Components6_Data.records.json')['records']
    def axis(text):
        value = float(text.removesuffix('mil'))
        return {'raw': text, 'mil': value, 'mm': round(value * .0254, 6)}
    components = [dict(designator=r['fields']['SOURCEDESIGNATOR'], pattern=r['fields']['PATTERN'],
                       layer=r['fields']['LAYER'], position={'x': axis(r['fields']['X']), 'y': axis(r['fields']['Y'])},
                       rotation={'degrees': float(r['fields']['ROTATION'])}, source_locator=r['source_locator']) for r in rows]
    write(out / '02_extracted/pcb_native/pcb_native_components.json', {'components': components})
    rules = read(out / '02_extracted/native_pcb/Rules6_Data.records.json')
    write(out / '02_extracted/pcb_native/pcb_native_rules.json', rules)
    source = out / sources['pcb']
    # The official Windows importer may crash on this legacy board. Each attempt has
    # separate output; only an actual successful exit is accepted, never a leftover file.
    shutil.copyfile(source, out / 'native.PcbDoc')
    for attempt in range(3):
        filename = f'import-{attempt}.kicad_pcb'; log = out / f'import-{attempt}.command.json'
        try:
            command([req['cli'], 'pcb', 'import', '--format', 'altium', '--report-format', 'json', '--report-file', f'import-{attempt}.report.json',
                     '--output', filename, 'native.PcbDoc'], log, cwd=out)
            shutil.copyfile(out / filename, out / 'native-import.kicad_pcb')
            break
        except RuntimeError:
            if read(log)['exitCode'] not in [3221225477, -1073741819] or attempt == 2:
                raise
    return {'summary': f"提取 {report['components']} 个对象、{report['pins']} 个引脚、{report['embeddedModels']} 个模型；已重新导入原板。",
            'gaps': ['缺原 Altium 编译网表及原始页面 PDF。'], 'counts': report}


def materials(req, out):
    prev = Path(req['dependencies']['2'])
    components = read(prev / '02_extracted/native_schematic/components.json') if (prev / '02_extracted').exists() else []
    rows = [{'reference': c['reference'], 'parameters': c['parameters'], 'source': c['source_locator']} for c in components]
    write(out / 'components.json', rows)
    pdfs = []
    for item in req['inputs'].get('datasheets', []):
        import pymupdf
        src = Path(item['path']); dest = out / 'datasheets' / (digest(src)[:12] + '.pdf')
        dest.parent.mkdir(exist_ok=True); shutil.copyfile(src, dest)
        with pymupdf.open(dest) as doc:
            pages = [{'page': i + 1, 'text': page.get_text()} for i, page in enumerate(doc)]
        pdfs.append({**item, 'sha256': digest(dest), 'file': str(dest.relative_to(out)), 'pages': pages, 'review': 'pending'})
    write(out / 'datasheets.json', pdfs)
    return {'summary': f'已整理 {len(rows)} 个原始器件、{len(pdfs)} 份规格书。',
            'table': {'columns': ['位号', '原始参数数量', '源记录'], 'rows': [[r['reference'], len(r['parameters']), r['source']['record_index']] for r in rows]},
            'gaps': [] if pdfs else ['未提供器件规格书；参数取自原工程，采购信息和器件规格仍待复核。']}



def main():
    args = argparse.ArgumentParser(); args.add_argument('request'); parsed = args.parse_args()
    req = read(parsed.request); out = Path(req['output']); out.mkdir(parents=True, exist_ok=True)
    logger = None
    if req['stage'] in [5, 6, 7]:
        _, logger = pcb_modules()
    if req['stage'] == 1:
        write(out / 'requirements.json', req['inputs'])
        gaps = []
        if not req['inputs'].get('requirements', '').strip(): gaps.append('任务需求尚未填写。')
        for key, label in [('layerPolicy', '板层'), ('packagePolicy', '封装'), ('outlinePolicy', '机械板框'), ('rulePolicy', '制造规则')]:
            if not req['inputs'].get('constraints', {}).get(key): gaps.append(label + '要求尚未定义，不能默认选取。')
        result = {'summary': '已记录本次需求、源版本与约束。', 'gaps': gaps}
    elif req.get('caseDir') and req['stage'] in [4, 5, 6, 7]:
        import importlib.util
        spec = importlib.util.spec_from_file_location('case_stages', Path(req['caseDir']) / 'stages.py')
        adapter = importlib.util.module_from_spec(spec); spec.loader.exec_module(adapter)
        result = {4: adapter.schematic, 5: adapter.bom, 6: adapter.pcb, 7: adapter.verification}[req['stage']](req, out)
    elif req['stage'] in [2, 3]:
        result = {2: extraction, 3: materials}[req['stage']](req, out)
    else:
        raise ValueError('本项目尚无可执行处理输出。请先通过 AI 生成本阶段方案。')
    version = command([req['cli'], '--version'], out / 'tool-version.json')
    result['runtime'] = {'python': sys.version, 'kicad': version.stdout.strip(), 'platform': sys.platform}
    result['modelRequests'] = 0
    write(out / 'result.json', result)
    print(json.dumps({'event': 'complete', 'summary': result['summary']}, ensure_ascii=True), flush=True)


if __name__ == '__main__':
    main()
