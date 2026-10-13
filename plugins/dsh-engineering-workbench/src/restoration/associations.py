"""Verify PCB-to-schematic links from original component unique IDs."""
from collections import defaultdict
from collections import Counter
from uuid import UUID
from pathlib import Path

def native_source_file(root, manifest, extension):
    """Select the declared source, independent of any demonstration folder name."""
    root=Path(root).resolve()
    names=[item['path'] for item in manifest['files'] if item['path'].startswith('00_native/') and item['path'].lower().endswith(extension.lower())]
    if len(names)!=1:raise ValueError('Expected exactly one declared native '+extension+' source; multiple sheets/boards need an adapter')
    file=(root/names[0]).resolve()
    if not file.is_relative_to(root) or not file.is_file():raise ValueError('Native source is missing or escapes the frozen input')
    return file

def children(n,k):return [v for v in n if isinstance(v,list) and v and str(v[0])==k]
def value(n,k,default=''):
    rows=children(n,k)
    return str(rows[0][1]) if rows and len(rows[0])>1 else default
def props(n):return {str(p[1]):str(p[2]) for p in children(n,'property')}

def check_object_ids(document):
    values=[];invalid=[]
    def walk(n):
        if not isinstance(n,list):return
        if n and str(n[0]) in ('uuid','tstamp') and len(n)>1:
            text=str(n[1]);values.append(text)
            try:UUID(text)
            except ValueError:invalid.append(text)
        for v in n:
            if isinstance(v,list):walk(v)
    walk(document)
    duplicate={k:v for k,v in Counter(values).items() if v>1}
    return {'match':not invalid and not duplicate,'objects':len(values),'invalidCount':len(invalid),'invalidExamples':invalid[:5],'duplicateCount':len(duplicate),'duplicateExamples':dict(list(duplicate.items())[:5])}

def check_associations(native_components,native_board,schematic,board,aliases=None):
    aliases=aliases or {}
    source_ids={c['raw_fields'].get('UniqueID'):c['reference'] for c in native_components if c['raw_fields'].get('UniqueID')}
    symbols={props(s).get('Reference'):s for s in children(schematic,'symbol')}
    footprints=defaultdict(list)
    for f in children(board,'footprint'):footprints[props(f).get('Reference')].append(f)
    root=value(schematic,'uuid');rows=[];source_gaps=[]
    for record in native_board:
        fields=record['fields'];uid=fields.get('SOURCEUNIQUEID','').strip('\\/').split('\\')[-1]
        ref=source_ids.get(uid)
        if ref is None:
            source_gaps.append({'nativeBoardReference':fields.get('SOURCEDESIGNATOR'),'nativeId':uid});continue
        target_ref=aliases.get(ref,ref);symbol=symbols.get(target_ref);fps=footprints.get(target_ref,[])
        expected='/'+root+'/'+value(symbol,'uuid') if symbol else None
        actual=value(fps[0],'path') if len(fps)==1 else None
        rows.append({'reference':ref,'nativeId':uid,'expectedPath':expected,'actualPath':actual,
                     'match':expected is not None and actual==expected,'boardMatches':len(fps)})
    linked={row['reference'] for row in rows}
    return {'match':all(r['match'] for r in rows),'expectedSourceLinks':len(rows),'objects':rows,
            'sourceBoardWithoutSchematicIdentity':source_gaps,
            'sourceSchematicWithoutBoard':[c['reference'] for c in native_components if c['reference'] not in linked],
            'limit':'Checks native unique-ID-linked components against root sheet UUID / placed symbol UUID. Native unmatched objects remain reported; pad/net parity is checked separately by KiCad.'}
