"""Local OCR observations for raster figures in mixed PDF pages.

These are review material, NOT source facts. The extractor never infers nets,
units, device applicability, or component choices from an OCR confidence score.
"""
import contextlib
import io
import math
import time
import pymupdf


class FigureReader:
    def __init__(self, engine=None, max_regions=12, seconds=45):
        self.engine = engine
        self.initialized = engine is not None
        self.available = engine is not None
        self.max_regions = max_regions
        self.seconds = seconds
        self.elapsed = 0.0
        self.count = 0
        self.failure = ''

    def _initialize(self):
        if self.initialized:
            return
        self.initialized = True
        try:
            from rapidocr_onnxruntime import RapidOCR
            self.engine = RapidOCR(intra_op_num_threads=1, inter_op_num_threads=1)
            self.available = True
        except Exception as error:
            self.failure = type(error).__name__

    def extract(self, page, digest, name, binding):
        regions = []
        for image in page.get_image_info():
            box = pymupdf.Rect(image['bbox']) & page.rect
            # Ignore tiny icons; retain sizeable embedded diagrams even when
            # the same page has searchable text. No device names or values.
            if box.width < 72 or box.height < 48 or box.get_area() < page.rect.get_area() * .015:
                continue
            if any((box & other).get_area() >= .95 * box.get_area() for other in regions):
                continue
            regions.append(box)
        observations, warnings = [], []
        for index, box in enumerate(regions):
            row = {'id': f'figure-{digest[:16]}-{page.number+1}-{index+1}',
                   'document': name, 'page': page.number+1, 'binding': binding,
                   'sourceSha256': digest, 'bbox': [round(v, 3) for v in box],
                   'sourceType': 'pdf-figure-ocr-observation',
                   'status': 'not-read', 'verified': False, 'lines': [], 'content': '',
                   'limitations': '图中文字识别不能确定接线关系、单位正确性或型号适用性；须对照原 PDF 复核后补充规格书正文。'}
            observations.append(row)
            if self.count >= self.max_regions or self.elapsed >= self.seconds:
                row['status'] = 'limit-reached'
                warnings.append({'page': row['page'], 'kind': 'figure-ocr-limit', 'figureId': row['id']})
                continue
            start = time.monotonic()
            with contextlib.redirect_stdout(io.StringIO()):
                self._initialize()
            if not self.available:
                row['status'] = 'ocr-unavailable'
                warnings.append({'page': row['page'], 'kind': 'figure-ocr-unavailable', 'figureId': row['id'], 'message': self.failure})
                continue
            self.count += 1
            try:
                import numpy as np
                scale = min(3, 1800/max(box.width, box.height))
                pix = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), clip=box, colorspace=pymupdf.csRGB, alpha=False)
                pixels = np.frombuffer(pix.samples, np.uint8).reshape(pix.height, pix.width, 3)
                with contextlib.redirect_stdout(io.StringIO()):
                    rows, _ = self.engine(pixels)
                for polygon, text, confidence, *_ in rows or []:
                    if not isinstance(text, str) or not math.isfinite(float(confidence)):
                        continue
                    # Pixmap origin is rounded to pixel boundaries by MuPDF.
                    points = [[round((pix.x + float(x))/scale, 3), round((pix.y + float(y))/scale, 3)] for x, y in polygon]
                    row['lines'].append({'text': text, 'confidence': round(float(confidence), 6), 'polygon': points})
                row['content'] = '\n'.join(line['text'] for line in row['lines'])
                row['status'] = 'needs-verification' if row['lines'] else 'no-text-recognized'
                row['engine'] = 'rapidocr-onnxruntime'
            except Exception as error:
                row['status'] = 'ocr-failed'
                warnings.append({'page': row['page'], 'kind': 'figure-ocr-failed', 'figureId': row['id'], 'message': type(error).__name__})
            finally:
                self.elapsed += time.monotonic() - start
        return observations, warnings
