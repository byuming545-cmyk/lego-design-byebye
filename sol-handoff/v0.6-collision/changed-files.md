# Changed implementation

- `src/parts/assembly/collision.ts`: versioned bounded spatial fallback, unchanged native surface subdivision, retained positive-area slivers, area conservation, whole-pair winding tests, diagnostic classification and fallback counts. AABB broad phase, proxy construction, tolerance and global budgets remain unchanged.
- `src/cli/collision-review.ts`: hash-checked explicit cross-version case experiments and root-cause clustering; no production permission publication.
- `tests/parts-collision-local-partition.test.ts`: real multi-stud pair, reversed query, common rigid frame, lateral intrusion and excess insertion.
- Migration/parts/model artifacts: regenerated under the new collision version, never retagged.

No edits to wheel mechanics, connection compatibility, Element identity, UI or original native library files.
