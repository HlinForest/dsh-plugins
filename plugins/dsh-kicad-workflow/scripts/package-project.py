"""Create and independently verify a KiCad reference delivery archive."""
import hashlib
import json
from pathlib import Path
import sys
import zipfile

root, archive = (Path(arg).resolve() for arg in sys.argv[1:])
if archive.exists() or root in archive.parents:
    raise ValueError('Archive must be new and outside the source directory')
manifest = json.loads((root / 'delivery-manifest.json').read_text(encoding='utf-8'))
files = []
for row in manifest['files']:
    file = (root / row['file']).resolve()
    if root not in file.parents or file.is_symlink():
        raise ValueError('Unsafe manifest member')
    if hashlib.sha256(file.read_bytes()).hexdigest() != row['sha256']:
        raise ValueError('Delivery changed before packaging: ' + row['file'])
    files.append(file)
files.append(root / 'delivery-manifest.json')
with zipfile.ZipFile(archive, 'x', zipfile.ZIP_DEFLATED) as z:
    for file in files:
        z.write(file, (Path(root.name) / file.relative_to(root)).as_posix())
with zipfile.ZipFile(archive) as z:
    if z.testzip() is not None:
        raise ValueError('ZIP CRC failed')
    for row in manifest['files']:
        if hashlib.sha256(z.read(root.name + '/' + row['file'])).hexdigest() != row['sha256']:
            raise ValueError('ZIP member hash failed')
print(json.dumps({'files': len(files), 'crc': 'PASS', 'sha256_members': 'PASS'}))
