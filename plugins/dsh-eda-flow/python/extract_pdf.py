"""Extract source pages without inventing component facts or silently dropping pages."""
import hashlib
import json
import re
import sys
from pathlib import Path
import pymupdf


def extract(source, name, binding):
    data = Path(source).read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    if len(data) > 50 * 1024 * 1024:
        raise ValueError("PDF exceeds 50 MB")
    records, missing = [], []
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
    page_count = len(records)
    # Optional published specification appendix, usable by any uploaded document.
    # Parse data only; never execute document content or accept CAD/netlist payloads.
    joined = "\n".join(row["content"] for row in records)
    allowed = {"content", "binding", "simulated", "stages", "symbolId", "appearance", "pins",
               "reference", "value", "dnp", "in_bom", "on_board", "objectRole", "originalFootprint",
               "materialCode", "materialDescription", "assemblyType"}
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
    # The appendix has an explicit record representation; do not send its escaped
    # serialization to the model a second time. Keep all ordinary page text.
    inside = False
    for row in records[:page_count]:
        original = row["content"]
        if "EDA_SPEC_V1_BEGIN" in original: inside = True
        if inside: row["content"] = "精确规格附表已提取为本页关联记录。"
        if "EDA_SPEC_V1_END" in original: inside = False
    return {"records": records, "sha256": digest, "pages": page_count,
            "unreadablePages": missing, "readable": bool(records) and not missing}


if __name__ == "__main__":
    request = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8-sig"))
    result = extract(request["path"], request["name"], request.get("binding", ""))
    Path(sys.argv[2]).write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
