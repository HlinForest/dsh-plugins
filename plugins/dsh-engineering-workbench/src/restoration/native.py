"""Read-only Altium evidence intake; no design generation or historical answers.

The first adapter supports one flat SchDoc and one PcbDoc. Raw OLE streams
are preserved even when a semantic decoder is unavailable.
"""
import collections
import hashlib
import json
import re
import struct
import sys
import zlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / 'vendor'))
import olefile

LIMIT = 64 * 1024 * 1024


def sha(data):
    return hashlib.sha256(data).hexdigest()


def dump(root, name, value):
    file = root / name
    file.parent.mkdir(parents=True, exist_ok=True)
    file.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding='utf-8')


def parameters(data, prefix=0):
    rows, offset = [], 0
    while offset < len(data):
        if offset + prefix + 4 > len(data):
            raise ValueError('truncated record length')
        length = struct.unpack_from('<I', data, offset + prefix)[0]
        end = offset + prefix + 4 + length
        if end > len(data):
            raise ValueError('record outside stream')
        fields, duplicates, errors = {}, [], []
        for part in data[offset + prefix + 4:end].rstrip(b'\0').split(b'|'):
            if b'=' not in part:
                continue
            key, raw = part.split(b'=', 1)
            key = key.decode('ascii', errors='replace')
            codec = 'utf-8' if key.upper().startswith('%UTF8%') else 'gb18030'
            try:
                value = raw.decode(codec)
            except UnicodeDecodeError:
                errors.append(key)
                value = raw.decode(codec, errors='replace')
            if key in fields:
                duplicates.append([key, fields[key], value])
            fields[key] = value
        if not fields:
            raise ValueError('not parameter framing')
        rows.append(dict(index=len(rows), offset=offset, length=length,
                         prefix_hex=data[offset:offset + prefix].hex(), fields=fields,
                         duplicate_fields=duplicates, decode_replacements=errors))
        offset = end
    return rows


def text(fields, key='Text'):
    return fields.get('%UTF8%' + key, fields.get(key, ''))


def connectivity(records, pins):
    """Bounded flat-sheet interpretation, explicitly not an Altium compiler."""
    unsupported = {'15', '16', '18', '26', '37', '209', '210', '211', '212', '213', '214'}
    kinds = {r['fields'].get('RECORD') for r in records}
    if kinds & unsupported:
        raise ValueError('Hierarchy, ports, buses or harness records need a native compiled netlist; types: ' + str(sorted(kinds & unsupported)))
    def number(f, key):
        return float(f.get(key, 0)) + float(f.get(key + '_Frac', 0)) / 100000
    def point(f):
        return (number(f, 'Location.X'), number(f, 'Location.Y'))
    segments, labels, junctions, ncs, endpoints = [], [], [], [], []
    for r in records:
        f = r['fields']; kind = f.get('RECORD')
        if kind == '27':
            points = [(number(f, 'X' + str(i)), number(f, 'Y' + str(i))) for i in range(1, int(f['LocationCount']) + 1)]
            segments.extend(zip(points, points[1:]))
        if kind in {'17', '25'}:
            labels.append((point(f), text(f)))
        if kind == '29':
            junctions.append(point(f))
        if kind == '22':
            ncs.append(point(f))
    for row in pins:
        f = row['fields']
        if int(f.get('PinConglomerate', 0)) & 4:
            raise ValueError('Hidden pin connectivity requires the native compiler')
        x, y = point(f); dx, dy = [(1, 0), (0, 1), (-1, 0), (0, -1)][int(f.get('PinConglomerate', 0)) % 4]
        length = number(f, 'PinLength')
        endpoints.append(dict(ref=row['reference'], pin=row['pin'], name=text(f, 'Name'),
                              endpoint=(x + dx * length, y + dy * length),
                              source_locator=row['source_locator'], electrical_raw=f.get('Electrical')))
    if len({(p['ref'], p['pin']) for p in endpoints}) != len(endpoints):
        raise ValueError('Repeated component/pin identity requires multi-unit interpretation')
    points = set(junctions + ncs + [p['endpoint'] for p in endpoints] + [p for p, _ in labels] + [p for segment in segments for p in segment])
    if len(points) * len(segments) > 10000000:
        raise ValueError('Flat-sheet connectivity exceeds this adapter limit')
    parents = {p: p for p in points}
    def find(p):
        while parents[p] != p:
            parents[p] = parents[parents[p]]; p = parents[p]
        return p
    def union(a, b):
        parents[find(a)] = find(b)
    for a, b in segments:
        for p in points:
            cross = (p[0] - a[0]) * (b[1] - a[1]) - (p[1] - a[1]) * (b[0] - a[0])
            if abs(cross) < 1e-8 and min(a[0], b[0]) - 1e-8 <= p[0] <= max(a[0], b[0]) + 1e-8 and min(a[1], b[1]) - 1e-8 <= p[1] <= max(a[1], b[1]) + 1e-8:
                union(a, p)
    named = {}
    for p, name in labels:
        if not name:
            continue
        if name in named:
            union(p, named[name])
        named[name] = p
    groups = collections.defaultdict(list)
    for p in endpoints:
        groups[find(p['endpoint'])].append([p['ref'], p['pin']])
    return dict(pins=endpoints, nets=[dict(nodes=sorted(nodes), labels=sorted({n for p, n in labels if find(p) == group}), nc=any(find(p) == group for p in ncs)) for group, nodes in groups.items()],
                method='Single flat sheet: wire endpoints, junctions, pin endpoints, NC and exact label names. Not an Altium compiled netlist.')


