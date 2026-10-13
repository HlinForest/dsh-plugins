"""Compare design content, independent of random object IDs and storage ordering.

Geometry point order is retained. Only unordered EDA object containers are sorted.
UUID association correctness is checked separately before a snapshot is accepted.
"""
import collections, csv, hashlib, io, json, re
from pathlib import Path
import sexpdata as sx

UUID = re.compile(r'[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}')
UNORDERED = {'kicad_pcb', 'kicad_sch', 'kicad_symbol_lib', 'footprint', 'lib_symbols', 'symbol'}


def canonical(node, identities=None):
    if not isinstance(node, list):
        if isinstance(node, str):
            text = UUID.sub(lambda match: '<ref:' + identities.get(match[0], 'unresolved:' + match[0]) + '>' if identities is not None else '<object-id>', str(node))
            return re.sub(r'(?<=:)AUX_\d+$|^AUX_\d+$', 'AUX', text)
        return node
    if not node:
        return []
    tag = str(node[0])
    if tag in {'uuid', 'tstamp'}:
        return None
    values = [canonical(x, identities) for x in node[1:]]
    values = [x for x in values if x is not None]
    if tag in UNORDERED:
        # Container scalars (e.g. footprint library ID) stay before child records.
        scalars = [x for x in values if not isinstance(x, list)]
        records = [x for x in values if isinstance(x, list)]
        values = scalars + sorted(records, key=lambda x: json.dumps(x, ensure_ascii=True))
    return [tag] + values


def identity_index(trees):
    """Map an object's ID to its design identity before resolving reference edges."""
    lookup = {}
    def walk(node):
        if not isinstance(node, list): return
        own = next((v for v in node if isinstance(v, list) and len(v) == 2 and str(v[0]) in {'uuid', 'tstamp'}), None)
        if own and str(own[1]) not in lookup:
            lookup[str(own[1])] = hashlib.sha256(json.dumps(canonical(node), ensure_ascii=False).encode()).hexdigest()
        for child in node: walk(child)
    for tree in trees: walk(tree)
    return lookup


def content_hash(name, data, external=None):
    suffix = Path(name).suffix.lower()
    if suffix in {'.step', '.stp'}:
        return hashlib.sha256(data).hexdigest()
    text = data.decode('utf-8-sig').replace('\r\n', '\n')
    if suffix.startswith('.kicad_') and suffix != '.kicad_pro' or name.endswith('lib-table'):
        trees = sx.parse(text)
        identities = {**(external or {}), **identity_index(trees)}
        data = json.dumps([canonical(x, identities) for x in trees], ensure_ascii=False, separators=(',', ':')).encode()
    elif suffix == '.kicad_pro':
        data = json.dumps(json.loads(text), sort_keys=True).encode()
    elif suffix == '.csv':
        rows = list(csv.reader(io.StringIO(UUID.sub('<object-id>', text))))
        # Table row order is not design data; retain headers, exact cells and multiplicity.
        data = json.dumps(rows[:1] + sorted(rows[1:]), ensure_ascii=False).encode()
    else:
        # Diagnostic CSV UUIDs are volatile too; textual source values remain exact.
        data = UUID.sub('<object-id>', text).encode()
    return hashlib.sha256(data).hexdigest()


def include(name):
    parts = Path(name).parts
    return not any(p in {'checks', 'previews', 'reference', 'native_original', 'assets', 'provisional.pretty'} for p in parts) and (
        Path(name).suffix.lower() in {'.kicad_sch', '.kicad_pcb', '.kicad_pro', '.kicad_sym', '.kicad_mod', '.kicad_dru', '.step', '.stp', '.csv'}
        or Path(name).name in {'sym-lib-table', 'fp-lib-table'})


def snapshot(items):
    items = list(items)
    # PCB path references resolve to schematic object content; group/member paths
    # resolve against the owning file. Unknown references stay visible in the hash.
    schematic_ids = {}
    for name, data in items:
        if include(name) and name.endswith('.kicad_sch'):
            schematic_ids.update(identity_index(sx.parse(data.decode('utf-8-sig'))))
    files, auxiliary = {}, collections.defaultdict(list)
    for name, data in items:
        if not include(name):
            continue
        value = content_hash(name, data, schematic_ids)
        if re.search(r'/AUX_\d+\.kicad_mod$', name):
            auxiliary[str(Path(name).parent).replace('\\', '/')].append(value)
        else:
            files[name] = value
    # Auxiliary copper instances have no electrical identity; preserve geometry and multiplicity.
    for folder, values in auxiliary.items():
        for i, value in enumerate(sorted(values)):
            files[f'{folder}/AUX-geometry-{i:03d}'] = value
    return dict(sorted(files.items()))


def project_snapshot(root):
    root = Path(root)
    return snapshot((f.relative_to(root).as_posix(), f.read_bytes()) for f in sorted(root.rglob('*')) if f.is_file())


def associations(root):
    root = Path(root)
    schematics = list(root.glob('*.kicad_sch')); boards = list(root.glob('*.kicad_pcb'))
    if len(schematics) != 1 or len(boards) != 1:
        raise ValueError('Expected one schematic and one PCB for this adapter')
    sch = sx.loads(schematics[0].read_text(encoding='utf-8')); pcb = sx.loads(boards[0].read_text(encoding='utf-8'))
    tag = lambda x: str(x[0]) if isinstance(x, list) and x else ''
    child = lambda x, t: next((v for v in x if tag(v) == t), None)
    props = lambda x: {v[1]: v[2] for v in x if tag(v) == 'property'}
    root_id = str(child(sch, 'uuid')[1]); symbols = {props(s)['Reference']: str(child(s, 'uuid')[1]) for s in sch if tag(s) == 'symbol'}
    seen = set(); matched = 0
    for fp in [x for x in pcb if tag(x) == 'footprint']:
        ref = props(fp).get('Reference', '')
        if not ref:
            continue
        if ref in seen or ref not in symbols:
            raise ValueError('Duplicate/unassociated PCB reference: ' + ref)
        seen.add(ref)
        value = child(fp, 'path')
        if not value or value[1] != '/' + root_id + '/' + symbols[ref]:
            raise ValueError('Schematic/PCB identity mismatch: ' + ref)
        matched += 1
    for filename in [schematics[0], boards[0]]:
        tree = sx.loads(filename.read_text(encoding='utf-8')); ids = []
        def walk(x, dimension_id=None):
            if tag(x) == 'uuid':
                if x[1] != dimension_id: ids.append(x[1])
            elif isinstance(x, list):
                dim = child(x, 'uuid') if tag(x) == 'dimension' else None
                for y in x:
                    # KiCad serializes dimension-owned text with its parent's UUID.
                    # It is not a second independent board object.
                    walk(y, dim[1] if dim and tag(y) == 'gr_text' else dimension_id)
        walk(tree)
        if len(ids) != len(set(ids)):
            raise ValueError('Duplicate object UUID: ' + filename.name)
    return {'matched': matched, 'uniqueObjectIdentities': True}
