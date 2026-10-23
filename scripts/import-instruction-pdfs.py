#!/usr/bin/env python3
"""Extract documentary element/quantity evidence from local LEGO instruction PDFs.

Requires PyMuPDF. PDFs and page renders stay private; output contains facts and
coordinates, never a guessed design ID, colour, connection or mesh.
"""

from __future__ import annotations

import argparse
from collections import Counter
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
from typing import Any

import fitz


EXPECTED_FILES = [
    "6522905.pdf", "6572269.pdf", "6662707.pdf", "6592556.pdf",
    "6592612.pdf", "6617271.pdf", "6592544.pdf", "6617283.pdf",
]

# Observations apply only to these exact bytes. They are a software assistant's
# visual spot checks, not a user's human approval or a part certification.
REVIEWED_SOURCES: dict[str, dict[str, Any]] = {
    "6522905": {
        "sha256": "b477dbbca2dac42cd6caa3fb64bc1988b7c7adee6bb4439758260e0ee44f0e80",
        "coverDescription": "黄色敞篷跑车；封面只印套装号76924，未印完整产品名称。",
        "inventoryScope": "本册没有零件附录；不能从本册建立76924全套库存。",
        "observations": [
            {"pdfPages": [1], "kind": "cover", "note": "封面为单辆黄色敞篷车，不能据此宣称已覆盖同套装其他车辆。"},
            {"pdfPages": [10], "steps": [10], "kind": "chassis", "note": "步骤10展示侧面带孔结构件围绕中央底盘的分层结构，车轮销保持外露。只能记录装配关系观察，不能据图生成连接坐标。"},
            {"pdfPages": [52], "steps": [56], "kind": "body-subassembly", "note": "步骤56先将两块黄色零件叠成小组件，再从上方加到车身；座舱开放，轮拱与侧面覆盖件已安装。"},
        ],
        "spotChecks": {},
    },
    "6662707": {
        "sha256": "713cdd8dcec8d9d00d379b836d4510a43a0a5a909c3b2d8773f3fb7f9eb6cf37",
        "coverDescription": "白/黑赛车，蓝红条纹与金色车轮；封面车牌可见THE M3 E30。",
        "inventoryScope": "本册末尾印刷零件附录；未独立对照官方结构化库存，是否含备件及全套完整性未确认。",
        "observations": [
            {"pdfPages": [1], "kind": "cover", "note": "可见THE M3 E30车牌、方形乘员舱、四个圆形前灯和独立尾翼；这些是外观观察，不是几何尺寸。"},
            {"pdfPages": [12], "steps": [10, 11], "kind": "wheel-carrier-subassembly", "note": "步骤10将两根浅棕色销从两侧插入小型黑色组件，步骤11再覆板并加侧向孔砖；精确零件号/接口仍需来源映射。"},
            {"pdfPages": [70], "kind": "body-subassembly", "note": "安装后部装饰面板时车顶尚未封闭，座舱、侧门和轮拱已形成；说明分组件装配顺序不能由成品轮廓替代。"},
        ],
        "spotChecks": {
            "113": {"302401": 7, "6614306": 1, "6614303": 1, "4666579": 4},
            "114": {"6501668": 3, "6637141": 2, "6088550": 1, "6575731": 4, "663626": 1, "6663108": 2},
            "115": {"6064228": 2, "6318582": 1, "6057902": 1, "6635727": 1, "6614318": 4},
        },
    },
    "6592612": {
        "sha256": "4b5fc3474784c48c95a54ad4f5d9a815a522df006afccb7ab10fbbeaa40ab961",
        "coverDescription": "橙色封闭座舱跑车；封面印77238及袋号1、2、3、4。",
        "inventoryScope": "77238袋1–4对应说明册，没有零件附录；另一本6592556含附录，但其覆盖范围不能从本册单独证明。",
        "observations": [
            {"pdfPages": [1], "kind": "cover", "note": "封面为橙色车辆且袋号为1–4，与6592556封面的蓝色车辆/袋5–8分册。"},
            {"pdfPages": [10], "steps": [9, 10], "kind": "chassis", "note": "步骤9–10在底盘中央叠板，橙色横向板连接左右侧结构；前后两端车轮销外露。"},
            {"pdfPages": [70], "steps": [73], "kind": "body-subassembly", "note": "车尾上盖、侧窗和后轮拱先形成，车头区域仍裸露；箭头将小块橙色斜面件从上方加到后部曲面。"},
        ],
        "spotChecks": {},
    },
    "6592556": {
        "sha256": "19ced5bd6af1897527a6b74acb74ebca836734e697f956d22557180f8546d1e8",
        "coverDescription": "蓝色跑车配橙色装饰和大尾翼；封面印77238及袋号5、6、7、8。",
        "inventoryScope": "77238袋5–8对应说明册末尾的印刷附录。附录含多种橙色与蓝色车身元素，但未把每行归属到单车，也未独立确认是全套清单。",
        "observations": [
            {"pdfPages": [1], "kind": "cover", "note": "封面为蓝色车辆和大尾翼，袋号5–8；不能把两本77238说明册当作两个不同套装计算频次。"},
            {"pdfPages": [10], "steps": [14, 15], "kind": "chassis", "note": "步骤14以白色板跨接中央底盘，步骤15添加蓝色横板和两块灰色小板；轮销外露而车壳尚未完成。"},
            {"pdfPages": [70], "steps": [85], "kind": "body-subassembly", "note": "步骤85在座舱后部顶部加两块黑色件；侧面曲线和后部斜面依赖多个独立零件及朝向，不是单个拉伸外壳。"},
        ],
        "spotChecks": {
            "108": {"307001": 2, "6296132": 4, "6330191": 2, "4666579": 8},
            "109": {"362226": 1, "6382491": 1, "6548236": 1, "6508013": 2, "6336858": 8, "6508995": 1},
            "110": {"6442363": 2, "6554439": 6, "6510144": 5, "6491330": 4},
            "111": {"6560204": 1, "6548233": 1, "6151664": 2},
        },
    },
    "6617271": {
        "sha256": "22bc404a153284f8f8bea9894671582042574aae4300187639f27071b25ca67f",
        "coverDescription": "红色低矮跑车、黑色固定尾翼与Ferrari标志。封面只印77254。",
        "inventoryScope": "本册末尾印刷零件附录；未独立对照官方结构化库存，是否含备件及全套完整性未确认。",
        "observations": [
            {"pdfPages": [1], "kind": "cover", "note": "可见低矮车头、大幅倾斜的整体风挡和独立黑色尾翼；只能作为外观参考。"},
            {"pdfPages": [12], "steps": [8], "kind": "chassis", "note": "步骤8在黑色底盘上安装灰色小板；底盘侧面孔位、外露轮销和已有斜面支撑都先于外壳。"},
            {"pdfPages": [72], "steps": [90], "kind": "body-subassembly", "note": "步骤90把预先组好的车尾两侧小组件水平装到主车架；座舱仍开放，连接方向不能简单按垂直堆砖处理。"},
        ],
        "spotChecks": {
            "122": {"302326": 10, "306926": 1, "6057397": 1, "614126": 12, "6602160": 2, "4558954": 3},
            "123": {"6146220": 2, "4548180": 3, "4298619": 1, "6575731": 4, "6585316": 4, "6585318": 1},
        },
    },
    "6617283": {
        "sha256": "f9f7f1e5a22385ce58ce589b35dc8b47fa86beaba57402ac37bf45c17b7e2d1d",
        "coverDescription": "橙/黑跑车；车鼻上可见McLaren字样，封面印77257。",
        "inventoryScope": "本册末尾印刷零件附录；未独立对照官方结构化库存，是否含备件及全套完整性未确认。",
        "observations": [
            {"pdfPages": [1], "kind": "cover", "note": "橙色车身沿黑色座舱、车顶和后部形成分区，前轮拱和侧面进气轮廓具有独立造型。"},
            {"pdfPages": [12], "steps": [8], "kind": "chassis", "note": "步骤8将专用大底盘翻转，与已经装有轮销的后部小组件连接；这不能用一块普通长方形板替代。"},
            {"pdfPages": [70], "steps": [66], "kind": "body-subassembly", "note": "步骤66把黑色车头小组件沿水平方向装到主车身；车顶尚未封闭，座舱、侧面和后轮拱先行完成。"},
        ],
        "spotChecks": {
            "102": {"6051511": 6, "4666579": 4, "6384112": 3, "6336858": 4, "6508995": 1},
            "103": {"6173928": 1, "6593853": 1, "6177490": 2, "6593850": 4, "6585400": 1},
        },
    },
}


