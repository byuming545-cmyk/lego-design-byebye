# Reviewed assembly-module sources

This is an assembly-design library, separate from native part geometry and
connector truth. Runtime status is computed by the production engine, not stored
as a `generatable` flag in the recipes.

The original three unchanged source sections are from the licensed reconstruction of set
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
- `76897-rear-panel-core`: three unchanged placements (source ordinals 5, 6, 7)
  from `76897 - Back trunk.ldr`: two 3666 plates and one 6636 tile. The remaining
  trunk parts and sticker are outside this extracted panel core; this is not a
  complete rear body. It is a different source design function from the hood.

Reference colour numbers are retained in module provenance. Model BOM uses
unspecified LDraw colour 16; physical colour availability is not asserted.

Two further recipes, `75878-curved-cover-right` and `75878-curved-cover-left`,
reuse three unchanged placements each from **Magnus Forsberg [MagFors]**'s
licensed reconstruction of set 75878 in the same fixed upstream revision.
Original `corpus/mpds_licensed/75878-1.mpd` SHA-256:
`86cbff6fcbfc1966d503155fc754e1ae97219f0ccf85cfa0a5c2b3982aa3e4b2`.
The complete, explicitly CCAL 2.0 section `75878 - body-1.ldr` is preserved
verbatim as `source/75878-body.ldr` (SHA-256
`b9f465dcced41726f002626c52287caedc7c777bf31561fed9430bd2da0e62d7`).
Only ordinals 99/100/101 or 102/103/104 belong to a recipe: 3022 carrier,
15068 exterior curved cover, 3069b trim. No identities or source poses changed.
These are local side-cover cores, not complete sides, cockpits or cars.
Left/right denotes the original extraction location, not a final vehicle axis.
The 15068 members retain the restricted surface-only contract.

The reader now validates only selected literal native type-1 placements.
Excluded nested/rounded records are retained in the immutable parent bytes but
not expanded or used as dependencies of the extracted module. Selecting one of
those unsupported records still fails. Changing even an excluded record fails
the full source hash check. No connectivity is inferred from this design data.
The module policy is version 3 and the reviewed library digest has changed;
restart the service and refresh the page after updating. Old module receipts
require revalidation; the native collision version remains 4.1.0. Earlier models
and sources remain untouched.

`scripts/check-module-source.py` independently pins both original URLs/hashes,
checks each section author/licence and exact bytes, and downloads each original
only once. `--source-directory` supports offline copies named `<set>-1.mpd`;
the legacy `--source-file` applies to 76897 only. No arbitrary URL is accepted.

Ranked installation counts noncoincident current source contact locations,
prefers greater span, then uses the native bounding-box centre as a tie breaker.
It does not estimate centre of mass or certify stability. `installationSupport`
is rebuilt from the currently validated graph; uploaded scores are not trusted.
One or two reviewed module IDs can now be composed through the normal generator,
with branch alternatives sharing the existing attempt, time and document limits.
Earlier module-policy/library receipts remain historical and require current
revalidation or regeneration; their saved source models are not rewritten.

Production geometry and connectivity still come exclusively from the separately
reviewed native LDraw/Shadow library. These files do not override native part
IDs, geometry, connector rules, collision regions or permissions. Adding or
changing a recipe requires source review, updated independent catalogue pins,
tests and model revalidation. The licences here do not relicense the application
or grant redistribution rights to PDFs, Studio resources or unrelated data.
