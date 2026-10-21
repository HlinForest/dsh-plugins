"""Portable evidence: snapshots, plans, tool logs, artifacts and review records."""
from pathlib import Path
import json, os, sys, zipfile

def local_path(value):
    """Handle nested Windows project paths without changing archive member names."""
    value=os.path.abspath(value)
    if os.name=='nt' and not value.startswith('\\\\?\\'):
        value='\\\\?\\UNC\\'+value[2:] if value.startswith('\\\\') else '\\\\?\\'+value
    return Path(value)

request = json.loads(local_path(sys.argv[1]).read_text(encoding='utf-8-sig'))
out = local_path(request['output'])
with zipfile.ZipFile(out / 'frozen-evidence.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    if request.get('inputsBundle'):
        bundle=local_path(request['inputsBundle'])
        for f in sorted(bundle.rglob('*')):
            if f.is_file():z.write(f,'default-inputs/'+f.relative_to(bundle).as_posix())
    for stage, directory in {**request['dependencies'], str(request['stage']): str(out)}.items():
        directory=local_path(directory)
        for f in sorted(directory.rglob('*')):
            if not f.is_file() or '__pycache__' in f.parts or f.suffix == '.pyc': continue
            if f.name in ['frozen-evidence.zip', 'execution-archive.json']: continue
            z.write(f, 'steps/' + stage + '/' + f.relative_to(directory).as_posix())
