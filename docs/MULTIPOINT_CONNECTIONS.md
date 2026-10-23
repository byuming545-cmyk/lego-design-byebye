# Native multi-point assembly, engine 0.6

`native-assembly-0.6.0` records one graph edge per actual supported physical
mating pair. An accepted attachment adds one placement and can add several
edges, including edges to more than one previously placed neighbor. The graph
must be connected; its edge count is not limited to `placements − 1`.

Raw Shadow source-line IDs are aliases when they describe the same native
position, normalized direction and mating gender on one part instance. The
shared `physicalConnectionKey` / `physicalEndpointKey` helpers provide that
identity to the engine, occupancy validator and generator. The numerical key
quantization is 1e−7 LDU; it is not manufactured clearance or a changed LEGO
dimension.

For each candidate placement the engine:

1. Uses the existing source-backed compatibility rule and transform solver for
   the selected interface.
2. Finds every supported opposite-gender source pair at coincident anchors and
   aligned source axes against all existing placements.
3. Checks that each pair independently recovers the **same** rigid placement
   using an allowed discrete twist. A coincident anchor alone is insufficient.
4. Requires every engaged physical endpoint to be unoccupied. Source aliases
   cannot bypass occupancy.
5. In production, requires every additional engaged endpoint and rule to be in
   the current part capability allowlist. An untested extra contact is blocked;
   it is not silently omitted from the graph.
6. Runs the unchanged native mesh collision validator against all existing
   parts. Coordinate consistency does not prove plastic clearance.
7. Atomically adds the new placement and all supported mating edges.

Graph validation repeats source/version/capability checks, validates every edge
against the solver, rejects duplicated physical endpoints or pairs, and detects
omitted supported coincident edges. Old 0.5 graphs and assembly certificates
require revalidation because the engine version changed.

Unsupported mechanical interfaces still have no new compatibility rules. This
work does not create a wheel, tyre, axle, pin or clip exception, nor does it
certify a continuous insertion sweep.

## Reproducible results

Run:

```sh
npx vitest run tests/parts-assembly-multipoint.test.ts
```

The tests use unchanged bundled native parts:

| Case | Coordinate consistency | Complete native attachment |
| --- | --- | --- |
| 3023b plate over 3023b plate, centered | Two aligned stud/underside pairs | PASS; two nodes and two edges |
| 3023b base, two 3005 bricks, 3023b upper bridge | Upper plate simultaneously mates with both existing bricks | PASS; four nodes and four edges |
| 3001 brick with centered 3020 plate, 0° / 180° | Eight aligned pairs share one rigid transform | BLOCKED by the existing native surface-partition limit |
| Same 3001 / 3020 pair, 90° / 270° | Four aligned pairs share one rigid transform | BLOCKED by the same native surface-partition limit |
| Selected interface shifted by half a stud | Selected anchors disagree | Rejected before collision |
| Coincident anchor with 45° unsupported source-frame twist | Rotation disagreement | Rejected before collision |
| Extra engaged port outside the production allowlist | Geometrically coincident | Rejected before collision |

The blocked large-plate example is retained as a real algorithm limit. The engine
does not raise collision budgets, ignore neighboring studs, exempt penetration
zones, or invent clearance to make it pass. It is suitable for the Astra complex
collision handoff.
