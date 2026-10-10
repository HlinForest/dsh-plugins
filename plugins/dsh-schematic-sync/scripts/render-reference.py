"""Render one bounded PDF/image page; stdout is machine-readable metadata."""
import argparse
import json
from pathlib import Path
import pymupdf

p = argparse.ArgumentParser()
p.add_argument("source")
p.add_argument("output")
p.add_argument("--page", type=int, default=1)
a = p.parse_args()
with pymupdf.open(a.source) as original:
    if not 1 <= a.page <= len(original):
        raise ValueError("Page outside reference document")
    if original.is_pdf:
        doc = original
    else:
        doc = pymupdf.open("pdf", original.convert_to_pdf())
    page = doc[a.page - 1]
    scale = min(2.5, 2400 / max(page.rect.width, page.rect.height))
    pix = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False)
    pix.save(a.output)
    print(json.dumps({"pages": len(doc), "page": a.page, "width": pix.width,
                      "height": pix.height, "text": page.get_text()[:60000],
                      "image": str(Path(a.output).resolve())}, ensure_ascii=True))
