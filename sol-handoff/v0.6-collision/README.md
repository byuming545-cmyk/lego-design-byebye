# V0.6 Complex Collision — Astra to Sol

This branch addresses generic native surface partition blow-up. It does not introduce mechanical mating rules or map new Elements.

Read [architecture.md](architecture.md) for the pre-implementation review and bounded prototype decisions, [migration-notes.md](migration-notes.md) for version invalidation and reproduction, and [changed-files.md](changed-files.md) for the implementation scope.

## Completed architecture

The original closed-native-mesh/BVH pipeline remains the fast path. An over-complex source triangle is subdivided spatially without changing its surface. Each local triangle queries actual intersecting opponent faces; complete plane partitions and signed occupancy checks then cover all resulting cells. Positive-area slivers are retained and surface area is checked. Unknown topology, exhausted resources and actual plastic intersections never receive clearance.

SOLID/VOID come from the source-closed shell's signed occupancy. Seating envelopes are source-supported connection annotations, not plastic-volume exemptions. A multi-stud connection still requires one consistent transform and all graph mates. Whole-pair collision checking covers all engaged studs and all non-connection regions, independent of which endpoint selected the candidate. This implementation does not add an envelope-union collision exemption.

## Evidence

- [interface-diff.json](interface-diff.json): all 4,632 source interfaces compared to the frozen V0.6 baseline, including every old PASS regression.
- [resolved-astra-cases.json](resolved-astra-cases.json) and [remaining-astra-cases.json](remaining-astra-cases.json): original 537 cases classified, with explicit current-version collision replays and outside-scope records.
- [regression-results.json](regression-results.json): final module, unit/API and browser results.
- [performance.json](performance.json): paired old/new algorithm measurements on identical native geometry and rigid placements.

```sh
npm run collision:review -- MULTI-3020-3710
npm run collision:review
npm run collision:diff
```

The original `astra-handoff/` remains historical V0.6 evidence. Its old-version strict replay is intentionally invalid under the new collision version; use the explicit cross-version command above.

## Sol can continue

1. Use the shipped current migration proofs; retain per-endpoint permissions and all version checks when generating structures.
2. Expand structural regression fixtures for elongated, staggered plate assemblies through `attachPart()`. Pair clearance alone does not certify a whole chassis or insertion trajectory.
3. Add operational reports and source-based diagnostic visualization without altering acceptance rules. Retry remaining scheduling-budget groups with source-bound fixtures, never promote a representative to an entire group.

## Still requires algorithm work

Open/branched native shells and ambiguous winding still need certified topology/solid reconstruction. Spatial subdivision is not a general solution for every unresolved cavity. Continuous whole-part insertion, mechanical tolerance, tyre/wheel, axle/hole and clip/bar rules remain unimplemented. No physical-build certification is implied by software clearance.

The next Astra task should first address the largest remaining native topology class, rather than treating the newly successful plate pair as proof that the whole collision system is ready for wheel mechanics.
