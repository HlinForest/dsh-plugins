"""Portable evidence: snapshots, plans, tool logs, artifacts and review records."""
from pathlib import Path
import json, os, sys, zipfile, hashlib

def local_path(value):
    """Handle nested Windows project paths without changing archive member names."""
    value=os.path.abspath(value)
    if os.name=='nt' and not value.startswith('\\\\?\\'):
        value='\\\\?\\UNC\\'+value[2:] if value.startswith('\\\\') else '\\\\?\\'+value
    return Path(value)

sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'mcp'))
import record_io
request = record_io.read_json(sys.argv[1])
out = local_path(request['output'])
with zipfile.ZipFile(out / 'frozen-evidence.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    exports = []
    if request.get('inputsBundle'):
        bundle=local_path(request['inputsBundle'])
        for f in sorted(bundle.rglob('*')):
            if f.is_file():z.write(f,'default-inputs/'+f.relative_to(bundle).as_posix())
    for stage, directory in {**request['dependencies'], str(request['stage']): str(out)}.items():
        directory=local_path(directory)
        for f in sorted(directory.rglob('*')):
            if not f.is_file() or '__pycache__' in f.parts or f.suffix == '.pyc': continue
            if f.name in ['frozen-evidence.zip', 'execution-archive.json']: continue
            name = 'steps/' + stage + '/' + f.relative_to(directory).as_posix()
            record = record_io.stored_text(f) if f.suffix in ('.json', '.jsonl') else None
            if record is not None:
                z.writestr(name, record)
                exports.append({'path': name, 'source': 'transactional-record-store',
                                'exportSha256': hashlib.sha256(record.encode('utf-8')).hexdigest(),
                                'workspaceExportSha256': hashlib.sha256(f.read_bytes()).hexdigest()})
            else: z.write(f, name)
    z.writestr('record-export-manifest.json', json.dumps({'schema': 1, 'records': exports}, ensure_ascii=False, indent=2))
