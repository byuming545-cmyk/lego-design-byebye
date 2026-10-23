#!/usr/bin/env python3
"""Extract only observed element mapping facts from a checksum-pinned rb.db mirror.

The database is read-only. The build scripts' MIT licence does not establish a
licence for Rebrickable data; the output keeps that distinction explicit.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sqlite3

EXPECTED_SHA256 = "7044cba72207698fb52e292638172cf5fb23e8c6b4197d6fd70eaf1e8e328d6d"
SOURCE_COMMIT = "03547a1273f36f7ea7beb5ff7e67bc40830c15d8"
RELEASE_TAG = "2026-10-22-13-13"


def digest(path):
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("database", type=Path)
    parser.add_argument("--observations", type=Path, default=Path("data/parts-foundation/instructions/inventories.json"))
    parser.add_argument("--output", type=Path, default=Path("data/parts-foundation/mappings"))
    args = parser.parse_args()
    if digest(args.database) != EXPECTED_SHA256:
        raise ValueError("Database differs from the reviewed, published release checksum")
    observations = json.loads(args.observations.read_text(encoding="utf-8"))
    identifiers = sorted({str(row["elementId"]) for inventory in observations["inventories"] for row in inventory["rows"]})
    if not identifiers or any(not value.isdigit() for value in identifiers):
        raise ValueError("Observed element IDs must be explicitly present, numeric labels")
    db = sqlite3.connect(args.database.resolve().as_uri() + "?mode=ro", uri=True)
    db.execute("PRAGMA trusted_schema=OFF")
    db.row_factory = sqlite3.Row
    placeholders = ",".join("?" for _ in identifiers)
    elements = [dict(row) for row in db.execute(f"SELECT element_id,part_num,color_id,design_id FROM elements WHERE element_id IN ({placeholders}) ORDER BY element_id", identifiers)]
    part_ids = sorted({row["part_num"] for row in elements})
    color_ids = sorted({row["color_id"] for row in elements})
    parts = [dict(row) for row in db.execute("SELECT part_num,name,part_cat_id,part_material FROM parts WHERE part_num IN (" + ",".join("?" for _ in part_ids) + ") ORDER BY part_num", part_ids)]
    colors = [dict(row) for row in db.execute("SELECT id,name,rgb,is_trans FROM colors WHERE id IN (" + ",".join("?" for _ in color_ids) + ") ORDER BY id", color_ids)]
    category_ids = sorted({row["part_cat_id"] for row in parts})
    categories = [dict(row) for row in db.execute("SELECT id,name FROM part_categories WHERE id IN (" + ",".join("?" for _ in category_ids) + ") ORDER BY id", category_ids)]
    metadata = dict(db.execute("SELECT key,value FROM rb_db_lov"))
    db.close()
    source_id = "rebrickable-downloads-mirror-2026-10-22-13-13"
    data = {
        "schemaVersion": 1, "sourceId": source_id,
        "scope": f"Only rows needed for the {len(identifiers)} distinct observed instruction elements; no complete database redistribution",
        "requestedElementIds": identifiers,
        "tables": {"elements": elements, "parts": parts, "colors": colors, "part_categories": categories},
        "unresolvedElementIds": sorted(set(identifiers) - {str(row["element_id"]) for row in elements}),
    }
    args.output.mkdir(parents=True, exist_ok=True)
    snapshot = args.output / "element-rows.json"
    snapshot.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    manifest = {
        "schemaVersion": 1,
        "source": {
            "id": source_id, "kind": "rebrickable-downloads-mirror",
            "repository": "https://github.com/ojuuji/rb.db", "revision": SOURCE_COMMIT,
            "releaseTag": RELEASE_TAG,
            "url": f"https://github.com/ojuuji/rb.db/releases/download/{RELEASE_TAG}/rb.db.xz",
            "publishedChecksumUrl": f"https://github.com/ojuuji/rb.db/releases/download/{RELEASE_TAG}/rb.db.sha256",
            "databaseSha256": EXPECTED_SHA256, "databaseBytes": args.database.stat().st_size,
            "dataTimestamp": int(metadata["data_timestamp"]), "databaseSchemaVersion": metadata["schema_version"],
            "trust": "source-observed", "independentlyVerifiedOfficial": False,
            "upstreamTables": {
                table: f"https://cdn.rebrickable.com/media/downloads/{table}.csv.gz"
                for table in ["elements", "parts", "colors", "part_categories"]
            },
            "upstreamTablesFetchedDirectly": False,
            "dataLicense": "not-independently-verified",
            "codeLicense": "MIT; applies to mirror build code, not asserted for Rebrickable data",
            "attribution": "Mapping facts: Rebrickable; public database mirror/build: Mikalai Ananenka (ojuuji/rb.db).",
            "designIdBasis": "elements.csv design_id column copied by the reviewed importer; no local number-pattern or image inference",
        },
        "rawSnapshot": {"path": snapshot.name, "sha256": digest(snapshot), "bytes": snapshot.stat().st_size},
        "observationSnapshotSha256": digest(args.observations),
        "counts": {"requestedElements": len(identifiers), "elementMappings": len(elements), "parts": len(parts), "colors": len(colors), "categories": len(categories), "unresolved": len(data["unresolvedElementIds"])},
        "ldrawCrossReferences": [],
        "limitations": ["Mirror source observations are not direct official/API verification", "Rebrickable part numbers and LEGO design IDs are kept separate", "No same-number LDraw cross-reference inference", "Image URLs can show similar parts and are not geometry identity evidence", "No complete Rebrickable database or proprietary software library is redistributed"],
    }
    audited_files = ["build.sh", "build/import_rb_tables.py", "schema/rb_tables.sql", "tests/test_rb_csv.py", "LICENSE"]
    manifest["sourceAuditFiles"] = [
        {"path": "source/ojuuji-rb-db/" + name,
         "sha256": digest(args.output / "source/ojuuji-rb-db" / name),
         "sourceUrl": "https://raw.githubusercontent.com/ojuuji/rb.db/" + SOURCE_COMMIT + "/" + name}
        for name in audited_files if (args.output / "source/ojuuji-rb-db" / name).is_file()
    ]
    (args.output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest["counts"], indent=2))


if __name__ == "__main__":
    main()
