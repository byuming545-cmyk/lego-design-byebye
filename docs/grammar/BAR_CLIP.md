# Source-declared Bar ↔ Clip Grammar

## Scope

This document records the first non-C01 interface family admitted from immutable
source metadata: a round male **Bar** entering a female LDCad **Clip**.

The rule is deliberately narrow. It does not add a part-ID pairing table, and it
does not treat an arbitrary R4 cylinder as a Bar. A future part inherits the rule
only when all of the following source facts are present:

1. the root LDraw part description is an official length-denominated `Bar ...`
   title;
2. the male point is a pinned `SNAP_CYL` with gender `M`, one round `R 4`
   section, no source `id`/`group`, and caps `none` or `one`;
3. the female point is a pinned `SNAP_CLP` with gender `F`, `radius=4`,
   `length=8`, and `center=true`;
4. both points resolve to the same source-declared profile
   `ldcad-source-declared-round-bar-clip-r4-v1` and seating offset `0`.

The official LDraw description is attached to the exact importer-created point
through a `WeakMap` (`partDescriptionFor`). It is not serialized into the point
record and cannot be copied onto a forged point. This keeps historical point
digests stable.

## Pinned source evidence

| Evidence | Source |
| --- | --- |
| Bar title | `data/parts-foundation/ldraw/files/parts/30374.dat:1` — `0 Bar  4L Lightsaber Blade` |
| Bar title + clip | `data/parts-foundation/ldraw/files/parts/48729b.dat:1` — `0 Bar  1.5L with Clip with Truncated Sides and Hole in Shaft` |
| Bar `SNAP_CYL` | `data/parts-foundation/shadow/files/parts/30374.dat:8` — `R 4 80`, `caps=none`, `center=true`, `slide=true` |
| Bar `SNAP_CYL` | `data/parts-foundation/shadow/files/parts/48729b.dat:9` — `R 4 21`, `caps=one`, `slide=true` |
| Clip `SNAP_CLP` | `data/parts-foundation/shadow/files/parts/48729b.dat:8` — `radius=4 length=8 center=true` |
| Clip `SNAP_CLP` | `data/parts-foundation/shadow/files/p/clip6.dat:8` — `radius=4 length=8 center=true`, used twice by `60470b` |
| Clip semantics | LDCad metadata documentation, `SNAP_CLIP` is always female and is tested against male cylinder shapes |

Pinned revisions: LDraw `c43ed06a128a10ed65675166bf42eb6fd608b9b0`,
LDCad Shadow `9b1131fb1991f8c0bfc072325e4e12f6271aba35`. The original `.dat`
files and manifests are unchanged.

The library contains no explicit source-backed **Bar Receptacle** outside
`SNAP_CLP`. Several collision-ready parts expose female R4 `SNAP_CYL` cavities
(`11211`, `4070`, `4598`), but their titles/keywords do not declare a bar
receptacle. They remain `GENERIC_SPECIAL`; inferring a bar fit from radius or
appearance is forbidden.

## Grammar and joint semantics

- Rule: `BAR_CLIP` (`BAR` male → `CLIP` female).
- Evidence tier: `SOURCE_DECLARED_FIT`, not `VERIFIED_FIT`; this is a
  source-declared fit, not a physical-build certificate.
- Profile: `ldcad-source-declared-round-bar-clip-r4-v1`.
- Insertion interval: `[1, 8]` LDU, bounded by the clip seat length.
- Rotation: round/round, full turn `[0, 360]`.
- Slide: LDCad `slide` is respected; `BAR_CLIP` uses OR across the two
  endpoints because either side may declare sliding. Absent clip `slide` is
  treated as not declaring sliding, not as a positive permission.
- Joint: `CYLINDRICAL` when sliding is available, otherwise `REVOLUTE`.
- Collision is not used to discover the fit; it only validates the solved pose.
- `physicalBuildVerified` remains `false`; friction and retention are `UNKNOWN`.

The native adapter exposes the same rule as
`ldcad-source-declared-bar-clip-v1`. Native compatibility uses a conservative
quarter-turn candidate set `[0, 90, 180, 270]` and the maximum source-span
overlap as the conservative engagement depth, rejecting a value outside `[1, 8]`.
The pose-specific overlap is recomputed by the grammar solver; the native depth
is not a claim that every pose is fully seated.

## Open clip seat collision

The two source CLIP parts do not form closed oriented solids: `48729b` has a
non-manifold boundary and `60470b` has an open non-planar shell. They cannot pass
the original closed-solid proxy. Deleting that check would invalidate solid
collision, so this round adds a separate, explicit **open source surface** mode:

