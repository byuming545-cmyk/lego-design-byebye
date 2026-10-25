# Pinned native LDraw geometry snapshot

The files in `files/` are unchanged source bytes from the Pybricks mirror of the
LDraw.org library at commit `c43ed06a128a10ed65675166bf42eb6fd608b9b0`.
`manifest.json` records the archive URL and SHA-256, every root's original title,
and each recursively required file's URL, SHA-256, size, author and license line.
All 743 source files and the three accompanying license/readme documents are
retained. The upstream author and history headers are part of those source files.

The original 245 roots consist of the previous 101 catalog IDs plus real native files
selected by explicit upstream windscreen, mudguard, bracket, curved-slope and
wedge titles. Each root records its selection basis. This is a geometry bootstrap,
not an inventory frequency ranking, a verified PDF element-to-design mapping,
or an assertion that a part occurs in any particular Speed Champions set. Three
additional source-backed clip/bar exemplars are included for connector tests.

The production source set now contains 253 roots. Eight reviewed native roots
were appended from the same checksum-pinned archive: 32000, 3623, 60479, 78329,
3456, 69729, 6934 and 41539. No original source bytes were changed. Source import,
per-interface qualification and demonstrated production generation are separate;
see docs/generation-expansion/README.md for current evidence and limits.

Licensing is specified per native source file: CC BY 4.0, or the upstream dual
CC BY 2.0 / CC BY 4.0 declaration. See `CAreadme.txt`, `CAlicense.txt` and
`CAlicense4.txt`. No source file was geometrically edited. This directory's
`.gitattributes` preserves the original CRLF bytes so the hashes remain valid
after Windows checkouts.

The importer preserves native coordinates (LDU, LDraw x/y/z). It recursively
composes type 1 affine transforms, triangulates type 3/4 faces, records type 2/5
edges, and respects BFC winding, mirrored transforms, INVERTNEXT and NOCLIP.
Missing/cyclic/unsafe references, unsupported textured geometry, malformed
coordinates and resource-limit failures produce no substitute mesh. The bundled
resolver reads only manifest files and checks their source hashes.

`geometryReady` only means that this native source closure imported successfully.
The collision result is a conservative whole-part AABB derived from the imported
geometry. Its `cavitiesResolved: false` explicitly means it cannot validate stud,
clip, axle or tyre insertion. The importer does not grant `generatable` or
`verified` status and does not establish manufacturing tolerances or physical fit.
