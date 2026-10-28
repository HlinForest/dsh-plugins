"""Offline acceptance only: compare exported KiCad XML to an independent R6 record.
The reference is never an input to the runtime compiler.
"""
import json,sys,collections
from pathlib import Path
import xml.etree.ElementTree as ET
reference=json.loads(Path(sys.argv[1]).read_text(encoding='utf8'))
project=Path(sys.argv[2]);report_path=Path(sys.argv[3])
readback=json.loads((project/'readback.json').read_text(encoding='utf8'))
errors=[];components={c['reference']:c for c in readback['components'] if not c['reference'].startswith('#PWR')}
expected={c['ref']:c for c in reference['components']}
if set(components)!=set(expected):errors.append('Component identity mismatch')
for ref,c in expected.items():
    actual=components.get(ref,{})
    props={p['name']:p['value'] for p in actual.get('properties',[])}
    for key in ('value','in_bom','on_board','dnp'):
        if actual.get(key)!=c[key]:errors.append(ref+': '+key)
    for key,field in [('originalFootprint','OriginalFootprint'),('materialCode','MaterialCode'),('objectRole','ObjectRole')]:
        if props.get(field)!=c[key]:errors.append(ref+': '+field)
xml=ET.parse(project/'actual.net.xml').getroot()
observed=collections.Counter()
for net in xml.findall('./nets/net'):
    pins=frozenset(n.get('ref')+'.'+n.get('pin') for n in net.findall('node') if n.get('ref') in expected)
    if pins:observed[pins]+=1
wanted=collections.Counter(frozenset(pins) for pins in reference['networkPartitions'].values())
if observed!=wanted:
    errors.append('Independent R6 network partitions differ')
result={'status':'failed' if errors else 'passed','errors':errors,'baseline':reference['baseline'],'sourceSchDocSha256':reference['sourceSchDocSha256'],'electricalComponents':sum(c['objectRole']=='electrical' for c in expected.values()),'processObjects':sum(c['objectRole']=='process' for c in expected.values()),'pins':sum(len(p)*n for p,n in observed.items()),'netAndNCPartitions':sum(observed.values()),'scope':'Actual exported XML connectivity and native component metadata versus offline R6 reference; not model reasoning or hardware verification'}
report_path.write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf8')
print(json.dumps(result,ensure_ascii=True))
sys.exit(bool(errors))
