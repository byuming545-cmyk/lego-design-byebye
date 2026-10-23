# Assembly connection rule sources and scope

Rule set version: `source-stud-1.0.0`.

The first supported rule is
`ldcad-standard-stud-to-capped-underside-v1`. It solves a **candidate** rigid
attachment. Its success alone never sets `assemblyVerified` or `generatable`:
native collision, graph occupancy, representative fixture tests and the batch
smoke test still gate those capabilities.

## Named, immutable inputs

Connections come from Roland Melkert and the LDCad Shadow Library contributors,
revision `9b1131fb1991f8c0bfc072325e4e12f6271aba35`, CC BY-SA 4.0:

- [Contributor guide](https://github.com/RolandMelkert/LDCadShadowLibrary/blob/9b1131fb1991f8c0bfc072325e4e12f6271aba35/CONTRIBUTING.md):
  its Rotation section explicitly says all resting information points toward
  negative Y; its IDs section identifies `studC`, `studO` and `aStud`.
- [Closed stud](https://github.com/RolandMelkert/LDCadShadowLibrary/blob/9b1131fb1991f8c0bfc072325e4e12f6271aba35/p/stud.dat),
  line 8: male `studC`, one cap, `R 6 4`.
- [Open stud](https://github.com/RolandMelkert/LDCadShadowLibrary/blob/9b1131fb1991f8c0bfc072325e4e12f6271aba35/p/stud2a.dat),
  line 11: male `studO`, one cap, `R 6 4`.
- [1 × 1 plate underside](https://github.com/RolandMelkert/LDCadShadowLibrary/blob/9b1131fb1991f8c0bfc072325e4e12f6271aba35/parts/s/3024s01.dat),
  line 8: female, one cap, `S 6 4`, opening at `[0, 8, 0]`.
- [2 × 4 brick underside](https://github.com/RolandMelkert/LDCadShadowLibrary/blob/9b1131fb1991f8c0bfc072325e4e12f6271aba35/parts/s/3001s01.dat),
  line 9, explicitly under the source's “Bottom stud holes” comment: female, one
  cap, `R 6 20`, openings at native Y = 24 on the declared centered grid.
- [1 × 1 brick underside](https://github.com/RolandMelkert/LDCadShadowLibrary/blob/9b1131fb1991f8c0bfc072325e4e12f6271aba35/parts/s/3005s01.dat),
  line 8: female, one cap, `S 6 20`, opening at `[0, 24, 0]`.

The corresponding native geometry comes from the separately pinned LDraw
revision `c43ed06a128a10ed65675166bf42eb6fd608b9b0`. The loader checks each source
file's SHA-256 against its packaged manifest. Every compatibility result retains
the two exact source directives, file names, line numbers, hashes and immutable
URLs. Those bytes establish the radius, section profile, depth and source frame;
the solver does not estimate them from an image, bounding box or display label.

The full external LDCad meta specification was not downloaded during this task.
This rule is intentionally restricted to the ordinary stud/underside source
patterns above. It does not claim to implement all matching semantics of `R`,
`S`, axial shoulders or arbitrary cylinder sections.

## Eligibility and seating

The male endpoint must be explicitly sourced from `p/stud.dat`, `p/stud2.dat`, or
`p/stud2a.dat`, with source ID `studC` or `studO`, one round section of radius 6
LDU and length 4 LDU, one cap, no centered origin and no sliding. A differently
named cylinder with the same radius is not promoted into a stud.

The female endpoint must have one source `R` or `S` section, radius 6 LDU, depth
at least 4 LDU, one cap, no centered origin, no sliding, no dedicated group and no
non-antistud source identity. These are source-backed underside candidates. A
mesh collision test is still required for the specific whole-part arrangement;
one compatible interface does not mean arbitrary surrounding bodywork can fit.

Both inherited frames must have resolved physical dimensions. Unknown inherited
scaling is never silently applied to a cylinder. Source evidence must identify
the pinned Shadow revision, source URL, line, hash and license. Native hash-
verified licensed meshes are also required by the solver. Production callers
resolve endpoint IDs against the server's loaded source records; client-supplied
point objects or provenance assertions are not an authority to create geometry.

## Axes, rotation, translation and insertion

For these source records the male direction points along the protruding stud;
the female direction points into the receiving underside. They therefore align
in the **same direction** when connected. Gender is not a reason to reverse all
connection normals.

The solver constructs a proper right-handed frame from each source tangent and
snap direction, preserving arbitrary side-stud/SNOT axes. Mirrored LDraw subfiles
can have determinant −1; that reflection is not copied into a placement. The
returned part rotation always has determinant +1 and never changes the source
vertices.

The moving opening/base anchor is seated on the fixed anchor. Its position is
computed as `fixedAnchor − rotation × movingSourceAnchor`. For example, with a
3001 fixed at identity, its stud at `[30, 0, 10]` receives a 3024 underside at
`[0, 8, 0]` by placing that 3024 at translation `[30, −8, 10]`, identity rotation.
The source stud occupies the receiving section over 4 LDU. No extra guessed
clearance or arbitrary seating offset is added.

The candidate set is 0°, 90°, 180° and 270° about the actual mating axis. This is
the requested conservative grid-preserving search policy, not a claim that an
isolated round LEGO stud has only four physical rotational positions. Continuous
rotation and axial sliding are disabled. The reverse solver enumerates the same
relative rigid relation with the part roles exchanged.

`insertionPath` is the path of the **moving connection anchor**. A moving male
stud approaches along the source axis; a moving female receiver approaches
oppositely. This two-point path is a diagnostic/search candidate, not a claim
that the entire swept part body has been checked. Final solid collision and graph
checks are mandatory; swept insertion clearance remains a separate check.

The penetration zone is exactly the source stud's radius 6 LDU, depth 4 LDU and
resolved world axis, from the coincident base/opening plane toward the stud tip.
Its numerical contact tolerance is 0.0001 LDU. This tolerance handles arithmetic
comparisons; it does not resize a part, assert a manufacturing tolerance, or
permit solid plastic to cross inside the zone. Collision code must not ignore an
entire pair because their connector volumes overlap.

## Explicitly unresolved families

| Family | Current result | Specific missing proof |
| --- | --- | --- |
| Ordinary stud ↔ capped underside, including side studs/SNOT | Candidate solved; subsequent checks required | Whole-part collision, fixture and graph verification per interface |
| Bar ↔ clip | `compatibilityUnknown` | Clip deformation, engagement and insertion path |
| Axle ↔ axle hole | `compatibilityUnknown` | Keyed frame, scaled length and insertion depth |
| Pin ↔ pin hole | `compatibilityUnknown` | Multi-section shoulder/slide and insertion constraints; the current 3673 source also contains unparsed `L_` |
| Wheel ↔ holder/hub | `compatibilityUnknown` | Dedicated axle/hub seating and retention rule |
| Tyre ↔ wheel | `compatibilityUnknown` | Matching group alone does not establish a verified seating transform and deformable-body fit |
| Centered, sliding or multi-section sockets | `compatibilityUnknown` | Their anchor/depth/translation freedoms are outside the ordinary underside rule |
| Unsupported source scale or grammar | `compatibilityUnknown` | Physical source dimensions/frame are unresolved |

Unsupported interfaces remain disabled even on a part that has a separately
verified ordinary stud interface. An interface-level allowlist must be used by
the generator; a part-level success is not permission to use every point.
