"""Find ordinary input-filter columns whose annotations can follow their axis.

This is a presentation choice from the current net graph, not a circuit
template. Specified symbols and frozen native blocks retain their fields.
"""
from collections import defaultdict
from functional_groups import _kind


def column_candidates(design, resources, groups):
    components = {c['ref']: c for c in design.get('components', [])}
    netof = {key: n['name'] for n in design.get('nets', []) for key in n['nodes']}
    groupof = {ref: i for i, group in enumerate(groups) for ref in group['references']}
    fixed = {ref for block in resources.get('blocks', []) for ref in block.get('bindings', {}).values()}
    eligible = []
    for ref, c in components.items():
        resource = resources.get('symbols', {}).get(c.get('librarySymbol'), {})
        if (ref in fixed or resource.get('drawingRules') or _kind(c, resources) != 'capacitor'
                or len(c.get('pins', [])) != 2
                or any(p.get('type') != 'passive' for p in c['pins'])):
            continue
        nets = {netof.get(ref + '.' + str(p['number'])) for p in c['pins']}
        if len(nets) == 2 and None not in nets:
            eligible.append((ref, nets))
    result = set()
    for ref, c in components.items():
        if len(c.get('pins', [])) <= 2 or ref not in groupof:
            continue
        inputs = {netof.get(ref + '.' + str(p['number'])) for p in c['pins'] if p.get('type') == 'input'} - {None}
        returns = {netof.get(ref + '.' + str(p['number'])) for p in c['pins'] if p.get('type') in ('power_in', 'power_out')} - {None}
        if len(inputs) < 2:
            continue
        by_return = defaultdict(list)
        for cap, nets in eligible:
            signal, rail = nets & inputs, nets & returns
            if groupof.get(cap) == groupof[ref] and len(signal) == len(rail) == 1 and signal != rail:
                by_return[next(iter(rail))].append((cap, next(iter(signal))))
        for bank in by_return.values():
            if len({signal for _, signal in bank}) >= 2:
                result.update(cap for cap, _ in bank)
    return result
