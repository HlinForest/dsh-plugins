"""Portable evidence: snapshots, plans, tool logs, artifacts and review records."""
from pathlib import Path
import json, sys, zipfile
request = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8-sig'))
out = Path(request['output'])
with zipfile.ZipFile(out / 'frozen-evidence.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    for stage, directory in {**request['dependencies'], str(request['stage']): str(out)}.items():
        for f in sorted(Path(directory).rglob('*')):
            if not f.is_file() or '__pycache__' in f.parts or f.suffix == '.pyc': continue
            if f.name in ['frozen-evidence.zip', 'execution-archive.json']: continue
            z.write(f, 'steps/' + stage + '/' + f.relative_to(directory).as_posix())
