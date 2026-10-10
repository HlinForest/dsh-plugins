"""Package public demo artifacts and plugin sources, excluding private runtimes."""
from pathlib import Path
import hashlib
import json
import zipfile

DEMO = Path(__file__).resolve().parents[1]
PROJECT = DEMO.parent
EXCLUDED = {'__pycache__', 'workspace', 'replays', 'node_modules', 'web-profile.yml'}
VERSION = json.loads((PROJECT / 'package.json').read_text(encoding='utf-8'))['version']
PACKAGE = PROJECT / f'dsh-megmeet-{VERSION}.tgz'
verification = json.loads((DEMO / 'verification.json').read_text(encoding='utf-8'))
assert verification['pass'] and verification['pairedModelRun']['pass']
assert verification['credentialValuesAbsentFromArtifacts']
assert verification['offlinePageChecks']['pass']
assert PACKAGE.exists()

def files_under(root):
    return sorted(p for p in root.rglob('*') if p.is_file()
                  and not EXCLUDED.intersection(p.relative_to(root).parts)
                  and p.suffix != '.zip')

demo_files = [p for p in files_under(DEMO) if p.name != 'artifact-manifest.json']
manifest = {
    'plugin': f'dsh-megmeet@{VERSION}',
    'snapshotDate': '2026-10-09',
    'files': [{'path': p.relative_to(PROJECT).as_posix(),
               'bytes': p.stat().st_size,
               'sha256': hashlib.sha256(p.read_bytes()).hexdigest()}
              for p in [PACKAGE, *demo_files]],
}
(DEMO / 'artifact-manifest.json').write_text(
    json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

demo_zip = PROJECT / 'dsh-megmeet-real-demo-20261009.zip'
source_zip = PROJECT / f'dsh-megmeet-source-{VERSION}.zip'
with zipfile.ZipFile(demo_zip, 'w', zipfile.ZIP_DEFLATED) as archive:
    archive.write(PACKAGE, PACKAGE.name)
    for filename in files_under(DEMO):
        archive.write(filename, 'real-demo/' + filename.relative_to(DEMO).as_posix())
    archive.writestr('START-HERE.txt',
                    'Open real-demo/index.html to view the offline demo.\n'
                    'See real-demo/README.md for source provenance, tests and desktop installation.\n'
                    'Original public documents retain their authorship. Plugin code is MIT licensed.\n')
with zipfile.ZipFile(source_zip, 'w', zipfile.ZIP_DEFLATED) as archive:
    for directory in ['src', 'lib', 'test', 'examples', 'scripts']:
        for filename in files_under(PROJECT / directory):
            archive.write(filename, filename.relative_to(PROJECT).as_posix())
    for name in ['package.json', 'package-lock.json', 'tsconfig.json', 'cordis.patch.yml', 'README.md', 'LICENSE']:
        archive.write(PROJECT / name, name)

for target in [demo_zip, source_zip]:
    with zipfile.ZipFile(target) as archive:
        assert archive.testzip() is None
        assert not any(EXCLUDED.intersection(Path(n).parts) for n in archive.namelist())
    print(json.dumps({'file': target.name, 'bytes': target.stat().st_size,
                      'sha256': hashlib.sha256(target.read_bytes()).hexdigest()}))

with zipfile.ZipFile(demo_zip) as archive:
    for entry in manifest['files']:
        data = archive.read(entry['path'])
        assert len(data) == entry['bytes']
        assert hashlib.sha256(data).hexdigest() == entry['sha256']
print(json.dumps({'archivedFilesHashVerified': len(manifest['files']), 'pass': True}))
