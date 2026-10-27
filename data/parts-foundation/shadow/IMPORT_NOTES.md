# Pinned LDCad Shadow input and parser scope

These are **unchanged source files**, selected from Roland Melkert and the LDCad
Shadow Library contributors' repository at revision
`9b1131fb1991f8c0bfc072325e4e12f6271aba35`:

<https://github.com/RolandMelkert/LDCadShadowLibrary/tree/9b1131fb1991f8c0bfc072325e4e12f6271aba35>

Source files and derived connection records are **CC BY-SA 4.0**. The complete
license, upstream README, and contributor documentation accompany this selection.
See `LICENSE.md`. This is a community snapping-assistance library; neither these
records nor their availability constitute LEGO endorsement or physical testing.

Selection is reproducible: start with every `files[].path` in the bundled LDraw
manifest, keep same-path files that exist in this Shadow revision, and recursively
include any referenced `SNAP_INCL` Shadow files. Resolve references using their
literal canonical path, the containing directory, `parts/`, and `p/` (in that
order). Copy bytes unchanged. `manifest.json` records each SHA-256, byte count,
license, and immutable source URL. The loader checks bytes against this manifest.
This bootstrap selection is **not an official-instructions frequency ranking** and
does not map any LEGO element number to a LDraw design ID.

The importer traverses native LDraw type-1 references, then appends the same-path
Shadow information, as upstream's README specifies. It understands `SNAP_CYL`,
`SNAP_CLP`, `SNAP_GEN`, `SNAP_INCL`, and `SNAP_CLEAR`, including nested affine
transforms and ordinary centered X/Z grids. Include directives import the
referenced Shadow information, not a second copy of its native geometry. The
contributor guide specifies that the resting snap direction is negative Y; this
is transformed into each instance's frame. No studs, sockets, axles, clip radii,
or other connection dimensions are generated from images or mesh appearance.

Every returned point carries the original directive, file and one-based line,
source SHA-256 and revision, inherited transforms, source-local dimensions, and
transformed native LDraw position/direction. Unnamed cylinder sections stay
`cylinder`, rather than receiving an invented connector identity. Profile `A` and
explicit source IDs provide only display labels; they do not add compatibility
rules. Generic `rim*` source groups retain their original matching group and
bounding declaration. No whole wheel assembly is inferred from them.

`ready` means the source syntax used by that part is within the implemented
subset. **Every result and point has `physicalVerified: false`.** Non-rigid
inherited scaling leaves dimensions in their source-local frame, records an
`unsupported-scaling` issue, and produces `partial`, rather than silently changing
diameters, lengths, or interfaces. Three-dimensional grids, finger-joint
`SNAP_FGR` directives, include overrides outside the supported subset, unknown
options, missing files, malformed directives, cycles, and resource limits also
prevent a ready result. Unsupported directives emit no fabricated replacement.

This library revision is newer than the bundled LDraw revision. The importer
preserves both revisions separately. A successful parse is therefore not proof
that the two sources describe an identical current mould. Actual compatibility,
collision, insertion, rotation, and stability tests remain required before a part
can become generatable or verified.
