# Source-declared Pin ↔ Pin Hole Grammar

## Scope

This document records the second non-C01 interface family admitted from immutable
source metadata: a round male **Technic Pin** entering a female **Technic
Connector Hole**.

The rule is deliberately narrow. It does not add a part-ID pairing table, and it
does not treat an arbitrary R6 cavity as a Pin Hole. A future part inherits the
rule only when all of the following source facts are present:

1. the male point is a pinned `SNAP_CYL` with gender `M`, a declared `pin8`
   identifier, or a root LDraw description beginning with `Technic Pin`;
2. the male sections are multi-section `R`/`L_`/`_L` profiles with at least one
   `R 6` section, caps `none` or `one`, no `group`, and a resolved frame;
3. the female point is a pinned `SNAP_CYL` with gender `F`, `center=true`,
   `slide=true`, a `connhole`/`connhol3` identifier, or a Shadow title beginning
   with `Technic Connector Hole`;
4. the female sections are `R`/`L_`/`_L` profiles with at least one `R 6`, a
   total source length of 20 LDU, and no `group`;
5. both points resolve to the same source-declared profile
   `ldcad-source-declared-round-pin-hole-r6-v1` and seating offset `0`.

The declaring Shadow title is attached to the exact importer-created point
through a `WeakMap` (`connectionDescriptionFor`). It is not serialized into the
point record and cannot be copied onto a forged point. Historical point digests
therefore remain stable.

## Pinned source evidence

| Evidence | Source |
| --- | --- |
| Pin title | `data/parts-foundation/ldraw/files/parts/3673.dat:1` — `0 Technic Pin` |
| Pin `SNAP_CYL` | `data/parts-foundation/shadow/files/parts/3673.dat:10` — multi-section `L_ 6.25 2 / R 6 16 / R 8 4 / R 6 16 / _L 6.25 2`, `caps=none`, `center=true`, `slide=true` |
| Pin `SNAP_CYL` | `data/parts-foundation/shadow/files/p/connect8.dat:8` — `id=pin8`, `R 8 2 / R 6 16 / _L 6.25 2`, `caps=one`, used twice by `18591` |
| Hole id + directive | `data/parts-foundation/shadow/files/p/connhole.dat:8` — `id=connhole`, `R 8 2 / R 6 16 / R 8 2`, `center=true`, `slide=true` |
| Hole title | `data/parts-foundation/shadow/files/p/connhole.dat:1` — `Technic Connector Hole Long` |
| Hole `SNAP_INCL` use | `parts/32000.dat` references `connhole.dat` twice through `SNAP_INCL ref=connhole.dat` |
| Additional hole source | `p/connhol3.dat:9` — `id=connhol3`, `R 6 16 / R 8 2`, `center=true`, `slide=true` |
| Unidentified hole source | `p/connhol2.dat:8` — no `id`; remains `GENERIC_SPECIAL` until a declared identity is available |

Pinned revisions: LDraw `c43ed06a128a10ed65675166bf42eb6fd608b9b0`,
LDCad Shadow `9b1131fb1991f8c0bfc072325e4e12f6271aba35`. The original `.dat`
files and manifests are unchanged.

## Grammar and joint semantics

- Rule: `PIN_HOLE` (`PIN` male → `PIN_HOLE` female).
- Evidence tier: `SOURCE_DECLARED_FIT`, not `VERIFIED_FIT`; this is a
  source-declared fit, not a physical-build certificate.
- Profile: `ldcad-source-declared-round-pin-hole-r6-v1`.
- Insertion interval: `[1, 20]` LDU. The native graph records the actual
  source-span overlap of the pair (20 for `3673` + `32000`).
- Rotation: round/round, full turn `[0, 360]`.
- Slide: LDCad `slide` is respected; `PIN_HOLE` uses OR across the two
  endpoints because either side may declare sliding.
- Joint: `CYLINDRICAL` when sliding is available, otherwise `REVOLUTE`.
- Collision is not used to discover the fit; it only validates the solved pose.
- `physicalBuildVerified` remains `false`; friction, pull-out force and
  retention are `UNKNOWN`.

The native adapter exposes the same rule as
`ldcad-source-declared-pin-hole-v1`. Native compatibility uses a conservative
quarter-turn candidate set `[0, 90, 180, 270]` and the source-span overlap as
the recorded insertion depth.

## Pin envelope collision proof

`3673` is a movable pin and does not form a closed solid. `32000` is a closed
brick with a genuine through-hole. The closed-solid proof alone would reject the
pin surface before a Pin/Hole pose can be tested, so this slice adds a scoped
**pin envelope** seat proof:

- only a part with a pinned `SNAP_CYL` pin endpoint is eligible for the open
  proxy;
- the proxy keeps the original source triangles and records
  `topology.status: 'open-source-surface'` with `signedVolume: null`;