- only a part with a pinned `SNAP_CLP` endpoint is eligible for the open proxy;
- the proxy keeps the original source triangles and records
  `topology.status: 'open-source-surface'` with `signedVolume: null`;
- an open/closed pair requires a validated `BAR_CLIP` seat zone (radius 4,
  depth 1–8, centred on the clip anchor);
- every detected surface contact must lie inside that seat, and no open-surface
  vertex may lie inside the closed solid;
- `completeSurfacePartition` and `containmentChecked` remain `false`, and the
  proof is reported as `openSurfaceSeatChecked: true`;
- two open proxies are still rejected (`open-surface-pair-unresolved`).

The seat tolerance includes `0.002` LDU for LDraw four-decimal coordinate
quantization. It is not a mechanical clearance allowance. This mode does not
prove a closed volume, retention, friction or physical fit.

With this proof, `30374` (closed bar) into the `48729b` clip is clear for all
four native quarter turns, at 1,314 triangle tests per pose. `60470b` remains
unusable in the current module: its plate body intersects the 80-LDU `30374` bar
at every tested twist, and axial sliding is not admitted by the native solver.

## Production model

The normal `GrammarAssemblyService` generator now has a `bar-clip` module. It
selects a source-declared BAR root and a source-declared CLIP candidate, tries
the four native quarter turns through `AttachmentEngine.attachPart`, validates
the graph and emits the normal document.

A real generated model:

| Field | Value |
| --- | --- |
| Module | `bar-clip` / 真实零件杆夹连接模块 |
| Parts | `30374` (root), `48729b` (`p-1`) |
| Edge | `parts/30374.dat:8:0` → `parts/48729b.dat:8:0`, `ldcad-source-declared-bar-clip-v1`, twist 0, insertion depth 8 LDU |
| BOM | one `Bar  4L Lightsaber Blade`, one `Bar  1.5L with Clip ...` |
| Steps | 2 |
| Export | `artifacts/bar-clip/model.json` (12,993 bytes), `model.ldr`, `bom.csv` |
| Reimport | `VALID`, no issues |
| Physical build verified | `false` |

Machine-readable evidence: `artifacts/bar-clip/generation-report.json` and
`artifacts/bar-clip/model-revalidation.json`. The model uses one ordinary source
Bar and one ordinary source Bar-with-Clip; no part-ID-specific placement code
exists.

## Current production status

| Item | Result |
| --- | --- |
| BAR features | 2 (`30374`, `48729b`) |
| CLIP features | 3 (`48729b`, two instances in `60470b` via `clip6`) |
| Parts with source-declared BAR | 2 |
| Parts with source-declared CLIP | 2 |
| Runtime generation-eligible | 102 / 253 |
| Newly eligible versus the 99-part baseline | `30374`, `48729b`, `60470b` |
| Bar + Clip generated and reimported | **one two-part model** |
| Bar Receptacle in pinned library | **none found** |

`30374`, `48729b` and `60470b` all pass grammar admission and the open-surface
proxy. `48729b` participates in the real model. `60470b` is admitted but its
actual plate/bar collision blocks the current module; it is not evidence of a
general Bar/Plate fit.

## Negative controls

- `2412b` has an unnamed male R4 `SNAP_CYL`; it remains `GENERIC_SPECIAL` and
  `2412b → 48729b` is `unknown` / `clip-bar-seating-unresolved`.
- `60470b`'s clip endpoints come from `p/clip6.dat`, not from its Plate title;
  a subfile name never grants a BAR identity.
- Two open clip proxies are rejected rather than approximated.
- No `SNAP_CYL` female cavity is reclassified as `BAR_HOLE` from radius alone.

## Verification performed

- `npm run typecheck` — pass.
- `npm run generate:bar-clip` — generated, 2 placements, 1 edge, 2 steps,
  export 12,993 bytes, reimport `VALID`.
- `npm run probe:bar-clip` — writes the source/grammar/collision probe.
- Focused grammar/admission/connection/API tests pass; full-suite and build
  results are recorded in `artifacts/bar-clip/verification.json` and the round
  report.
- Playwright e2e/preview are blocked by the missing `/usr/bin/chromium`; they
  are not reported as passing.

## Versions

- `connector-schema-2`
- `connector-grammar-2`
- adapter `native-connector-adapter-2-source-declared-bar-clip`
- serialized connector parser `ldcad-shadow-parser-2-clear-scope`
- additive root-description context `ldraw-root-description-1`
- native rule `ldcad-source-declared-bar-clip-v1`
- collision `native-open-surface-seat-2.0.0`
