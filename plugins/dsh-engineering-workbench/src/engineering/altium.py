"""Pinned altium-monkey adapter. Offline results are never AD-native validation."""
import hashlib, json, math, sys, re
from pathlib import Path
from importlib.metadata import version
from collections import Counter
from altium_monkey import AltiumDesign, AltiumSchDoc, AltiumPcbDoc, SchPointMils, AltiumSchWire, make_sch_junction, make_sch_net_label
from altium_monkey.altium_symbol_transform import to_symbol_space, to_schematic_space, generate_unique_id
from altium_monkey.altium_schdoc_info import SchComponentInfo

if version('altium-monkey') != '2026.9.22':
    raise RuntimeError('altium-monkey version mismatch')

request = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
source = Path(request['file']); out = Path(request['output']); out.mkdir(parents=True, exist_ok=True)
MM = .0254

def point(obj):
    p = obj.get_hot_spot() if hasattr(obj, 'get_hot_spot') else obj.location_mils if hasattr(obj, 'location_mils') else obj.location
    return [float(p.x_mils) * MM, -float(p.y_mils) * MM]

def serial(obj):
    return obj.serialize_to_record()

def identity(doc, obj):
    uid = getattr(obj, 'unique_id', '')
    return f'{doc}#{uid}' if uid else ''

def read():
    ext = source.suffix.lower()
    if ext == '.pcbdoc':
        pcb = AltiumPcbDoc.from_file(source)
        svg = pcb.to_svg(); preview = out / 'board.svg'; preview.write_text(svg, encoding='utf-8')
        vb = re.search(r'viewBox="([^"]+)"', svg)
        dims = [float(n) for n in vb.group(1).split()] if vb else [0, 0, 1200, 900]
        components, nets = [], {}
        for index, component in enumerate(pcb.components):
            ident = f'{source.name}#{component.unique_id or index}'
            pins = []
            for pad in pcb.pads:
                if pad.component_index != index: continue
                pin = str(pad.designator); pins.append({'number': pin})
                if pad.net_index is not None and 0 <= pad.net_index < len(pcb.nets):
                    name = pcb.nets[pad.net_index].name
                    nets.setdefault(name, {'name': name, 'nodes': []})['nodes'].append({'component': ident, 'pin': pin})
            x, y = component.get_x_mils() * MM, component.get_y_mils() * MM
            components.append({'id': ident, 'uuid': component.unique_id, 'ref': component.designator, 'document': source.name,
                               'value': (component.parameters or {}).get('Value', ''), 'footprint': component.footprint, 'pins': pins,
                               'at': [x, -y], 'position': {'x': x, 'y': y, 'side': component.layer}, 'dnp': None})
        return {'format': 'altium-pcb', 'components': components, 'nets': list(nets.values()), 'objects': [], 'documents': [{'id': source.name, 'file': str(source), 'instances': 1}],
                'previews': [{'file': str(preview), 'width': dims[2], 'height': dims[3]}],
                'coverage': {'connectivity': 'pcb-pad-net-assignment', 'nativeValidation': 'not_performed', 'assembly': 'unknown'}}
    design = AltiumDesign.from_prjpcb(source) if ext == '.prjpcb' else AltiumDesign.from_schdoc(source)
    graph = design.to_json(include_pnp=False)
    (out / 'altium-graph.json').write_text(json.dumps(graph, ensure_ascii=False), encoding='utf-8')
    components, objects, docs, previews = [], [], [], []
    for doc in design.schdocs:
        name = str(doc.filepath.relative_to(source.parent)).replace('\\', '/')
        docs.append({'id': name, 'file': str(doc.filepath), 'instances': 1})
        svg = doc.to_svg(); dest = out / f'page-{len(docs)}.svg'; dest.write_text(svg, encoding='utf-8')
        vb = re.search(r'viewBox="([^"]+)"', svg)
        dims = [float(n) for n in vb.group(1).split()] if vb else [0, 0, 1200, 900]
        previews.append({'file': str(dest), 'name': name, 'width': dims[2], 'height': dims[3]})
        for obj in doc.objects:
            uid = getattr(obj, 'unique_id', '')
            if not uid: continue
            row = {'id': identity(name, obj), 'uuid': uid, 'document': name, 'kind': type(obj).__name__, 'record': serial(obj)}
            parent, seen = getattr(obj, 'parent', None), set()
            while parent is not None and id(parent) not in seen:
                seen.add(id(parent))
                if type(parent).__name__ == 'AltiumSchComponent':
                    row['ownerComponent'] = identity(name, parent); break
                parent = getattr(parent, 'parent', None)
            if hasattr(obj, 'location_mils'): row['at'] = point(obj)
            if hasattr(obj, 'points_mils'): row['points'] = [[float(p.x_mils) * MM, -float(p.y_mils) * MM] for p in obj.points_mils]
            if type(obj).__name__ == 'AltiumSchComponent':
                info = SchComponentInfo(obj)
                row['properties'] = {p.name: p.text for p in info.parameters}
                row['pins'] = [{'number': str(p.designator), 'name': str(p.name), 'at': point(p)} for p in info.pins]
            objects.append(row)
        for obj in doc.components:
            info = SchComponentInfo(obj)
            matches = [c for c in graph['components'] if c.get('source_unique_id') == info.unique_id and c.get('hierarchy', {}).get('sheet') == doc.filepath.name]
            for c in matches:
                repeated = len(matches) > 1 or c.get('ambiguous_physical_designator', False)
                docs[-1]['instances'] = max(docs[-1]['instances'], len(matches))
                ident = identity(name, obj) + ('@' + c['designator'] if repeated else '')
                components.append({'id': ident, 'uuid': info.unique_id, 'document': name, 'ref': c['designator'],
                    'value': c.get('value', ''), 'libId': c.get('library_ref', ''), 'footprint': c.get('footprint', ''),
                    'dnp': c.get('dnp'), 'at': point(obj), 'repeated': repeated,
                    'properties': c.get('parameters', {}), 'pins': [{'number': str(p.designator), 'name': str(p.name), 'at': point(p)} for p in info.pins]})
    by_ref = {c['ref']: c['id'] for c in components}
    nets = [{'name': n['name'], 'nodes': [{'component': by_ref.get(t['designator']), 'ref': t['designator'], 'pin': str(t['pin'])} for t in n.get('terminals', [])]} for n in graph['nets']]
    complete = bool(components) and all(p['component'] for n in nets for p in n['nodes']) and all(c['pins'] for c in components)
    if ext == '.schdoc' and any(len(d.sheet_symbols) for d in design.schdocs): complete = False
    return {'format': 'altium', 'components': components, 'nets': nets, 'objects': objects, 'documents': docs, 'previews': previews,
            'coverage': {'connectivity': 'complete' if complete else 'partial', 'nativeValidation': 'not_performed', 'assembly': 'offline-project-variant', 'alternatePartVariants': 'not_supported'},
            'engine': {'name': 'altium-monkey', 'version': version('altium-monkey')}}

