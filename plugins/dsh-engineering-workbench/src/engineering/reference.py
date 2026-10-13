"""Index all text pages and render requested previews. Source contents never become executable instructions."""
import json, sys
from pathlib import Path
import pymupdf

request = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
source = Path(request['file'])
out = Path(request['output']); out.mkdir(parents=True, exist_ok=True)
doc = pymupdf.open(source)
if not doc.is_pdf:
    pdf = doc.convert_to_pdf(); doc.close(); doc = pymupdf.open('pdf', pdf)
if request.get('action') == 'index':
    if len(doc) > 10000:
        raise ValueError('Manual exceeds 10000 pages; split the document first')
    pages = []
    for n, p in enumerate(doc):
        blocks = [{'bbox': [b[0], b[1], b[2]-b[0], b[3]-b[1]], 'text': b[4]} for b in p.get_text('blocks', sort=True) if b[6] == 0]
        text = '\n'.join(b['text'] for b in blocks)
        has_images = bool(p.get_images())
        has_graphics = bool(p.get_drawings())
        blank = not text.strip() and not has_images and not has_graphics
        pages.append({'page': n + 1, 'width': p.rect.width, 'height': p.rect.height,
                      'text': text, 'blocks': blocks, 'hasImages': has_images, 'hasGraphics': has_graphics,
                      'blank': blank, 'needsVision': not blank and (not text.strip() or has_images or has_graphics)})
    data = {'pages': pages, 'toc': [{'level': row[0], 'title': row[1], 'page': row[2]} for row in doc.get_toc() if 1 <= row[2] <= len(doc)]}
    encoded = json.dumps(data, ensure_ascii=False).encode('utf-8')
    if len(encoded) > 64 * 1024 * 1024:
        raise ValueError('Manual text index exceeds 64 MiB; split the document first')
    target = out / 'pages.json'
    target.write_bytes(encoded)
    print(json.dumps({'indexFile': str(target), 'pages': len(doc)}))
    doc.close()
    sys.exit(0)
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
