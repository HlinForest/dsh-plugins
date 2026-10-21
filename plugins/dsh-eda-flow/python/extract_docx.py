"""Read visible DOCX paragraphs and tables; use section locators, not guessed pages."""
import hashlib
import json
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'

def extract(source, name, binding):
    raw = Path(source).read_bytes()
    if len(raw) > 50 * 1024 * 1024:
        raise ValueError('DOCX exceeds 50 MB')
    digest = hashlib.sha256(raw).hexdigest()
    with zipfile.ZipFile(source) as archive:
        info = archive.getinfo('word/document.xml')
        if info.file_size > 20 * 1024 * 1024:
            raise ValueError('DOCX body exceeds 20 MB')
        body = ET.fromstring(archive.read(info)).find(W + 'body')
        core = archive.read('docProps/core.xml') if 'docProps/core.xml' in archive.namelist() else b''
        simulated = b'EDA_MOCK_DOCUMENT' in core
    records, title, lines = [], '', []
    def flush():
        if not lines:
            return
        content = '\n'.join(lines).strip()
        records.append({'id': f'docx-{digest[:16]}-{len(records)+1}',
            'document': name, 'page': None, 'section': title or '正文',
            'content': content, 'binding': binding, 'simulated': simulated,
            'pageIsPlaceholder': False, 'sourceType': 'docx-text-extraction',
            'sourceSha256': digest, 'stages': [1,2,3,4,5,7], 'readable': bool(content)})
        lines.clear()
    for element in body:
        if element.tag == W + 'p':
            text = ''.join(t.text or '' for t in element.iter(W+'t'))
            style = element.find('./'+W+'pPr/'+W+'pStyle')
            if style is not None and style.get(W+'val', '').startswith('Heading'):
                flush()
                title = text
            elif text.strip():
                lines.append(text)
        elif element.tag == W + 'tbl':
            for row in element.findall(W+'tr'):
                lines.append(' | '.join(' '.join(t.text or '' for t in cell.iter(W+'t')) for cell in row.findall(W+'tc')))
    flush()
    if sum(len(r['content']) for r in records) > 1500000:
        raise ValueError('DOCX text exceeds 1.5 million characters')
    return {'records': records, 'sha256': digest, 'pages': None, 'sections': len(records),
            'unreadablePages': [], 'readable': bool(records), 'format': 'docx'}

if __name__ == '__main__':
    request = json.load(sys.stdin)
    print(json.dumps(extract(request['path'], request['name'], request.get('binding', '')), ensure_ascii=False))
