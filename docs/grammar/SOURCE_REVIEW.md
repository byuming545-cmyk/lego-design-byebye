# Connector source ingestion: reviewed scope and limitations

This adapter reuses the existing immutable native source repository and does not
modify any `.dat` file, manifest, geometry parser or Shadow parser. The reviewed
input is the existing 253-root source library: fixed LDraw revision
`c43ed06a128a10ed65675166bf42eb6fd608b9b0` and LDCad Shadow revision
`9b1131fb1991f8c0bfc072325e4e12f6271aba35`. Source loading still checks original
manifest hashes and licences before constructing the native part.

## APIs

- `adaptImportedConnection(point)` converts an already imported endpoint into the
  canonical `Connector` schema; it neither performs collision checking nor grants
  a part-level assembly permission.
- `supportsStandardStudEndpoint(point)` recognises the existing conservative C01
  source premise. It checks the pinned source, original raw directive/sections,
  named standard male stud identity or ordinary capped receiver pattern, resolved
  frame, dimensions, cap/centre/slide/group restrictions. It contains no part ID
  or part-name compatibility list.
- `adaptNativePartConnectors(part)` retains every imported source point as one
  feature, returns coverage, unknown interfaces, source counts and `rawEvidence`.
  Original source IDs, affine inheritance matrices, properties, lines, raw text,
  hashes, references and licences survive the conversion.
- `mergeConnectorSources(base, additions, options)` retains independent features,
  including coincident ones. A conflicting assertion is quarantined, diagnosed
  and retained in a conflict ledger. An explicitly trusted, reviewed manual or
  real-build override may resolve a conflict; claiming a high source priority or
  setting `verification=VERIFIED` is insufficient without the trusted override
  source-ID allowlist. This option is not connected to HTTP inputs or environment
  variables.
- `adaptStudioConnectivity(records, grant, mappings)` accepts *already decoded*,
  legally reusable structured metadata. It is not a reverse-engineered `.conn`
  binary parser, and does not copy an installed Studio resource library. An
  unconfirmed resource licence/grant produces no production features. Raw numeric
  type IDs are retained; without a reviewed mapping they remain UNKNOWN. Even a
  reviewed type mapping does not fabricate a mating-fit policy.

## LDraw and Shadow responsibilities

Native LDraw type-1 transforms, primitive/subpart recursion, mirroring and grid
locations are already handled by the existing source pipeline. The canonical
adapter consumes those exact results. Geometry alone is not a source of guessed
connector radii, bar identities or wheel fits. No additional primitive-inferred
connector is emitted; the provenance count for direct `LDRAW_PRIMITIVE` features
is therefore zero, while geometry dependency counts are reported separately.

The existing Shadow importer recursively supports `SNAP_CYL`, `SNAP_CLP`,
`SNAP_GEN`, `SNAP_INCL` and `SNAP_CLEAR`, its implemented source grids, and
source-scoped clear semantics. This task preserves those algorithms and their
existing version/evidence. `SNAP_FGR`, unsupported 3-D grids, section profiles,
include overrides and unresolved inherited scale remain explicit diagnostics;
they are not treated as silently parsed. `SNAP_FGR` creates a literal
`HINGE_FINGER` family hint in `unknownInterfaces` and retains all raw properties
and inherited matrices. It does not create an invented pose, finger sequence
interpretation, angle range or mechanical joint.

The upstream contributor guide explicitly specifies the negative-Y resting snap
axis and identifies `studC`, `studO`, `aStud`, the axle and pin source IDs:
`data/parts-foundation/shadow/CONTRIBUTING.md`, Rotation and IDs sections. We use
these source identities rather than guessing from part numbers or display names.
Anonymous round cylinders retain a generic/unknown identity. An R4 radius is not
enough to declare BAR; an R6 hole is not enough to declare a Technic pin hole.
Explicit cross profile A retains keyed AXLE/AXLE_HOLE semantics. A raw `rim*`
group remains GENERIC_SPECIAL; it does not prove RIM_SEAT/TYRE_SEAT fit.

## Colocated features and hollow studs

The adapter never deduplicates by position. Two explicit features at the same
location retain separate IDs and source evidence. Conversely, recognising
`studO` never fabricates a centre-hole feature. The original upstream
`p/stud2a.dat` comment specifically says the part must separately add the optional
hole because it can extend beyond the stud or be part of another cylinder. Its
absence therefore stays absent. The source declarations, not visual appearance,
determine whether a colocated bar receptacle exists.

## Unknown values stay unknown

Raw source-local sections remain raw. Unresolved inherited scaling is not applied
to make physical dimensions appear known. `caps=one` does not identify a physical
cap end for every connection, so `capStart` and `capEnd` remain null; `caps=none`
can explicitly establish their absence. Friction is UNKNOWN unless new reviewed
data actually establishes it. Rotation limits, detents, retention, stopper
positions and manufacturing tolerances are not inferred from a source ID.

C01's fully seated 4-LDU insertion and zero mechanical DOF come from the existing
conservative interface policy, recorded as implementation context alongside the
original source directives. Its policy evidence IDs refer only to actual hashed
Shadow source records; a documentation reference with no data hash is not forged
into source authority. `SOURCE_BACKED` is never converted to `REAL_BUILD_VERIFIED`.

Grammar ingestion coverage is intentionally distinct from the old syntax parse
counts. `COMPLETE` means every emitted feature is covered by the currently
interpreted C01 source contract and there are no remaining parse issues.
`PARTIAL` preserves recognised-but-unproven families or unparsed interfaces.
`NONE` means no emitted supported source endpoint. These do not assert collision
freedom, whole-model legality, mechanical stability or physical build success.

## Rights and access

LDraw retains each original CC BY declaration, author and dependency licence.
Shadow and derived connection records retain CC BY-SA 4.0. This module does not
expand the licence of the entire application, historical inventory/mapping data,
PDF instructions or Studio resources. The current repository contains no approved
Studio connectivity dataset; its coverage is zero. No BrickLink, Studio, or
Rebrickable data was fetched, no access restriction was bypassed, and no new
network failure is asserted by this review. No external community type-ID table
has been silently installed as a standard.

Synthetic records in `tests/parts-grammar-sources.test.ts` exercise parser,
conflict, permission and colocation behaviour only. They are not source-library
parts or evidence of any real LEGO fit, and are not used in the real 253-root
coverage audit.
