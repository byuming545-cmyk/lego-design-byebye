# Two-car presentation evidence

Start at [interactive actual five-view comparison](comparison.html), [delivery](../../docs/VEHICLE_PRESENTATION_DELIVERY.md), [runbook](../../docs/VEHICLE_PRESENTATION_RUNBOOK.md), and [three-minute script](../../docs/VEHICLE_PRESENTATION_SCRIPT.md).

- baseline/: exact e680c95 Charger model, parameters, BOM and original five views.
- round-1/: first actual models, source evidence, layout diagnostics, BOM, checks and five views. Frozen history re-rendered from source-hash-checked native meshes, not regenerated or silently upgraded.
- round-2/: accepted final models. Charger158/21, Golf160/15. Layout files are written before service generation; actual source-case retrieval, discarded belt caps and coverage gaps remain reviewable.
- browser/: actual API two-car workflow, repeated generation, five views, failure recovery, offline reload and390px checks. The normal workflow uses zero route mocks; failed requests are separately injected for recovery tests. One legacy UI test deliberately posts a fixture and is not claimed as real generation.
- craft-controls/: current-generator enabled/disabled and whole-source-set exclusions. Historical pre-craft geometry is not a compatible disabled baseline after the body generator changed.
- diagnostics/: early rejected ID draft, first camera screenshots, initial assertion/selector/path/typecheck failures. These are not accepted models or extra appearance rounds. ID repair left all native part geometries/poses unchanged.
- validation.json, render-manifest.json and browser-render-manifest.json bind the actual models, results and images. live-preview-reopen.json verifies current opening on local3000.

1008 unit tests across76 files and14 browser tests passed, including build/typecheck. Final logs are beside this file. Wheel validation remains blocked, independent five-part support reimport VALID; whole-vehicle assembly and physical build remain unverified. No weight training, paid calls, internal render uploads, push, merge or publication.

Golf inputs are local-photo-review estimates from licensed1979/1982 Mk1 references, not a new Qwen response or exact1976 trim proof. Prepared dossiers and raw attribution are in data/vehicle-demos. Current frozen examples are explicitly marked as saved results and never presented as fresh generation.
