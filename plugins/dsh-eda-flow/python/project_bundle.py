"""Download a self-contained generated project without modifying its outputs."""
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'mcp'))
import record_io

root = Path(sys.argv[1]).resolve()
destination = Path(sys.argv[2])
files = [p for p in root.rglob('*') if p.is_file()]
if any(not p.resolve().is_relative_to(root) for p in files):
    raise ValueError('Project contains an external file link')
if sum(p.stat().st_size for p in files) > 100 * 1024 * 1024:
    raise ValueError('Project exceeds 100 MB')
with zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED) as archive:
    for file in files:
        if file.name.startswith('.eda-records.sqlite'):
            continue
        record = record_io.stored_text(file) if file.suffix in ('.json', '.jsonl') else None
        if record is not None:
            archive.writestr(file.relative_to(root).as_posix(), record)
        else:
            archive.write(file, file.relative_to(root).as_posix())
