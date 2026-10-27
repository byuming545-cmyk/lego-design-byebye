# Collision Architecture Review — before implementation

## Root cause and observed evidence

The pinned MULTI-3020-3710 replay is blocked by surface-partition-limit after 1,648 triangle tests and before any surface-cell occupancy check. Both proxies are closed oriented chains: 700+196 and 364+98 source triangles/internal caps. The source transform is a 180-degree rotation and translation (0,-8,10). This is a resource failure, not a demonstrated plastic intersection.

The current implementation already uses native mesh/BVH and signed winding; it does not fill the AABB as plastic. Cavities are represented by the oriented native shell. Internal caps require complete coverage by existing coplanar source faces. Open/branched or unproven shells stay blocked. The partitioner extends every edge of each intersecting coplanar triangle into an infinite cutting plane across the whole target triangle. Disjoint local footprints therefore cause unrelated cuts to intersect, consuming the 256-cell budget. This is a generic over-partitioning mechanism, including repeated stud bases and internal coplanar caps. The implementation experiment must confirm whether removing these irrelevant cuts resolves this case.

## Alternatives

1. Compound boxes/cylinders/subtractive cavities: cheap after source-proven decomposition, but the current importer does not retain certified solid primitive semantics. Inferring those from names would compromise source authenticity. Defer.
2. Voxel/signed occupancy: useful conservative broad-phase certificates if every cell has proven inside/outside bounds. Low-resolution sampled occupancy cannot safely certify thin walls or small collisions; no sampled-voxel clearance is introduced.
3. Mesh/BVH with spatially local planar arrangements: retain current closed native solids and occupancy checks; restrict coplanar subdivision to actual finite triangle footprints. This addresses the observed representation blow-up without requiring new cavity assumptions.

## Selected change and safety contract

Keep AABB broad phase, cached source-closed proxies and bounded BVH narrow phase. Preserve the existing successful partition path; when its per-triangle budget is exceeded, use finite-footprint subdivision for coplanar cutters, with noncoplanar cuts retained. Each footprint splits a convex cell into disjoint outside fragments and its clipped inside; subsequent footprints operate on this complete partition. No cell or plastic volume is exempted. Keep all existing limits and numerical tolerances.

SOLID is positive native winding; VOID/exterior is zero winding; boundary/ambiguous topology remains unresolved. CONNECTION_ALLOWED is a source-bound seating envelope annotation, never authority to erase SOLID. All coincident mates still share the existing rigid transform and graph validation; the collision test checks the whole pair independently of the selected stud. Consequently a union of connection envelopes cannot excuse plastic intersection. The API can remain unchanged.

## Other cases, risk, performance, rollback

Candidates are all surface-partition-limit cases, not a list of part IDs. Branched/open-shell cases are a different class and will remain blocked. Main risks are finite clipping degeneracies, accidental cell loss, and resource costs; require area conservation, negative collision tests, rigid-transform invariance, old PASS revalidation, and full case classification. Cache keys include the new collision version. The fallback adds work only to previously unresolved partitions; it must not increase tolerance or budgets. If insufficient evidence or regression arises, retain blocked results. Rollback restores the previous collision implementation AND its source-bound migration artifacts; old qualifications must never be retagged under a new version.

## Bounded prototype finding and revised implementation decision

Finite coplanar footprints alone did not certify the first source face under the partition and area-conservation guards; local bounding supports for transverse cuts also did not certify it. Those prototypes did not separately instrument which guard stopped them. Neither experiment grants clearance. Instead use adaptive spatial subdivision of the exact original triangle, re-querying the opponent BVH for actual intersecting triangles in each subtriangle. This retains the original plane partition and winding proof on smaller local domains. Subdivision does not alter the surface or fill a cavity. The 256-cell limit applies per local leaf; the existing 120,000-cell global and 5-second limits remain unchanged, with an additional depth limit. This changes the partition architecture, not physical acceptance thresholds. Discard the unsuccessful footprint prototypes from production code.


## Confirmed outcome

The spatial fallback certifies the first pair with 3,542 face tests and 1,789 checked surface patches, versus the original 1,648 face tests and zero checked patches before its partition limit. All 13 archived surface-partition cases now replay clear. The adaptive path initially exposed accumulated discarded sliver area (about 1.48e-7 square LDU on a 1,600-square-LDU face); retaining all positive-area cells removes that loss rather than increasing the acceptance tolerance. Full 4,632-interface rerun retains all 1,248 old PASS decisions and admits 517 additional interfaces. This evidence confirms a spatial over-partitioning problem for this class, not missing cavities in these already closed proxies.
