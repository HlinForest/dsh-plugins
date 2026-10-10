"""Render only requested pages. Source contents never become executable instructions."""
import json, sys
from pathlib import Path
import pymupdf

request = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
source = Path(request['file'])
out = Path(request['output']); out.mkdir(parents=True, exist_ok=True)
doc = pymupdf.open(source)
if not doc.is_pdf:
    pdf = doc.convert_to_pdf(); doc.close(); doc = pymupdf.open('pdf', pdf)
page_number = int(request.get('page', 1))
if page_number < 1 or page_number > len(doc):
    raise ValueError('Page outside document')
page = doc[page_number - 1]
scale = min(2, 3000 / max(page.rect.width, page.rect.height))
preview = out / f'page-{page_number}.png'
page.get_pixmap(matrix=pymupdf.Matrix(scale, scale)).save(preview)
print(json.dumps({'page': page_number, 'pages': len(doc), 'width': page.rect.width,
                  'height': page.rect.height, 'image': str(preview), 'text': page.get_text()[:250000],
                  'blocks': [{'bbox': [b[0], b[1], b[2]-b[0], b[3]-b[1]], 'text': b[4]} for b in page.get_text('blocks') if b[6] == 0][:2000]}, ensure_ascii=False))