def modify():
    doc = AltiumSchDoc(source)
    def owners(obj):
        result, visited = [], set()
        parent = getattr(obj, 'parent', None)
        while parent is not None and id(parent) not in visited:
            visited.add(id(parent))
            uid = getattr(parent, 'unique_id', '')
            if uid: result.append(uid)
            parent = getattr(parent, 'parent', None)
        return result
    original_records = [(getattr(o, 'unique_id', ''), owners(o), serial(o)) for o in doc.objects]
    before = {getattr(o, 'unique_id', ''): serial(o) for o in doc.objects if getattr(o, 'unique_id', '')}
    declared = set()
    for op in request['operations']:
        uid = op.get('id', '').split('#')[-1]
        matches = [o for o in doc.objects if getattr(o, 'unique_id', '') == uid]
        if op['op'] in ('properties', 'delete', 'move', 'rotate'):
            if len(matches) != 1: raise ValueError('Object identity is not unique')
            obj = matches[0]; declared.add(uid)
            def children(parent):
                for child in getattr(parent, 'children', []):
                    yield child
                    yield from children(child)
            owned_by_tree = list(children(obj))
            # Pin-owned hidden-net parameters are represented by native parent
            # links but are not always present in the public children list.
            owned = list({id(child): child for child in owned_by_tree + [child for child in doc.objects if uid in owners(child)]}.values())
            declared.update(getattr(child, 'unique_id', '') for child in owned)
            if op['op'] == 'delete': doc.remove_object(obj)
            elif op['op'] in ('move', 'rotate'):
                info = SchComponentInfo(obj)
                old_pins = [(pin, point(pin)) for pin in info.pins]
                locals_ = [(child, to_symbol_space(child, obj)) for child in owned if hasattr(child, 'location')]
                if op['op'] == 'move':
                    x, y = op['at']; obj.location_mils = SchPointMils.from_mils(float(x) / MM, -float(y) / MM)
                else:
                    orient = getattr(obj.orientation, 'value', obj.orientation)
                    obj.orientation = type(obj.orientation)((int(orient) + 1) % 4)
                for child, local in locals_:
                    moved = to_schematic_space(local, obj, regenerate_id=False)
                    # Copy geometry only. In particular retain raw unknown fields, ownership,
                    # drawing order, implementation links and library identity on the live record.
                    for field in ('location', 'corner', 'vertices', 'points', 'orientation', 'pin_conglomerate'):
                        if hasattr(moved, field): setattr(child, field, getattr(moved, field))
                if not op.get('disconnect', False):
                    for pin, old_point in old_pins:
                        new_point = point(pin)
                        if old_point == new_point: continue
                        equal = lambda p: abs(p.x_mils * MM - old_point[0]) < .001 and abs(-p.y_mils * MM - old_point[1]) < .001
                        attached_wires = [wire for wire in doc.wires if any(equal(p) for p in wire.points_mils)]
                        attached = bool(attached_wires)
                        anchored = any(abs(point(label)[0] - old_point[0]) < .001 and abs(point(label)[1] - old_point[1]) < .001 for label in list(doc.net_labels) + list(doc.junctions) + list(doc.power_ports))
                        if len(attached_wires) == 1 and not anchored:
                            wire = attached_wires[0]
                            wire.points_mils = [SchPointMils.from_mils(new_point[0] / MM, -new_point[1] / MM) if equal(p) else p for p in wire.points_mils]
                            declared.add(wire.unique_id)
                            continue
                        if attached:
                            points = [old_point, new_point]
                            for a, b in zip(points, points[1:]):
                                if a == b: continue
                                wire = AltiumSchWire(); wire.unique_id = generate_unique_id()
                                for x, y in (a, b): wire.add_point(x / MM, -y / MM)
                                doc.add_object(wire)
            else:
                info = SchComponentInfo(obj)
                for key, val in op.get('properties', {}).items():
                    if key == 'Footprint':
                        implementations = [c for c in owned if type(c).__name__ == 'AltiumSchImplementation' and getattr(c, 'is_current', False) and getattr(c, 'model_type', '').upper() == 'PCBLIB']
                        if len(implementations) != 1: raise ValueError('Current footprint implementation is not unique')
                        implementations[0].model_name = str(val)
                        continue
                    if key not in ('Value', 'Comment', 'Datasheet'): raise ValueError('AD property edit requires an existing Value, Comment or Datasheet parameter')
                    params = [p for p in info.parameters if p.name.lower() == key.lower()]
                    if key == 'Value' and not params:
                        params = [p for p in info.parameters if p.name.lower() == 'comment']
                    if len(params) != 1: raise ValueError('Parameter identity is not unique')
                    params[0].text = str(val)
        elif op['op'] == 'wire':
            wire = AltiumSchWire(); wire.unique_id = generate_unique_id()
            for x, y in [op['from'], op['to']]: wire.add_point(float(x) / MM, -float(y) / MM)
            doc.add_object(wire)
        elif op['op'] in ('label', 'junction'):
            x, y = op['at']; at = SchPointMils.from_mils(float(x) / MM, -float(y) / MM)
            obj = make_sch_junction(location_mils=at) if op['op'] == 'junction' else make_sch_net_label(location_mils=at, text=op['text'])
            obj.unique_id = generate_unique_id(); doc.add_object(obj)
        elif op['op'] == 'add-component':
            if not op.get('library') or not op.get('symbolName') or not op.get('ref'):
                raise ValueError('Explicit SchLib, symbol name and reference required')
            if any(SchComponentInfo(c).designator == op['ref'] for c in doc.components): raise ValueError('Duplicate designator')
            x, y = op['at']; obj = doc.add_component_from_library(op['library'], op['symbolName'], op['ref'], x / MM, -y / MM)
            if not SchComponentInfo(obj).pins: raise ValueError('Symbol has no pin definition')
            for p in SchComponentInfo(obj).parameters:
                if p.name.lower() in ('value', 'comment'): p.text = str(op.get('value', ''))
        else:
            raise ValueError('Unknown AD edit operation: ' + op['op'])
    target = Path(request['destination']); doc.save(target)
    reread = AltiumSchDoc(target)
    after = {getattr(o, 'unique_id', ''): serial(o) for o in reread.objects if getattr(o, 'unique_id', '')}
    # Preserve unrelated record payloads, including fields unknown to this adapter.
    ignored = {'OWNERINDEX', 'INDEXINSHEET'}
    stable = lambda d: {k: v for k, v in d.items() if k.upper() not in ignored}
    changed = [uid for uid, record in before.items() if uid not in declared and (uid not in after or stable(record) != stable(after[uid]))]
    after_owners = {getattr(o, 'unique_id', ''): owners(o) for o in reread.objects if getattr(o, 'unique_id', '')}
    changed += [uid for uid, parents, _ in original_records if uid and uid not in declared and after_owners.get(uid) != parents]
    def anonymous(records):
        return Counter(json.dumps([parents, stable(record)], sort_keys=True, default=str) for uid, parents, record in records if not uid and not any(p in declared for p in parents))
    # Unknown records often have no UID. Their payload and native owner chain must
    # survive as a multiset; checking only named objects would miss their loss.
    old_anonymous = anonymous(original_records)
    new_anonymous = anonymous([(getattr(o, 'unique_id', ''), owners(o), serial(o)) for o in reread.objects])
    if old_anonymous - new_anonymous: changed.append('anonymous-record-or-owner')
    if changed:
        target.unlink(missing_ok=True)
        raise ValueError('Unexpected changes outside selected scope: ' + ', '.join(changed[:10]))
    return {'candidate': str(target), 'nativeValidation': 'not_performed', 'reread': True}

print(json.dumps(read() if request['action'] == 'read' else modify(), ensure_ascii=False, default=str))
