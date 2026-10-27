# V0.6 Collision Architecture — 2026-10-24

## A. Root Cause

`MULTI-3020-3710` failed before occupancy testing: finite intersecting surfaces generated cutting planes extended across a large source triangle, exhausting its partition limit. Both native proxies were already closed; this case was not caused by an AABB filled as plastic or an invented missing cavity. The baseline performed 1,648 triangle tests and checked zero surface cells. The new certificate performs 3,542 triangle tests and checks 1,789 surface cells.

## B. Architecture Change

Old: AABB → source-closed native proxy/BVH → global plane partition of each source triangle → signed occupancy.

New: retain that successful path; on partition overflow subdivide the exact triangle into local domains, query the BVH again for actual local intersections, and certify every resulting surface cell. Retain positive-area slivers and require area conservation. The tolerance remains 0.0001 LDU; global triangle, patch and time limits remain bounded. Depth is additionally limited to eight subdivisions. The 256-cell local limit applies per leaf rather than forcing a whole large source face into that representation.

Compound primitives and conservative voxels were assessed in [architecture.md](architecture.md). Neither is used to infer unsupported cavities. Native signed occupancy supplies SOLID/VOID; connection envelopes remain source-backed annotations and never erase plastic. Whole-pair tests cover all stud contacts and other surface regions. Continuous insertion is not certified.

## C. Code Changes

Core changes are confined to `collision.ts`: a versioned spatial fallback, area conservation, counters and classification. Source proxy generation, geometry, compatibility rules and public assembly/generator requests remain unchanged. Add `collision-review.ts`, `collision-diff.ts`, four new real-geometry tests and the updated eight-mate regression. See [changed-files.md](changed-files.md).

## D. Regression

| Physical interface outcome | Before | After |
|---|---:|---:|
| Discovered | 4,632 | 4,632 |
| PASS | 1,248 | 1,765 |
| BLOCKED | 786 | 786 |
| ASTRA | 2,598 | 2,081 |
| Pending | 0 | 0 |
| PASS coverage | 26.943% | 38.1045% |

Full revalidation took 294 seconds. Fully verified parts increased from 23 to 33; partially generatable parts changed from 56 to 46. The total qualified part count stays 79; no extra geometry or part was imported.

Wall, Platform, Box, Roof, Simple Chassis and SNOT regressions pass; wheel remains blocked. The independent four-part bridge has four edges. The production `3020/3710` attachment passes current source permissions and full graph validation with two nodes/four edges. This does not certify an entire strengthened chassis.

All 573 unit/API tests have final passing results (569 existing plus four new). The initial full run had 572 passes and one obsolete expected-partition-failure assertion; its replacement requires complete solid proof/eight mates and rejects missing graph edges, and all seven tests in that file pass on recheck. Nine browser scenarios and three compiled preview scenarios pass. Build/typecheck pass after explicitly typing the new CLI result array. [Full results](regression-results.json).

## E. Old PASS Regressions

Zero. Every one of the original 1,248 PASS interface groups remains PASS under fresh current-version evidence. All 517 changes are ASTRA→PASS. [Complete interface diff](interface-diff.json).

## F. Astra Case Reduction

All 537 baseline cases are classified. Fifteen minimal reproductions now pass: all 13 surface-partition cases plus two former timeout representatives. The other 522 records are retained: 304 mapping/mechanical cases outside scope, 48 connection-source interpretation cases, and 170 remaining collision/unknown/budget records. Seven budget-group representatives that already passed in V0.6 are not counted again as fixes. A representative passing does not promote every linked interface; production permissions come only from the full per-interface run.

The original pack remains a preserved comparison baseline. Current experiments use `npm run collision:review -- MULTI-3020-3710` and are recorded in [resolved](resolved-astra-cases.json) and [remaining](remaining-astra-cases.json) JSON files.

## G. Performance

Five paired measurements use identical sources/poses and unique common translations to avoid pair-certificate hits. Median target-pair time changes from 13.9 ms **returning blocked** to 318.5 ms **completing clearance**. Ordinary `3005/3024` clearance remains comparable: 26.9 ms before, 24.7 ms after. These are local measurements, not a claimed fleet-wide speedup. Existing source proxy and pair certificate caches remain version/source/pose bound. Hundreds-part assembly throughput has not been established. [Samples and method](performance.json).

## H. Remaining Risks

113 archived proxy cases still have unresolved source topology. Spatial refinement cannot prove an open/branched shell closed. Winding ambiguity, numerical limits, deep refinement and total computation limits continue to fail closed. No manufactured tolerance, flexible fit, swept insertion or physical construction certification is added.

## I. Sol Handoff

Ship the current migration and report artifacts together. Expand elongated/staggered plate structure regressions through `attachPart()` and retain full graph/permission checks. Add diagnostics and operational reporting. Follow [migration-notes.md](migration-notes.md); never retag old proofs or reuse old-version imported models as verified.

## J. Next Astra Task

Continue collision work on source-proven closure of branched/open native boundary chains, using a small representative cluster from the remaining 113 proxy cases. The current repair resolves a partition class, not general cavity reconstruction. Wheel Assembly remains a separate later task after adequate native solid evidence is available.
