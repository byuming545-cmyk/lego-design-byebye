#!/usr/bin/env python3
"""Export only reviewed pilot source bytes, licences and sanitized audit reports.

The whole application repository is NOT asserted to be a cleared data package.
Historical mappings, private inventories, PDFs, legacy models and caches are
outside this allowlist and are never scanned into the distributable ZIP.
"""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]
BUNDLE = ROOT / 'data/parts-foundation/pilots/speed-26'
REPORTS = ROOT / 'docs/digital-import'
APPROVED_MANIFESTS = {
    'ldraw': '656ba37bfcd8c7a948787aba3a49398a95bcd49658a28d11e0e1f85d2c62bd87',
    'shadow': '8f26baf015751c6864e47f36c10fb194fd73965fc4889b5db758dad003ce8521',
}
NOTICES = {'ldraw/CAlicense.txt', 'ldraw/CAlicense4.txt', 'ldraw/CAreadme.txt',
           'shadow/LICENSE.md', 'shadow/README.md', 'shadow/CONTRIBUTING.md'}

def sha(data):
    return hashlib.sha256(data).hexdigest()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, help='Explicit destination ZIP; existing files are not overwritten')
    args = parser.parse_args()
    destination = Path(args.output).resolve()
    if destination.exists():
        raise ValueError('Refusing to overwrite an existing distribution')
    report = json.loads((REPORTS / 'pilot-results.json').read_text())
    if report['counts']['stagingLibraryAllowed'] != 26 or report['demandSummary']['fullHistoricalCandidateRowsPublished'] is not False:
        raise ValueError('Pilot is not approved for sanitized source distribution')
    for result in report['results']:
        for evidence in result['demandEvidence']:
            if set(evidence) - {'category', 'structuralPurpose', 'categoryCoverageRequest', 'historicalHintCount', 'conflictingHintCount', 'historicalMappingSourceSha256', 'exactSetMembershipProven', 'referenceOnly', 'fullDemandPlan'}:
                raise ValueError('Unreviewed inventory mapping fields in public demand metadata')
            if evidence['exactSetMembershipProven'] is not False or evidence['referenceOnly'] is not True:
                raise ValueError('Inventory hints cannot be exported as exact membership')
    members = {}
    def add(source, target=None, expected=None):
        raw = source.read_bytes()
        if expected and sha(raw) != expected:
            raise ValueError('Distribution source integrity mismatch: ' + str(source))
        members[target or str(source.relative_to(ROOT))] = raw
    for library in ['ldraw', 'shadow']:
        manifest_file = BUNDLE / library / 'manifest.json'
        if report['sourceManifestHashes'][library] != APPROVED_MANIFESTS[library]:
            raise ValueError('Source manifest has not been independently reviewed')
        add(manifest_file, expected=report['sourceManifestHashes'][library])
        manifest = json.loads(manifest_file.read_text())
        for item in manifest['files']:
            name = item['path']
            if '..' in name.split('/') or name.startswith('/') or not name.startswith(('parts/', 'p/')):
                raise ValueError('Unsafe source path')
            add(BUNDLE / library / 'files' / name, expected=item['sha256'])
    if {item['file'] for item in report['attributionAndLicenceCopies']} != NOTICES or len(report['attributionAndLicenceCopies']) != len(NOTICES):
        raise ValueError('The complete fixed licence/attribution allowlist is required')
    for notice in report['attributionAndLicenceCopies']:
        add(BUNDLE / notice['file'], expected=notice['sha256'])
    add(BUNDLE / '.gitattributes')
    for name in ['README.md', 'SOURCES.md', 'pilot-results.json', 'assembly-verification.json', 'source-access.json', 'acquisition-log.json', 'validation-results.json']:
        add(REPORTS / name)
    forbidden = ['mappings/', '/private/', 'inventories.json', '.pdf', '/legacy/', '/sessions/']
    if any(any(token in name.lower() for token in forbidden) for name in members):
        raise ValueError('Excluded data in distribution allowlist')
    members['DISTRIBUTION-MANIFEST.json'] = (json.dumps({'schemaVersion': 1, 'scope': 'Approved digital source pilot data only; not the entire application',
        'geometryLicence': 'Per-file CC BY declaration; original notices included', 'connectionDataLicence': 'CC-BY-SA-4.0; original attribution included',
        'excluded': ['All historical mapping datasets', 'All private demand plans', 'Original PDFs', 'Studio resources', 'Legacy generated models and caches'],
        'files': [{'path': name, 'sha256': sha(raw), 'bytes': len(raw)} for name, raw in sorted(members.items())]}, ensure_ascii=False, indent=2) + '\n').encode()
    destination.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(destination, 'x', compression=zipfile.ZIP_DEFLATED) as archive:
        for name, raw in sorted(members.items()):
            archive.writestr(name, raw)
    print(json.dumps({'path': str(destination), 'files': len(members), 'bytes': destination.stat().st_size,
                      'sha256': sha(destination.read_bytes()), 'historicalMappingFiles': 0, 'studioFiles': 0, 'pdfFiles': 0}))

if __name__ == '__main__':
    main()