def rounded_box(box: Any) -> list[float]:
    return [round(float(x), 3) for x in box[:4]]


def match_inventory_words(page: fitz.Page) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Pair only directly stacked quantity/element labels at the same x.

    PDF blocks sometimes merge two columns. Word coordinates avoid pairing a
    quantity with the next column's ID. Duplicate overprinted ID words collapse
    only when value and location match; ambiguity remains unresolved.
    """
    words = page.get_text("words")
    quantities = [w for w in words if re.fullmatch(r"[1-9]\d*x", w[4])]
    identifiers = [w for w in words if re.fullmatch(r"\d{6,7}", w[4])]
    pairs, unresolved = [], []
    used: set[tuple[str, float, float]] = set()
    for quantity in quantities:
        candidates = [w for w in identifiers if abs(w[0] - quantity[0]) < 3 and 0 < w[1] - quantity[1] < 30]
        unique = {(w[4], round(w[0], 1), round(w[1], 1)): w for w in candidates}
        if len(unique) != 1:
            unresolved.append({"bbox": rounded_box(quantity), "rawText": quantity[4], "reason": "no-unique-vertically-adjacent-element-id", "candidateIds": sorted({w[4] for w in candidates})})
            continue
        key, element = next(iter(unique.items()))
        if key in used:
            unresolved.append({"bbox": rounded_box(quantity), "rawText": quantity[4], "reason": "element-label-already-paired"})
            continue
        used.add(key)
        bbox = [min(quantity[0], element[0]), min(quantity[1], element[1]), max(quantity[2], element[2]), max(quantity[3], element[3])]
        pairs.append({"elementId": element[4], "quantity": int(quantity[4][:-1]), "bbox": rounded_box(bbox), "quantityBbox": rounded_box(quantity), "elementIdBbox": rounded_box(element), "rawText": quantity[4] + "\n" + element[4]})
    return pairs, unresolved


def extract_pdf(path: Path, render_dir: Path | None) -> tuple[dict[str, Any], dict[str, Any] | None]:
    raw = path.read_bytes()
    sha256 = hashlib.sha256(raw).hexdigest()
    if not raw.startswith(b"%PDF-"):
        raise ValueError(f"Not a PDF: {path.name}")
    with fitz.open(path) as pdf:
        if pdf.needs_pass:
            raise ValueError(f"Encrypted PDF requires an unlocked local copy: {path.name}")
        if len(pdf) == 0:
            raise ValueError(f"Empty PDF: {path.name}")
        first_text, last_text = pdf[0].get_text(), pdf[-1].get_text()
        cover_ids = list(dict.fromkeys(re.findall(r"(?<!\d)(\d{5})(?!\d)", first_text)))
        set_number = cover_ids[0] if len(cover_ids) == 1 else None
        document_id = path.stem
        review = REVIEWED_SOURCES.get(document_id)
        review = review if review and review["sha256"] == sha256 else None
        copyright_match = re.search(r"©\s*(20\d\d)", last_text)
        rows: list[dict[str, Any]] = []
        unresolved_blocks: list[dict[str, Any]] = []
        appendix_pages: list[int] = []
        review_failures: list[dict[str, Any]] = []
        for index, page in enumerate(pdf):
            # Step pages have quantities but not a dense collection of element IDs.
            words = page.get_text("words")
            id_count = sum(bool(re.fullmatch(r"\d{6,7}", w[4])) for w in words)
            qty_count = sum(bool(re.fullmatch(r"[1-9]\d*x", w[4])) for w in words)
            if min(id_count, qty_count) < 8:
                continue
            page_number = index + 1
            pairs, unresolved = match_inventory_words(page)
            appendix_pages.append(page_number)
            for issue in unresolved:
                unresolved_blocks.append({"pdfPage": page_number, **issue})
            for pair in pairs:
                expected = review.get("spotChecks", {}).get(str(page_number), {}).get(pair["elementId"]) if review else None
                spot_checked = expected is not None and expected == pair["quantity"]
                if expected is not None and expected != pair["quantity"]:
                    review_failures.append({"pdfPage": page_number, "elementId": pair["elementId"], "expected": expected, "actual": pair["quantity"]})
                rows.append({
                    "rowId": f"{document_id}:p{page_number}:{len(rows) + 1}",
                    "elementId": pair["elementId"], "designId": None, "partId": None,
                    "color": None, "quantity": pair["quantity"], "isSpare": None,
                    "evidence": {
                        "documentId": document_id, "pdfPage": page_number,
                        "bbox": pair["bbox"], "quantityBbox": pair["quantityBbox"], "elementIdBbox": pair["elementIdBbox"],
                        "rawText": pair["rawText"], "method": "native-pdf-text-coordinate-pair",
                        "reviewStatus": "visual-spot-checked" if spot_checked else "text-layer-extracted",
                    },
                })
        if review_failures:
            raise ValueError(f"Visual review regression: {path.name}: {review_failures}")
        source = {"kind": "user-uploaded-lego-pdf", "fileName": path.name, "sha256": sha256, "sourceUrl": None, "officialOriginIndependentlyVerified": False}
        observations = review.get("observations", []) if review else []
        for observation in observations:
            observation["evidence"] = {"documentId": document_id, "sha256": sha256, "method": "assistant-visual-review", "humanApproved": False}
        manifest_entry = {
            "id": document_id, "fileName": path.name, "status": "ready", "setNumber": set_number,
            "pages": len(pdf), "sizeBytes": len(raw), "sha256": sha256,
            "printedBookNumberMatchesFileName": document_id in last_text,
            "coverSetNumberEvidence": {"pdfPage": 1, "rawText": first_text.strip()},
            "officialProductName": None, "productYear": None, "officialPieceCount": None,
            "copyrightYear": int(copyright_match[1]) if copyright_match else None,
            "copyrightYearEvidence": {"pdfPage": len(pdf), "method": "native-pdf-text"} if copyright_match else None,
            "appendixPages": appendix_pages,
            "coverDescription": review.get("coverDescription") if review else None,
            "inventoryScope": review.get("inventoryScope") if review else "Automatically detected printed element appendix; set-wide completeness unverified.",
            "inventoryComplete": False, "sparesDistinguished": False, "designIdsMapped": False, "colorsMapped": False,
            "extractedRowCount": len(rows), "printedQuantitySum": sum(r["quantity"] for r in rows),
            "visualSpotCheckedRows": sum(r["evidence"]["reviewStatus"] == "visual-spot-checked" for r in rows),
            "source": source, "observations": observations,
            "limitations": ["No PDF-to-3D reconstruction", "Element IDs are not design IDs", "Printed quantity sum is not an official set piece count", "No spare/non-spare classification", "No human certification"],
        }
        if render_dir:
            render_pages = {1, *appendix_pages}
            for observation in observations:
                render_pages.update(observation["pdfPages"])
            render_dir.mkdir(parents=True, exist_ok=True)
            for page_number in sorted(render_pages):
                pdf[page_number - 1].get_pixmap(matrix=fitz.Matrix(1.3, 1.3)).save(render_dir / f"{document_id}-p{page_number}.png")
        inventory = None if not appendix_pages else {
            "documentId": document_id, "setNumber": set_number, "source": source,
            "inventoryComplete": False, "sparesDistinguished": False,
            "inventoryScope": manifest_entry["inventoryScope"],
            "rows": rows, "unresolvedBlocks": unresolved_blocks,
            "validation": {"allDetectedQuantityLabelsPaired": not unresolved_blocks, "visualSpotCheckedRows": manifest_entry["visualSpotCheckedRows"], "humanApproved": False, "designMappingVerified": False},
        }
        return manifest_entry, inventory


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("pdfs", nargs="+", type=Path, help="Local PDF files or directories; no URLs are fetched")
    parser.add_argument("--output", type=Path, default=Path("data/parts-foundation/instructions"))
    parser.add_argument("--render-dir", type=Path, help="Optional private directory for page images; do not put copyrighted PDFs/renders in the public repository")
    parser.add_argument("--record-original-upload-gaps", action="store_true", help="Record the original eight-file upload; missing 6572269/6592544 are known transfer-limit failures")
    args = parser.parse_args()
    paths: list[Path] = []
    for item in args.pdfs:
        paths.extend(sorted(item.glob("*.pdf")) if item.is_dir() else [item])
    unique_paths = list(dict.fromkeys(p.resolve(strict=True) for p in paths))
    if not unique_paths:
        raise ValueError("No PDF files found in the explicitly provided local paths")
    file_names = [p.name for p in unique_paths]
    if len(file_names) != len(set(file_names)):
        raise ValueError("Duplicate PDF file names from different directories are ambiguous")
    documents, inventories = [], []
    for path in unique_paths:
        document, inventory = extract_pdf(path, args.render_dir)
        documents.append(document)
        if inventory:
            inventories.append(inventory)
    if args.record_original_upload_gaps:
        for file_name in EXPECTED_FILES:
            if file_name not in file_names:
                documents.append({"id": Path(file_name).stem, "fileName": file_name, "status": "transfer-limit" if file_name in {"6572269.pdf", "6592544.pdf"} else "not-provided", "setNumber": None, "pages": None, "sha256": None, "appendixPages": [], "inventoryComplete": False, "reason": "Executor transfer limit is 32 MiB; content not read. Split the PDF into smaller parts and import them locally." if file_name in {"6572269.pdf", "6592544.pdf"} else "No readable local file provided."})
    documents.sort(key=lambda d: d["id"])
    inventories.sort(key=lambda inv: inv["documentId"])
    element_counts = Counter(row["elementId"] for inv in inventories for row in inv["rows"])
    generated_at = datetime.now(timezone.utc).isoformat()
    summary = {"readableDocuments": sum(d["status"] == "ready" for d in documents), "unreadableDocuments": sum(d["status"] != "ready" for d in documents), "distinctCoverSetNumbers": sorted({d["setNumber"] for d in documents if d["setNumber"]}), "documentsWithInventoryAppendix": len(inventories), "extractedRows": sum(len(inv["rows"]) for inv in inventories), "distinctElementIds": len(element_counts), "printedQuantitySum": sum(row["quantity"] for inv in inventories for row in inv["rows"]), "visualSpotCheckedRows": sum(inv["validation"]["visualSpotCheckedRows"] for inv in inventories), "verifiedDesignMappings": 0, "completeVerifiedSetInventories": 0}
    args.output.mkdir(parents=True, exist_ok=True)
    (args.output / "manifest.json").write_text(json.dumps({"schemaVersion": 1, "generatedAt": generated_at, "provenance": "User-supplied LEGO-branded PDFs; no network source attestation", "summary": summary, "documents": documents}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    (args.output / "inventories.json").write_text(json.dumps({"schemaVersion": 1, "generatedAt": generated_at, "method": "Native PDF words; vertically adjacent quantity/element labels with coordinates", "inventories": inventories}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
