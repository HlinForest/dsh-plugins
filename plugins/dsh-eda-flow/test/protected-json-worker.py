"""Test-only filesystem fault: runtime JSON exports cannot be parsed as text."""
import sys
import runpy
from pathlib import Path

runtime_root = Path(sys.argv[1]).resolve()
script = Path(sys.argv[2]).resolve()
package = Path(__file__).resolve().parents[1]
original_write = Path.write_text
original_read = Path.read_text

def runtime_json(path):
    normalized = str(path.resolve())
    if normalized.startswith('\\\\?\\'):
        normalized = normalized[4:]
    return path.suffix in ('.json', '.jsonl') and Path(normalized).is_relative_to(runtime_root)

def write(path, data, *args, **kwargs):
    return original_write(path, '%TSD-Header-test-export' if runtime_json(path) else data, *args, **kwargs)

def read(path, *args, **kwargs):
    if runtime_json(path):
        raise AssertionError('Runtime JSON file read bypassed the record store: ' + str(path))
    return original_read(path, *args, **kwargs)

Path.write_text = write
Path.read_text = read
sys.path.insert(0, str(script.parent))
sys.argv = sys.argv[2:]
runpy.run_path(str(script), run_name='__main__')
