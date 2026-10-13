"""Check declared project-local libraries, independently of embedded drawings."""
from pathlib import Path
import sexpdata as sx

def children(node, name):
    return [v for v in node if isinstance(v, list) and v and str(v[0]) == name]

def field(node, name, default=''):
    rows = children(node, name)
    return str(rows[0][1]) if rows and len(rows[0]) > 1 else default

def library_dependencies(project, schematic):
    base = Path(project).resolve().parent
    libraries, issues, symbol_names = {}, [], {}
    for table_name in ('sym-lib-table', 'fp-lib-table'):
        table = base / table_name
        if not table.is_file():
            continue
        try:
            entries = children(sx.loads(table.read_text(encoding='utf-8')), 'lib')
        except Exception as exc:
            issues.append({'table': table_name, 'reason': 'invalid table', 'detail': str(exc)})
            continue
        for lib in entries:
            name, uri = field(lib, 'name'), field(lib, 'uri')
            target = Path(uri.replace('${KIPRJMOD}', str(base)))
            if not target.is_absolute():
                target = base / target
            local = target.resolve().is_relative_to(base)
            valid = local and (target.is_dir() if table_name == 'fp-lib-table' else target.is_file())
            libraries[(table_name, name)] = target if valid else None
            if not valid:
                issues.append({'table': table_name, 'library': name, 'uri': uri,
                               'reason': 'missing or outside delivery directory'})
            elif table_name == 'sym-lib-table':
                try:
                    content = sx.loads(target.read_text(encoding='utf-8'))
                    if not isinstance(content,list) or not content or str(content[0]) != 'kicad_symbol_lib':
                        raise ValueError('not a KiCad symbol library')
                    symbol_names[name] = {str(s[1]) for s in children(content,'symbol')}
                except Exception as exc:
                    issues.append({'table':table_name,'library':name,'uri':uri,'reason':'invalid symbol library','detail':str(exc)})
    assignments, parsed = [], {}
    def resolve_footprint(ref, footprint):
        if ':' not in footprint:
            return {'reference': ref, 'footprint': footprint, 'resolved': False,
                    'reason': 'unqualified footprint; no project-local library mapping'}
        lib, part = footprint.split(':', 1)
        folder = libraries.get(('fp-lib-table', lib))
        target = folder / (part + '.kicad_mod') if folder else None
        resolved = bool(target and target.resolve().is_relative_to(base) and target.is_file())
        if resolved and str(target) not in parsed:
            try:
                content = sx.loads(target.read_text(encoding='utf-8'))
                parsed[str(target)] = bool(isinstance(content, list) and content and str(content[0]) in ('footprint', 'module'))
            except Exception:
                parsed[str(target)] = False
        valid = resolved and parsed[str(target)]
        return {'reference': ref, 'footprint': footprint, 'resolved': bool(valid),
                'reason': 'local footprint file exists and parses' if valid else 'missing, nonlocal or invalid footprint file'}
    for symbol in children(schematic, 'symbol'):
        props = {str(p[1]): str(p[2]) for p in children(symbol, 'property') if len(p) > 2}
        lib_id = field(symbol,'lib_id')
        if lib_id:
            parts=lib_id.split(':',1)
            if len(parts)!=2 or parts[1] not in symbol_names.get(parts[0],set()):
                issues.append({'reference':props.get('Reference',''),'libId':lib_id,'reason':'symbol definition not found in valid project-local library'})
        footprint = props.get('Footprint', '')
        if not footprint:
            continue
        ref = props.get('Reference', '')
        assignments.append(resolve_footprint(ref, footprint))
    board_assignments, embedded_only = [], 0
    board_file = Path(project).with_suffix('.kicad_pcb')
    if board_file.is_file():
        try:
            board = sx.loads(board_file.read_text(encoding='utf-8'))
            if not isinstance(board,list) or not board or str(board[0]) != 'kicad_pcb':
                raise ValueError('not a KiCad PCB')
            for footprint in children(board, 'footprint'):
                props = {str(p[1]):str(p[2]) for p in children(footprint,'property') if len(p)>2}
                ref, lib_id = props.get('Reference',''), str(footprint[1])
                if not ref and not lib_id:
                    embedded_only += 1
                    continue
                board_assignments.append(resolve_footprint(ref,lib_id))
        except Exception as exc:
            issues.append({'file':str(board_file),'reason':'invalid PCB library references','detail':str(exc)})
    return {'match': not issues and all(x['resolved'] for x in assignments + board_assignments),
            'tableIssues': issues, 'footprintAssignments': assignments,
            'boardFootprintAssignments': board_assignments,
            'embeddedOnlyPrimitiveContainers': embedded_only,
            'limit': 'Embedded schematic/board shapes may still open even when library editing or reassignment fails. Checks local paths, not complete library identity.'}
