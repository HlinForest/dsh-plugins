"""Present host-derived selection evidence without altering electrical values."""
import json
import re


def fields(component):
    selection = component.get('valueSelection')
    if not selection:
        return {}
    return {
        'SelectionStatus': selection['status'],
        'SelectionBasis': selection['basis'],
        'SelectionMissing': json.dumps(selection.get('missing', []), ensure_ascii=False),
    }


def compact_refs(refs):
    groups, other = {}, []
    for ref in refs:
        match = re.fullmatch(r'([A-Za-z_]+)([1-9][0-9]*)', ref)
        if match:
            groups.setdefault(match[1], []).append(int(match[2]))
        else:
            other.append(ref)
    labels = sorted(other)
    for prefix, numbers in sorted(groups.items()):
        numbers = sorted(set(numbers))
        start = previous = numbers[0]
        for number in numbers[1:] + [None]:
            if number != previous + 1:
                labels.append(prefix + str(start) + ('-' + prefix + str(previous) if previous != start else ''))
                start = number
            previous = number
    result = ', '.join(labels)
    return result if len(result) <= 64 else str(len(refs)) + ' parts (see BOM)'


def notes(design):
    rows = [c for c in design['components'] if c.get('valueSelection')]
    if not rows:
        return []
    pending = [c['ref'] for c in rows if c['valueSelection']['status'] in ('provisional', 'unresolved')]
    sourced = [c['ref'] for c in rows if c['valueSelection']['status'] == 'source-recommended']
    return ([f'Pending values: {compact_refs(pending)}'] if pending else []) + \
           ([f'Source values: {compact_refs(sourced)}'] if sourced else []) + \
           ['Operating conditions pending; see BOM SelectionMissing']
