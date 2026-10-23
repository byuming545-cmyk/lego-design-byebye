# Element / Design mapping source

The 531 element IDs observed in the uploaded instruction appendices have explicit
`elements` table records in a public Rebrickable-downloads database mirror.
This directory retains only the selected factual rows and their referenced
part/colour/category rows, the reviewed build-code evidence and small reports.
The full 205,639,680-byte SQLite database remains outside the repository.

- Data origin named by the mirror: **Rebrickable Downloads**.
- Mirror: **Mikalai Ananenka, `ojuuji/rb.db`**.
- Fixed release: `2026-10-22-13-13`.
- Reviewed build revision: `03547a1273f36f7ea7beb5ff7e67bc40830c15d8`.
- Published and locally checked database SHA-256:
  `7044cba72207698fb52e292638172cf5fb23e8c6b4197d6fd70eaf1e8e328d6d`.
- `data_timestamp`: `1792674802` (`2026-10-22T13:13:22Z`).
- Trust: **source-observed mirror**, not direct official/API verification.

The mirror build code is MIT-licensed; its licence is retained under
`source/ojuuji-rb-db/LICENSE`. This does **not** establish an MIT licence for
Rebrickable data. The upstream data licence was not independently verified in
this restricted session. No complete third-party database, part-image library,
Studio/LDD software library or proprietary asset archive is redistributed.

The reviewed `build.sh` downloads `elements.csv.gz` with the other original
Rebrickable tables. `schema/rb_tables.sql` labels `elements` as an original table;
`build/import_rb_tables.py` copies CSV columns directly into that table;
`tests/test_rb_csv.py` states the header
`element_id,part_num,color_id,design_id`. The mirror's generated custom tables
are not used to infer any element/design mapping.

`element-rows.json` contains the unmodified selected table values. No digit
splitting, image matching, colour guessing or local shape inference contributes
to them. `manifest.json` records the raw excerpt hash separately from the full
database hash, exact source URLs and build-file hashes. Source records preserve
Rebrickable `part_num` separately from LEGO `design_id`: for example element
`4666579` maps to part `3749`, design `6562`, colour `19` (Tan).

`ldrawCrossReferences` is currently empty. Rebrickable part IDs, design IDs and
LDraw file IDs are not silently equated. Image URLs are not sufficient proof:
the mirror documentation explicitly notes that Rebrickable inventories can use
images of similar parts or other colours. No image-filename join is enabled.

To reproduce the excerpt from the exact checksum-pinned database already
downloaded to a local path:

```bash
python data/parts-foundation/mappings/extract-mappings.py /path/to/rb.db
```

The script verifies the entire database checksum, opens it in read-only mode,
disables trusted schema evaluation and uses parameterised `SELECT` queries.
Different databases fail the checksum check. No downloaded build scripts are
executed.

Runtime interfaces and readiness reporting are in `src/parts/recovery/`.
`recovery-report.json` accounts for every observed element; it distinguishes
mapping recovery from assembly recovery. `instruction-coverage.json` preserves
all eight document entries, including both transfer-limit failures. Coverage
denominators are unique observed element IDs in available appendices; absence of
an appendix produces an unknown percentage, not a fabricated complete inventory.
