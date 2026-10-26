"""Parse KiCad's native text report strictly; preserve every diagnostic."""
import re

def parse_report(text):
    if not text.startswith('ERC report ('):
        raise ValueError('Unrecognized KiCad ERC report header')
    summary = re.search(r'^\s*\*\* ERC messages:\s*(\d+)\s+Errors\s+(\d+)\s+Warnings\s+(\d+)\s*$', text, re.M)
    if summary is None:
        raise ValueError('Missing KiCad ERC report summary')
    sheets, current, diagnostic = [], None, None
    for line in text[:summary.start()].splitlines():
        if line.startswith('***** Sheet '):
            current = {'path': line[len('***** Sheet '):], 'violations': []}
            sheets.append(current)
            diagnostic = None
        elif line.startswith('['):
            match = re.fullmatch(r'\[([^\]]+)\]:\s*(.*)', line)
            if not match or current is None:
                raise ValueError('Malformed ERC diagnostic')
            diagnostic = {'type': match[1], 'description': match[2], 'items': [], 'raw': line}
            current['violations'].append(diagnostic)
        elif diagnostic is not None and line.strip():
            diagnostic['raw'] += '\n' + line
            if line.strip().startswith(';'):
                severity = re.fullmatch(r'\s*;\s*(error|warning)(?:\s+\(excluded\))?\s*', line)
                if not severity:
                    raise ValueError('Unrecognized ERC severity: ' + line)
                diagnostic['severity'] = severity[1]
                diagnostic['excluded'] = '(excluded)' in line
            else:
                diagnostic['items'].append({'description': line.strip()})
    violations = [v for s in sheets for v in s['violations']]
    if any('severity' not in v for v in violations):
        raise ValueError('ERC diagnostic has no severity')
    counts = (len(violations), sum(v['severity'] == 'error' for v in violations), sum(v['severity'] == 'warning' for v in violations))
    if counts != tuple(map(int, summary.groups())):
        raise ValueError('ERC diagnostics do not match report summary')
    return {'sheets': sheets, 'sourceFormat': 'kicad-erc-report', 'violation_count': counts[0]}
