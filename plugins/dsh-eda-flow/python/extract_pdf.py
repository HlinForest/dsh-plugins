"""Extract source pages without inventing component facts or silently dropping pages."""
import hashlib
import contextlib
import io
import json
import re
import sys
from pathlib import Path
import pymupdf
from pdf_tables import extract_tables


def extract(source, name, binding):
    data = Path(source).read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if len(data) > 50 * 1024 * 1024:
        raise ValueError("PDF exceeds 50 MB")
    records, missing, tables, warnings = [], [], [], []
    with pymupdf.open(stream=data, filetype="pdf") as doc:
        if doc.needs_pass:
            raise ValueError("PDF is encrypted; provide an unlocked readable copy")
        if len(doc) > 500:
            raise ValueError("PDF exceeds 500 pages; split the relevant sections")
        simulated_document = "EDA_MOCK_DOCUMENT" in (doc.metadata.get("keywords") or "")
        total = 0
        for index, page in enumerate(doc):
            content = page.get_text(sort=True).strip()
            total += len(content)
            if total > 1500000:
                raise ValueError("PDF text exceeds 1.5 million characters; split the relevant sections")
            if not content:
                missing.append(index + 1)
            records.append({
                "id": f"pdf-{digest[:16]}-{index + 1}",
                "document": name, "page": index + 1, "content": content,
                "binding": binding, "simulated": simulated_document, "pageIsPlaceholder": False,
                "sourceType": "pdf-text-extraction", "sourceSha256": digest,
                "stages": [2, 3, 4, 5, 7], "readable": bool(content),
            })
            # Some PyMuPDF versions print a layout-package suggestion. The
            # document-process protocol reserves stdout for one JSON result.
            with contextlib.redirect_stdout(io.StringIO()):
                page_tables, page_warnings = extract_tables(page,digest,name,binding,simulated_document)
            total += sum(len(row['content']) for row in page_tables)
            if total > 1500000:
                raise ValueError("PDF text and tables exceed 1.5 million characters; split the relevant sections")
            tables.extend(page_tables);warnings.extend(page_warnings)
    page_count = len(records)
    # Optional published specification appendix, usable by any uploaded document.
    # Parse data only; never execute document content or accept CAD/netlist payloads.
    joined = "\n".join(row["content"] for row in records)
    allowed = {"content", "binding", "simulated", "stages", "symbolId", "appearance", "pins",
               "reference", "value", "dnp", "in_bom", "on_board", "objectRole", "originalFootprint",
               "materialCode", "materialDescription", "assemblyType"}
    appendix_ranges = []
    for index, match in enumerate(re.finditer(r"EDA_SPEC_V1_BEGIN\s*(.*?)EDA_SPEC_V1_END", joined, re.S)):
        data = json.loads(match[1].replace("\n", "").replace("\r", ""))
        if not isinstance(data, dict) or set(data) - allowed or not isinstance(data.get("content"), str):
            raise ValueError("Invalid published specification appendix")
        page_number = 1
        offset = 0
        for row in records[:page_count]:
            if offset + len(row["content"]) >= match.start():
                page_number = row["page"]; break
            offset += len(row["content"]) + 1
        records.append({**data, "id": f"spec-{digest[:16]}-{index}", "document": name,
                        "page": page_number, "pageIsPlaceholder": False,
                        "simulated": data.get("simulated") is True,
                        "sourceType": "pdf-specification-appendix", "sourceSha256": digest,
                        "stages": [1, 2, 3, 4, 5, 7], "readable": True})
        appendix_ranges.append(match.span())
    # The appendix has an explicit record representation; do not send its escaped
    # serialization to the model a second time. Keep all ordinary page text.
    # Clip only successfully parsed spans against each original page. Whole
    # page replacement loses adjacent application requirements and can erase
    # every following page after an unmatched BEGIN marker.
    offset = 0
    for row in records[:page_count]:
        original = row["content"]
        end = offset + len(original)
        chunks, cursor = [], 0
        for start, stop in appendix_ranges:
            if start >= end or stop <= offset:
                continue
            local_start, local_end = max(0, start-offset), min(len(original), stop-offset)
            chunks.extend([original[cursor:local_start], "\n精确规格附表已提取为本页关联记录。\n"])
            cursor = local_end
        chunks.append(original[cursor:])
        row["content"] = "".join(chunks).strip()
        offset = end + 1
    records.extend(tables)
    return {"records": records, "sha256": digest, "pages": page_count,
            "tableCount":len(tables),"extractionWarnings":warnings,
            "unreadablePages": missing, "readable": bool(records) and not missing}


if __name__ == "__main__":
    if sys.argv[1] == '--stdio':
        request = json.load(sys.stdin)
        print(json.dumps(extract(request["path"], request["name"], request.get("binding", "")), ensure_ascii=False))
    else:
        request = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8-sig"))
        result = extract(request["path"], request["name"], request.get("binding", ""))
        Path(sys.argv[2]).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
