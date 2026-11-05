# Reviewed assembly-module sources

This is an assembly-design library, separate from native part geometry and
connector truth. Runtime status is computed by the production engine, not stored
as a `generatable` flag in the recipes.

The two unchanged source sections are from the licensed reconstruction of set
76897 by **Adrien Pennamen [Adrien Pennamen]**, pinned in
`vdirienzo/ldrawomr@99a10d3d5ec094277793eb5919f13163d279cf2e`, file
`corpus/mpds_licensed/76897-1.mpd`. Each section explicitly declares
`Redistributable under CCAL version 2.0 : see CAreadme.txt`. The applicable
Creative Commons Attribution 2.0 text is retained in `LICENSE-CC-BY-2.0.txt`.

The whole source file SHA-256 is
`73e7d39acc7b9f00948f5e2ad7ba1cffaf08febcfd8eda60494a849eac7b0032`.
`python scripts/check-module-source.py` verifies the fixed original URL and exact
section bytes; `--source-file` can check an already acquired copy offline.

This source is a third-party reconstruction of an official set design, not an
official LEGO CAD release. Repository code licensing is not inferred from these
per-section model licences. No repository scripts or installers were executed.
The model's original sticker omissions are retained, not fabricated.

Recipes:

- `76897-hood-core`: five unchanged source placements from the hood. The two
  source 3069a trim tiles are outside this extracted core, not substituted.
- `76897-hood-adapted`: all seven hood placements, with two explicitly recorded
  substitutions from source 3069a to actual 3069b. These are different identities;
  the adapted assembly must pass independently. It is not a verified alias.
- `76897-spoiler-blade`: eight unchanged source placements, excluding the two
  3665b mounting supports unavailable in the current native catalogue. This is a
  blade subset, not the complete original spoiler. Current validation blocks it.

Reference colour numbers are retained in module provenance. Model BOM uses
unspecified LDraw colour 16; physical colour availability is not asserted.

Production geometry and connectivity still come exclusively from the separately
reviewed native LDraw/Shadow library. These files do not override native part
IDs, geometry, connector rules, collision regions or permissions. Adding or
changing a recipe requires source review, updated independent catalogue pins,
tests and model revalidation. The licences here do not relicense the application
or grant redistribution rights to PDFs, Studio resources or unrelated data.
