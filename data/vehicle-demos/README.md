# Prepared demonstration inputs

These are frozen, hash-pinned research and observation inputs, not final vehicle coordinates. The manifest is pinned in `src/vehicles/demo-evidence.ts`. Altered files fail closed; the loader does not silently fetch replacements. There is no 24-hour cache expiry for these explicitly prepared dossiers.

Charger reuses the genuine saved Qwen response from the earlier project evidence. Golf uses development-agent inspection of three public Mk1 photographs; it is explicitly **not a Qwen response**. The source photographs show 1979/1982 vehicles. Only compatible body-family estimates are used; exact 1976 trim, wheels and bumpers are unconfirmed. Broad intervals, pixel observations and original ambiguous dimension alternatives are retained. No source precision was invented to agree with the chosen LEGO layout.

Golf dimensions retain Wikipedia revision 1383283495. The early European hatchback values 3705 × 1610 × 1395 mm, wheelbase 2400 mm, are a documented local selection among later/USA/pickup/cabriolet alternatives, not automatic exact-trim verification. Wikitext is under its original Wikimedia licence; the raw API document and revision link are retained.

Each dossier `evidence.json` contains image authors, source pages and licences. Golf's side photograph “1982 VW Mk1 Golf GTi 02.jpg” and 1979 front/rear photographs retain their Commons licence and attribution. Read those exact records before reuse. Downloaded reference images are not internal LEGO renders; no internal render was uploaded.

Native part meshes are still the pinned LDraw sources, with licences and author records in `data/parts-foundation/ldraw`. Reused OMR source patterns retain CC BY 2.0 attribution to Adrien Pennamen and Magnus Forsberg. Third-party reconstruction is not official LEGO CAD or a physical assembly certificate.

The two dossier IDs select research inputs only. The shared body planner, native fitting and current validation produce geometry. A renamed input passed to the planner yields the same poses when its evidence is unchanged; different geometric evidence changes the layout.
