"""Read-only format/digest evidence. No contents, decryption, or model calls."""
import hashlib, json, sys
from pathlib import Path

def inspect(path, name):
    try:
        data = Path(path).read_bytes(); tsd = b'TSD-Header' in data[:64]
        try:
            text = data.decode('utf-8-sig'); utf8 = True
        except UnicodeDecodeError:
            text = ''; utf8 = False
        if tsd: text = ''
        return dict(path=name, bytes=len(data), sha256=hashlib.sha256(data).hexdigest(),
                    tsdHeader=tsd, utf8=utf8, utf8Bom=data.startswith(b'\xef\xbb\xbf'),
                    crlf=text.count('\r\n'), bareLf=text.count('\n')-text.count('\r\n'))
    except OSError:
        return dict(path=name, unavailable=True)

def inspect_bundle(root, files):
    root = Path(root).resolve(); rows = []
    for item in files:
        name = item['path']; target = (root/name).resolve()
        if root not in target.parents: raise ValueError('Input path outside bundle')
        rows.append(inspect(target, name))
    return rows

if __name__ == '__main__':
    request = json.load(sys.stdin)
    print(json.dumps(inspect_bundle(request['root'], request['files']), ensure_ascii=True))
