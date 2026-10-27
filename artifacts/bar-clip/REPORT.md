# Bar ↔ Clip source grammar — round report

## Outcome

The source-backed **Bar ↔ Clip** grammar is implemented and exercised through the
real parser, canonical adapter, grammar rules, native compatibility bridge and
native solver. It is not claimed as generated, exported or reimported because the
only two source parts that declare a Clip have open/non-manifold collision shells.

- New formal connection family: `BAR_CLIP` (`BAR` male → `CLIP` female).
- New source identity: the official root LDraw description, retained as
  non-serialized provenance and never inferred from R4 geometry.
- Newly generation-eligible real part: `30374` (Bar 4L).
- Real Bar + Clip produced by the normal generator: **0**.
- Source-backed Bar Receptacle in the pinned library: **0 found**.

## Source evidence

| Part | Source declaration | Interface |
| --- | --- | --- |
| `30374` | `Bar  4L Lightsaber Blade`; `SNAP_CYL [gender=M] [caps=none] [secs=R 4 80] [center=true] [slide=true]` | one BAR male |
| `48729b` | `Bar  1.5L with Clip ...`; `SNAP_CLP [radius=4] [length=8] [center=true]` and `SNAP_CYL [gender=M] [caps=one] [secs=R 4 21] [slide=true]` | one CLIP female, one BAR male |
| `60470b` | `Plate  1 x  2 with  2 Clips Horizontal ...`; two instances of `p/clip6.dat:8` `SNAP_CLP [radius=4] [length=8] [center=true]` | two CLIP female |

Feature counts derived from the 253-root audit: **2 BAR features / 2 parts** and
**3 CLIP features / 2 parts**.

The parts `11211`, `4070` and `4598` expose female R4 `SNAP_CYL` cavities, but their
LDraw descriptions do not declare a bar receptacle. They stay `GENERIC_SPECIAL`
with `coverage: PARTIAL`; radius is not used as bar identity.

## Grammar behavior

- Profile: `ldcad-source-declared-round-bar-clip-r4-v1`.
- Insertion interval: `[1, 8]` LDU.
- Rotation: round/round, `[0, 360]`; native graph uses the conservative keys
  `[0, 90, 180, 270]`.
- Slide: OR across the two endpoints because either side may declare `slide=true`;
  absent clip `slide` means not declared, not a positive permission.
- Joint: `CYLINDRICAL` when a side declares sliding and both establish roll.
- Evidence tier: `SOURCE_DECLARED_FIT`; not `VERIFIED_FIT`.
- `physicalBuildVerified: false`; friction, retention and stress remain `UNKNOWN`.

Live probe result (`npm run probe:bar-clip`, [probe.json](probe.json)):

| Pair | Compatibility | Rule | Solver |
| --- | --- | --- | --- |
| `30374` → `48729b` clip | compatible | `ldcad-source-declared-bar-clip-v1` | solved, 4 candidates |
| `30374` → `60470b` clip | compatible | `ldcad-source-declared-bar-clip-v1` | solved, 4 candidates |
| `2412b` unnamed R4 → `48729b` clip | unknown | — | 0 candidates |

The third row is the negative control: a male R4 cylinder with no official Bar
description is not promoted.

## Admission and production blocker

| Part | Connectable | Collision-ready | Generation-eligible | Reason |
| --- | --- | --- | --- | --- |
| `30374` | yes | yes | yes | BAR endpoint admitted |
| `48729b` | yes | no | no | `grammar-collision-non-manifold-boundary` |
| `60470b` | yes | no | no | `grammar-collision-open-nonplanar-shell` |

`30374` is only a male endpoint; no source-backed Clip is eligible, so the normal
generator cannot form a Bar↔Clip structure. This is a **code/collision-proxy
limitation**, not a missing fit rule. The strict proxy requires a closed oriented
solid. Adding a surface-only clearance mode for open clip shells would be a new
proof semantics and has not been simulated by deleting the blocker. The generator
also anchors/candidates only on standard studs today; it has no Bar/Clip layout
search path yet.

No model, BOM, steps, export, reimport or physical-build proof is claimed. The
pre-existing migration proof ledger is retained byte-for-byte; parser v2 remains
the serialized-point version, while the additive description context has its own
`ldraw-root-description-1` version and is stored in a `WeakMap`, not in point
records.

## Verification executed

- `npm run typecheck` — pass.
- `npm test -- --maxWorkers=2` — **763/763 tests, 53/53 files pass** (79.47 s).
- `npm run build` — pass (typecheck, Vite client, server TypeScript).
- Focused grammar/connection/admission tests — 82/82 pass; source/audit subset
  25/25 pass.
- Full source point audit — every pre-existing point/source closure digest
  unchanged; the two new BAR points are additive.
- `npm run probe:bar-clip` — writes [probe.json](probe.json).
- Machine-readable evidence: [verification.json](verification.json).
- `npm run test:e2e` — **not executed against the app**: the environment has no
  Chromium at `/usr/bin/chromium`, so all 11 Playwright tests fail in
  `browserType.launch`. `npm run test:preview` was therefore not run. These are
  environment blockers, not passing or failing application tests.

## Remaining gaps

1. Open-shell collision clearance for `48729b` and `60470b` is unresolved.
2. The normal generator has no Bar/Clip anchor/candidate path.
3. No source-backed standalone Bar Receptacle exists in the pinned library.
4. Retention, friction, stress and physical fit remain `UNKNOWN`.
5. Other non-C01 families (Pin, Axle, Wheel, Hinge, Ball, Rail) remain outside the
   production graph.
