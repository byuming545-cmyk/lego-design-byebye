# Pin ↔ Pin Hole Production Slice

## Outcome

This round adds a second source-declared non-C01 family to the production graph:
round **Technic Pin** into round **Technic Connector Hole**.

It includes:

- generic PIN / PIN_HOLE classification from pinned source metadata;
- a source-declared grammar rule and joint model;
- native compatibility and solver support;
- a scoped open-pin collision proof against a closed hole;
- a normal `pin-hole` generator module;
- a generated two-part model, BOM, steps, export and successful reimport;
- tests, docs and machine-readable evidence.

No part-ID pairing table was added. No R6 cavity was promoted to a Pin Hole from
radius alone. No physical-build, retention, friction or stress claim is made.

## Source evidence

| Item | Evidence |
| --- | --- |
| Pin part | `3673` — LDraw title `Technic Pin` (`parts/3673.dat:1`) |
| Pin directive | `parts/3673.dat:10`, M `SNAP_CYL`, sections `L_ 6.25 2 / R 6 16 / R 8 4 / R 6 16 / _L 6.25 2`, `caps=none`, `center=true`, `slide=true` |
| Alternative pin | `p/connect8.dat:8`, `id=pin8`, used by `18591` |
| Hole directive | `p/connhole.dat:8`, `id=connhole`, F `R 8 2 / R 6 16 / R 8 2`, `center=true`, `slide=true` |
| Hole title | `p/connhole.dat:1` — `Technic Connector Hole Long` |
| Hole use | `32000` references `connhole.dat` twice through `SNAP_INCL` |
| Other hole sources | `p/connhol3.dat:9` (`connhol3`); `p/connhol2.dat:8` has no declared ID and stays `GENERIC_SPECIAL` |

Pinned LDraw revision: `c43ed06a128a10ed65675166bf42eb6fd608b9b0`.
Pinned LDCad Shadow revision: `9b1131fb1991f8c0bfc072325e4e12f6271aba35`.
Original source files, manifests and licenses are unchanged.

## Grammar

- Rule: `PIN_HOLE` (PIN male → PIN_HOLE female).
- Evidence tier: `SOURCE_DECLARED_FIT`.
- Shared profile: `ldcad-source-declared-round-pin-hole-r6-v1`.
- Insertion interval: `[1, 20]` LDU; graph insertion depth for the generated
  pair is 20 LDU.
- Rotation: full turn `[0, 360]`, native quarter-turn search
  `[0, 90, 180, 270]`.
- Sliding: source-declared `slide`; OR across endpoints.
- Joint: `CYLINDRICAL` when sliding exists, otherwise `REVOLUTE`.
- Known unknowns: friction, pull-out force, retention, insertion force,
  physical clearance and durability.

The adapter derives the same rule as
`ldcad-source-declared-pin-hole-v1`. The production evaluator requires a pinned
declaring title/ID, matching profile, radius 6, insertion range and the explicit
role-specific section evidence. Algorithm-only `VERIFIED_FIT` fixtures still
exercise the conditional kernel and do not become production permissions.

## Collision proof

`3673` is a movable pin and does not form a closed solid. `32000` is a closed
brick with a real through-hole. The closed-solid proof alone cannot validate the
pin surface, so this slice adds a scoped pin-envelope proof:

- only parts with a source-declared PIN endpoint may use the open proxy;
- the original source triangles are preserved and reported as
  `open-source-surface` with `signedVolume: null`;
- the PIN_HOLE seat is centred on the seated anchor, radius 8 LDU, and uses the
  full source pin envelope depth (40 LDU for `3673`);
- every surface contact must lie inside that seat;
- an open-pin vertex inside the closed hole part is allowed only inside the same
  seat;
- `completeSurfacePartition` and `containmentChecked` remain `false`,
  `wholePairExempted` remains `false`;
- normal closed-solid collision is unchanged.

The 40-LDU envelope is collision-extent evidence, not a claim that 40 LDU is
inserted. The graph still records 20 LDU insertion. A `0.002` LDU tolerance is
used only for LDraw four-decimal coordinate quantization.

This proof is weaker than a closed-solid certificate. It does not prove hole
wall thickness, retention, friction, installation path or physical fit.

Result: `3673` into `32000` is clear for all four native quarter turns.
`18591` is admitted through the same source policy, but its windscreen body
collides outside the seat in the tested hole pose; it is not used. `16477` and
several other hole-bearing parts remain blocked by open or branched boundaries.

## Generated model

| Field | Value |
| --- | --- |
| Module | `pin-hole` (`真实零件销孔连接模块`) |
| Parts | `3673` root, `32000` `p-1`; quantity 1 each |
| Edge | `parts/3673.dat:10:2` → `p/connhole.dat:8:4` |
| Rule | `ldcad-source-declared-pin-hole-v1` |
| Twist / insertion | 0° / 20 LDU |
| BOM | `Technic Pin`, `Technic Brick 1 x 2 with Holes` |
| Steps | 2 |
| Export | `artifacts/pin-hole/model.json`, 19,239 bytes |
| Model content SHA-256 | `26eaf6fe4665cc2fee6d7dfc4c85f0cb0a602e58ff0117c740f8a6d30875d12f` |
| Export SHA-256 | `c136c0feb3cd9d78a690ae2162d80661925c3cc37c85ed7d25761e3ae929fa04` |
| Reimport | `VALID`, no issues |
| Physical build verified | `false` |

Artifacts: `model.ldr`, `bom.csv`, `model-revalidation.json`,
`generation-report.json` in `artifacts/pin-hole/`.

## Current counts

| Metric | Value |
| --- | --- |
| Total pinned roots | 253 |
| Generation-eligible | 104 |
| Blocked | 149 |
| Previously verified assembly records | 0 |
| Physical builds verified | 0 |
| PIN features | 3 (`3673` one, `18591` two) |
| PIN_HOLE features | 24 across six roots |
| Newly eligible versus the 102-part Bar/Clip baseline | `3673`, `18591` |
| Pin/Hole model generated and reimported | 1 model / 2 parts |

`32000` was already a C01 candidate and now also carries two source-declared
PIN_HOLE endpoints. `18591` is eligible but not usable in the tested hole pose
because of its body collision.

## Verification

- `npm run typecheck` — passed.
- `npm test -- --maxWorkers=2` — **769/769 tests in 53 files (73.91 s)**.
  Log: `artifacts/pin-hole/logs/unit.log`.
- `npm run build` — passed. Log: `artifacts/pin-hole/logs/build.log`.
- `npm run generate:pin-hole` — generated, exported 19,239 bytes, reimport
  `VALID`.
- `npm run probe:bar-clip` — Bar↔Clip source/compatibility/collision probe still
  passes after the collision extension.
- Playwright e2e and preview — **not run in this round**; the environment still
  has no `/usr/bin/chromium`. This is an environment limitation, not a pass.

## Remaining gaps

1. Pin friction, pull-out force, retention and insertion effort are `UNKNOWN`.
2. The open pin-envelope proof is not a closed-solid or physical certificate.
3. `18591` is available but blocked by actual body collision in the tested hole
   pose.
4. `16477`, `45411`, `56204`, `54091` and other hole parts remain blocked by
   open/branched source boundaries or missing native acceptance.
5. `connhol2` has no declared source ID and remains generic; it was not promoted
   from radius.
6. No source-backed Bar Receptacle exists in the fixed 253-root library.
7. E2E/preview remain unexecuted until Chromium is available.
8. Historical migration counts remain 87/166 with the old collision version;
   they are explicitly historical and are not relabeled as current Pin results.
