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
quarter-turn candidate set `[0, 90, 180, 270]` and uses the maximum source-span
overlap as the conservative engagement depth, rejecting a value outside `[1, 8]`.
The pose-specific overlap is recomputed by the grammar solver; the native depth
is not a claim that every pose is fully seated.

## Current production status

| Item | Result |
| --- | --- |
| BAR features | 2 (`30374`, `48729b`) |
| CLIP features | 3 (`48729b`, two instances in `60470b` via `clip6`) |
| Parts with source-declared BAR | 2 |
| Parts with source-declared CLIP | 2 |
| Newly generation-eligible | `30374` only |
| Bar + Clip generated and reimported | **none** |
| Bar Receptacle in pinned library | **none found** |

`30374` is eligible because its BAR endpoint and closed collision mesh are valid,
but it is only a male endpoint; the two available CLIP parts are not eligible:

- `48729b`: `Native oriented boundary multiplicity is unresolved.`
  (`grammar-collision-non-manifold-boundary`)
- `60470b`: `An open native boundary has no source-proven planar internal cap.`
  (`grammar-collision-open-nonplanar-shell`)

The normal generator also currently anchors only on standard studs; it does not
search BAR/CLIP layouts. These are code limitations, not missing source fit
evidence. Relaxing the closed-solid collision proof for an open clip shell would
be a separate, explicitly proven surface mode; it has not been implemented and
must not be simulated by deleting the blocker.

## Verification performed

- `npm run typecheck` — pass.
- `npm test -- --maxWorkers=2` — 763/763 tests pass.
- `npm run build` — pass.
- `vitest run tests/parts-assembly-connections.test.ts
  tests/parts-grammar-sources.test.ts tests/parts-connection-audit.test.ts` —
  25/25 pass.
- Full source audit preserves every pre-existing point digest; the new BAR/CLIP
  classification is derived from source, not from a part-ID table.
- Playwright e2e/preview were not run against the app: the environment has no
  Chromium at `/usr/bin/chromium`. This is not a passing e2e result.
- No model, BOM, step file, export or reimport is claimed for Bar ↔ Clip.

## Versions

- `connector-schema-2`
- `connector-grammar-2`
- adapter `native-connector-adapter-2-source-declared-bar-clip`
- serialized connector parser `ldcad-shadow-parser-2-clear-scope`
- additive root-description context `ldraw-root-description-1`
- native rule `ldcad-source-declared-bar-clip-v1`
