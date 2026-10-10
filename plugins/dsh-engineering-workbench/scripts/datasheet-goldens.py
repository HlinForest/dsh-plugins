"""Audit existing catalogue evidence against ten actual PDFs; never fabricate human signoff."""
import hashlib, json, re
from pathlib import Path
import pymupdf

root = Path(__file__).resolve().parents[1]
catalog_path = root.parent / 'dsh-megmeet/success-demo/snapshots/catalog.v2.json'
catalog = json.loads(catalog_path.read_text(encoding='utf-8'))
normalize = lambda s: re.sub(r'\s+', '', s).casefold()
rows = []
for source in catalog['sources'][:10]:
    file = (catalog_path.parent / source['file']).resolve()
    data = file.read_bytes()
    if hashlib.sha256(data).hexdigest() != source['sha256']: raise ValueError('Source changed: ' + source['id'])
    doc = pymupdf.open(file)
    product = next(p for p in catalog['products'] if any(e.get('sourceId') == source['id'] for e in p['evidence'].values()))
    facts = []
    for name in ['output_voltage_v', 'output_current_a', 'output_power_w']:
        evidence = product['evidence'].get(name)
        if not evidence or evidence['sourceId'] != source['id']: continue
        page = doc[evidence['page'] - 1]
        matches = page.search_for(evidence['quote'])
        facts.append({'name': name, 'value': product['parameters'][name], **evidence,
                      'bboxCandidates': [[r.x0, r.y0, r.width, r.height] for r in matches],
                      'textPresent': normalize(evidence['quote']) in normalize(page.get_text()),
                      'humanVerified': False})
    rows.append({'source': source['id'], 'file': str(file.relative_to(root.parent)).replace('\\', '/'),
                 'sha256': source['sha256'], 'version': source['version'], 'product': product['id'], 'facts': facts,
                 'annotationSource': 'existing curated catalogue; independent human annotation has not been supplied'})
output = root / 'evals'; output.mkdir(exist_ok=True)
(output / 'datasheets.annotated-draft.json').write_text(json.dumps({'schemaVersion': 1, 'manualAcceptance': 'pending', 'sources': rows}, ensure_ascii=False, indent=2), encoding='utf-8')
summary = {'sources': len(rows), 'facts': sum(len(r['facts']) for r in rows),
           'quotesPresent': sum(f['textPresent'] for r in rows for f in r['facts']),
           'manualAcceptance': 'pending', 'modelExtractionAccuracy': 'not_measured',
           'notes': 'Quote presence is not parameter extraction accuracy and is not human signoff.'}
(output / 'datasheets.audit.json').write_text(json.dumps(summary, indent=2), encoding='utf-8')
print(json.dumps(summary))