- an open pin/closed hole pair requires a validated `PIN_HOLE` seat (radius 8,
  depth equal to the full source pin envelope, up to 40 LDU, centred on the
  seated anchor);
- every detected surface contact must lie inside that seat;
- an open-pin vertex strictly inside the closed hole part is allowed only when
  it lies inside the same seat; otherwise it is a collision;
- `completeSurfacePartition` and `containmentChecked` remain `false`, and the
  proof is reported as `openSurfaceSeatChecked: true` with
  `wholePairExempted: false`;
- normal closed-solid collision is unchanged.

The seat tolerance includes `0.002` LDU for LDraw four-decimal coordinate
quantization. It is not a mechanical clearance allowance. This mode does not
prove a closed volume, hole wall thickness, retention, friction or physical fit.
In particular, the 40-LDU pin envelope is larger than the 20-LDU hole insertion
depth; the larger envelope is used only to validate collision along the full
pin body, not to claim a 40-LDU insertion.

With this proof, `3673` into the `32000` hole is clear for all four native
quarter turns. `18591` is admitted through the same source policy, but its
windscreen body intersects the `32000` pose outside the seat; it is not used.
`16477` and several other hole-bearing parts remain blocked by open or branched
source boundaries.

## Production model

The normal `GrammarAssemblyService` generator now has a `pin-hole` module. It
selects a source-declared PIN root and a source-declared PIN_HOLE candidate,
tries the four native quarter turns through `AttachmentEngine.attachPart`,
validates the graph and emits the normal document.

A real generated model:

| Field | Value |
| --- | --- |
| Module | `pin-hole` / 真实零件销孔连接模块 |
| Parts | `3673` (root), `32000` (`p-1`) |
| Edge | `parts/3673.dat:10:2` → `p/connhole.dat:8:4`, `ldcad-source-declared-pin-hole-v1`, twist 0, insertion depth 20 LDU |
| BOM | one `Technic Pin`, one `Technic Brick  1 x  2 with Holes` |
| Steps | 2 |
| Export | `artifacts/pin-hole/model.json` (19,239 bytes), `model.ldr`, `bom.csv` |
| Reimport | `VALID`, no issues |
| Physical build verified | `false` |

Machine-readable evidence: `artifacts/pin-hole/generation-report.json` and
`artifacts/pin-hole/model-revalidation.json`. The model uses one ordinary source
Pin and one ordinary source Pin-Hole brick; no part-ID-specific placement code
exists.

## Current production status

| Item | Result |
| --- | --- |
| PIN features | `3673` one; `18591` two (`pin8`) |
| PIN_HOLE features | 24 across six roots, including `32000` two |
| Parts with source-declared PIN | 2 |
| Parts with source-declared PIN_HOLE | 6 |
| Runtime generation-eligible | 104 / 253 |
| Newly eligible versus the 102-part Bar/Clip baseline | `3673`, `18591` |
| Pin + Hole generated and reimported | **one two-part model** (`3673` + `32000`) |

`18591` is admitted but its actual body collision blocks the tested hole poses;
it is not evidence of a general windscreen/pin fit. `32000` was already a C01
candidate and now also carries two source-declared PIN_HOLE endpoints.

## Negative controls

- `STUD/HOLLOW_STUD → PIN_HOLE` remains `ILLEGAL`.
- An unnamed R6 cavity is not a Pin Hole; `connhol2` remains `GENERIC_SPECIAL`.
- A one-section R6 cylinder is not a Technic Pin; multi-section evidence and a
  declared Pin identity are required.
- A 40-LDU pin is not claimed to be fully inserted into a 20-LDU hole; the graph
  records 20 LDU insertion and the collision proof uses the full pin envelope
  only for clearance.
- No `SNAP_CYL` female cavity is reclassified as a Pin Hole from radius alone.
- Two open surfaces are not silently treated as a closed-solid certificate.

## Verification performed

- `npm run typecheck` — pass.
- `npm run generate:pin-hole` — generated, 2 placements, 1 edge, 2 steps,
  export 19,239 bytes, reimport `VALID`.
- Focused grammar/admission/connection/API tests include a real Pin/Hole solver
  and collision regression.
- Full-suite and build results are recorded in
  `artifacts/pin-hole/verification.json` and the round report.
- Playwright e2e/preview are blocked by the missing `/usr/bin/chromium`; they
  are not reported as passing.

## Versions

- `connector-schema-2`
- `connector-grammar-2`
- adapter `native-connector-adapter-2-source-declared-bar-clip`
- serialized connector parser `ldcad-shadow-parser-2-clear-scope`
- additive Shadow-title context `ldraw-root-description-1`
- native rule `ldcad-source-declared-pin-hole-v1`
- collision `native-open-surface-seat-2.0.0`