def extract(root, sources):
    streams, parsed, issues, warnings = {}, {}, [], []
    for kind in ['schematic', 'pcb']:
        source = root / sources[kind]; data = source.read_bytes()
        if not olefile.isOleFile(data):
            raise ValueError('Unreadable/protected Altium container; export from original software: ' + source.name)
        index = []
        with olefile.OleFileIO(data) as ole:
            for i, locator in enumerate(ole.listdir()):
                name = '/'.join(locator)
                if ole.get_size(locator) > LIMIT:
                    raise ValueError('Native stream exceeds 64 MiB: ' + name)
                raw = ole.openstream(locator).read(); streams[kind, name] = raw
                base = '02_extracted/native_' + kind + '/'
                output = base + 'streams/' + str(i).zfill(3) + '_' + re.sub(r'[^A-Za-z0-9_.-]', '_', name) + '.bin'
                (root / output).parent.mkdir(parents=True, exist_ok=True); (root / output).write_bytes(raw)
                row = dict(source_file=sources[kind], source_sha256=sha(data), source_locator=name, kind='native_ole_stream', output=output, bytes=len(raw), sha256=sha(raw), interpretation='raw_preserved')
                if name.endswith('/Header') and len(raw) == 4:
                    row['declared_header_uint32'] = struct.unpack('<I', raw)[0]
                if (kind == 'schematic' and name == 'FileHeader') or (kind == 'pcb' and name.endswith('/Data')):
                    for prefix in [0, 2, 1]:
                        try:
                            records = parameters(raw, prefix)
                        except ValueError:
                            continue
                        if not records:
                            continue
                        for record in records:
                            record.update(source_file=sources[kind], source_sha256=sha(data), source_locator=dict(stream=name, record_index=record['index'], byte_offset=record['offset']), kind='native_parameter_record')
                        parsed[kind, name] = records
                        records_file = base + re.sub(r'[^A-Za-z0-9_.-]', '_', name) + '.records.json'
                        # Binary geometry remains authoritative; printable fragments are not a typed decoder.
                        scope = 'parameter_fragments_from_mixed_binary_records' if kind == 'pcb' and name.split('/')[0] in {'ComponentBodies6', 'ShapeBasedComponentBodies6', 'Regions6', 'ShapeBasedRegions6', 'PadViaLibrary', 'PadViaLibraryCache', 'PrimitiveParameters'} else 'parameter_records'
                        dump(root, records_file, dict(source_file=sources[kind], source_sha256=sha(data), stream=name, prefix_bytes=prefix, count=len(records), records=records, decoding_scope=scope))
                        row.update(interpretation=scope, records=len(records), records_file=records_file)
                        break
                index.append(row)
        dump(root, '02_extracted/native_' + kind + '/stream_index.json', dict(source_file=sources[kind], streams=index, warning='Raw streams preserved; unparsed binary objects require a typed parser or original software.'))
    records = parsed.get(('schematic', 'FileHeader'))
    if not records:
        raise ValueError('Unsupported schematic FileHeader encoding; raw streams preserved')
    children = collections.defaultdict(list)
    for row in records:
        # SwapIDPart can carry binary swap metadata in otherwise textual pins.
        # Preserve it in the raw stream; never silently certify the decoded value.
        if row['decode_replacements']:
            warnings.append(dict(record=row['index'], undecodedFields=row['decode_replacements'], rawSource=row['source_locator']))
        if set(row['decode_replacements']) - {'SwapIDPart'} or row['duplicate_fields']:
            issues.append('Ambiguous text encoding/duplicate fields at schematic record ' + str(row['index']))
        if 'OwnerIndex' in row['fields']:
            children[int(row['fields']['OwnerIndex']) + 1].append(row)
    components, pins = [], []
    for row in records:
        if row['fields'].get('RECORD') != '1':
            continue
        owned = children[row['index']]
        designators = [x for x in owned if x['fields'].get('RECORD') == '34']
        reference = text(designators[0]['fields']) if len(designators) == 1 else None
        if reference is None:
            issues.append('Missing/ambiguous component designator at ' + str(row['index']))
        pinrows = [x for x in owned if x['fields'].get('RECORD') == '2']
        implementations = [item for x in owned if x['fields'].get('RECORD') == '44' for item in children[x['index']] if item['fields'].get('RECORD') == '45']
        components.append(dict(source_file=row['source_file'], source_locator=row['source_locator'], kind='schematic_component', reference=reference, raw_fields=row['fields'],
                               parameters=[dict(name=text(x['fields'], 'Name'), value=text(x['fields']), source_locator=x['source_locator'], raw_fields=x['fields']) for x in owned if x['fields'].get('RECORD') == '41'],
                               implementations=implementations, pins=pinrows, owned_record_indices=[x['index'] for x in owned]))
        pins.extend(dict(reference=reference, pin=text(x['fields'], 'Designator'), **x) for x in pinrows)
    if len({c['reference'] for c in components}) != len(components):
        issues.append('Repeated designators require hierarchical/multi-unit interpretation')
    base = '02_extracted/native_schematic/'
    dump(root, base + 'components.json', components); dump(root, base + 'pins.json', pins)
    for label, types in {'wires': ['27'], 'junctions': ['29'], 'power_ports': ['17'], 'no_connect': ['22'], 'page_settings': ['31'], 'parameters': ['41'], 'labels': ['25']}.items():
        dump(root, base + label + '.json', [r for r in records if r['fields'].get('RECORD') in types])
    try:
        graph = connectivity(records, pins)
        graph['source_file'] = sources['schematic']
        dump(root, base + 'recomputed_connectivity.json', graph)
    except ValueError as error:
        issues.append(str(error))
    models = []
    for i, row in enumerate(parsed.get(('pcb', 'Models/Data'), [])):
        try:
            packed = streams['pcb', 'Models/' + str(i)]
            decoder = zlib.decompressobj(); model = decoder.decompress(packed, LIMIT + 1)
            if len(model) > LIMIT or not decoder.eof or not model.startswith(b'ISO-10303-21;'):
                raise ValueError('Unsupported or oversized model')
            filename = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', row['fields'].get('NAME', 'model.step').replace('\\', '/').split('/')[-1])
            dest = '04_assets/native_models/model_' + str(i).zfill(2) + '_' + filename
            (root / dest).parent.mkdir(parents=True, exist_ok=True); (root / dest).write_bytes(model)
            models.append(dict(source_file=sources['pcb'], source_locator='Models/' + str(i), kind='embedded_STEP', metadata=row['fields'], path=dest, sha256=sha(model)))
        except (KeyError, ValueError, zlib.error) as error:
            issues.append('Embedded model ' + str(i) + ': ' + str(error))
    dump(root, '04_assets/native_models/manifest.json', models)
    if ('pcb', 'EmbeddedFonts6/Data') in streams:
        dest = root / '04_assets/native_fonts/EmbeddedFonts6_Data.bin'; dest.parent.mkdir(parents=True, exist_ok=True); dest.write_bytes(streams['pcb', 'EmbeddedFonts6/Data'])
    if not components or not pins:
        issues.append('No electrical components/pins decoded')
    return dict(adapter='altium-flat-ole/1', eligible=not issues, issues=issues, warnings=warnings, components=len(components), pins=len(pins), embeddedModels=len(models),
                completeOneToOneVerified=False, originalCompilerAvailable=False, python=sys.version, olefile=olefile.__version__, extractorSha256=sha(Path(__file__).read_bytes()))


if __name__ == '__main__':
    request = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8-sig'))
    root = Path(request['root'])
    result = extract(root, request['sources'])
    dump(root, 'extraction.json', result)
    print(json.dumps(result, ensure_ascii=True))
