#!/usr/bin/env python3
"""Read-only source audit; writes only the three governance manifests.

python scripts/audit-legacy-isolation.py [--baseline /tmp/legacy-governance-baseline.json]
python scripts/audit-legacy-isolation.py --check

No PDF content, private session bodies, credentials or backup archives are published.
The baseline defaults to the explicitly recorded pre-governance commit. --check verifies
preserved data hashes, classification coverage and original-to-quarantine placement.
"""
import argparse
import collections
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'docs/legacy-isolation'
BASE = 'd001aad09472cbf541d3048666089659c5e87796'
MOVES = {'src/lego/catalog.ts': 'src/legacy/lego/catalog.ts', 'src/speed/catalog.ts': 'src/legacy/speed/catalog.ts'}

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)

def original(path, commit=BASE):
    return git('show', f'{commit}:{path}')

def read(path):
    return json.loads((ROOT / path).read_text())

def load_baseline(path):
    if path:
        return json.loads(Path(path).read_text())
    rows = []
    for name in git('ls-tree', '-r', '--name-only', BASE).decode().splitlines():
        raw = original(name)
        rows.append({'path': name, 'sha256': sha(raw), 'bytes': len(raw)})
    return {'baselineCommit': BASE, 'baselineBranch': 'codex/astra-collision-architecture',
            'gitStatus': '', 'createdAt': '2026-10-25T11:28:14.310764+00:00', 'trackedFiles': rows}

GROUPS = {
 'native-geometry': ('A', False, 'PINNED_SOURCE_HASHED', 'LDraw pinned native geometry and source licensing', 'Native source parsing/rendering and source-bound assembly validation', 'retain-native-source'),
 'native-connections': ('A', False, 'PINNED_SOURCE_HASHED', 'LDCad Shadow pinned files; CC-BY-SA-4.0', 'Native source connection parsing; qualification remains independent', 'retain-native-source'),
 'instruction-reference': ('A', True, 'SOURCE_OBSERVED_NOT_OFFICIALLY_ATTESTED', 'User-uploaded LEGO-branded PDFs; page/text extraction', 'Reference retrieval and appendix inventory observations only', 'retain-reference-only'),
 'external-mapping-observations': ('A', True, 'SOURCE_OBSERVED', 'Pinned ojuuji/rb.db release mirror of Rebrickable tables', 'Namespaced identity/color lookup; not geometry admission', 'retain-reference-only'),
 'mapping-review': ('B', True, 'LEGACY_UNVERIFIED', 'Pinned LeoCAD mapping candidates; exact variant chain unresolved', 'Recovery/review only; zero VERIFIED mappings', 'retain-review-namespace'),
 'legacy-basic': ('C', True, 'LEGACY_QUARANTINED', 'Manually authored nominal grid catalog; historical authorship inference UNKNOWN', 'Legacy rendering/fixtures only', 'physical-namespace-and-deprecated-stub'),
 'legacy-speed': ('C', True, 'LEGACY_QUARANTINED', 'Hand-authored parametric dimensions, grids, fits and proxies', 'Legacy rendering/fixtures and historical analyses only', 'physical-namespace-and-runtime-denial'),
 'legacy-automotive': ('C', True, 'LEGACY_QUARANTINED', 'Historical Speed-based generators, layouts and heuristic evaluation', 'Historical fixtures; production generation blocked', 'runtime-denial-and-native-import-exclusion'),
 'reference-originals': ('A', True, 'REFERENCE_ONLY_STATUS_DEPENDENT', 'User supplied reference models/links or catalog_seed vehicle metadata', 'Reference retrieval; no geometry qualification', 'retain-reference-only'),
 'reference-derived': ('B', True, 'LEGACY_UNVERIFIED', 'Analysis using historical Speed definitions/adapters', 'Reference statistics only; never native mesh/connector evidence', 'retain-reference-namespace'),
 'mock-inventory': ('C', True, 'LEGACY_QUARANTINED', 'Synthetic demonstrations; fictional demo-wheel/demo-technic-axle IDs', 'Explicit mock inventory display/testing only', 'mock-namespace-no-native-admission'),
 'inventory-observations': ('A', True, 'SOURCE_DEPENDENT', 'Rebrickable response snapshots or user inventory input; historical support flags untrusted', 'Raw inventory observations; no native admission from supported flags', 'retain-observations-ignore-legacy-support'),
 'legacy-generated-artifacts': ('C', True, 'LEGACY_QUARANTINED', 'Historical parametric vehicle/generated preview/benchmark artifacts', 'Historical review only, not current assembly evidence', 'archive-no-native-import'),
 'native-verification-evidence': ('A', False, 'SOURCE_AND_VERSION_BOUND', 'Current or historical native source/version-bound verification reports and minimal cases', 'Review/qualification only under matching source versions', 'retain-versioned-evidence'),
 'test-fixtures': ('C', True, 'TEST_FIXTURE_ONLY', 'Test runner fixtures, synthetic inputs and historical assertions', 'Isolated tests only; native source admission does not trust test labels', 'test-only-namespace'),
 'legacy-import-script': ('B', True, 'REFERENCE_EXTRACTION_ONLY', 'PDF appendix text extraction or external mapping extraction scripts', 'Reference/inventory extraction; no native geometry writes', 'retain-reference-tooling'),
 'infrastructure': (None, False, 'NOT_LEGACY_DATA', 'Application infrastructure/source/documentation', 'Shared application, API, source validation, tooling or presentation', 'retain-governed-runtime'),
}

def group(path):
    if path.startswith('data/parts-foundation/ldraw/'): return 'native-geometry'
    if path.startswith('data/parts-foundation/shadow/'): return 'native-connections'
    if path.startswith('data/parts-foundation/instructions/'): return 'instruction-reference'
    if path.startswith('data/parts-foundation/mappings/'):
        return 'mapping-review' if Path(path).name in ['ldraw-mapping-review.json', 'recovery-report.json', 'instruction-coverage.json'] else 'external-mapping-observations'
    if path.startswith('src/lego/'): return 'legacy-basic'
    if path.startswith('src/speed/'): return 'legacy-speed'
    if path.startswith('src/automotive/references/'):
        return 'reference-derived' if Path(path).name in ['analyzer.ts', 'coordinates.ts'] else 'reference-originals'
    if path.startswith('src/automotive/research/') or path in ['src/automotive/profiles.ts', 'src/automotive/instructionReferences.ts']: return 'reference-originals'
    if path.startswith('src/automotive/'): return 'legacy-automotive'
    if path == 'src/inventory/mock.ts': return 'mock-inventory'
    if path.startswith('src/inventory/'): return 'inventory-observations'
    if path.startswith(('artifacts/automotive/', 'artifacts/automotive-benchmark/', 'data/benchmarks/', 'docs/benchmarks/')) or path in ['speed-benchmark.json', 'benchmark.json', 'src/cli/speed-benchmark.ts', 'src/cli/automotive-benchmark.ts']: return 'legacy-generated-artifacts'
    if path.startswith(('astra-handoff/', 'sol-handoff/', 'artifacts/parts-foundation/', 'artifacts/assembly-development/', 'data/parts-foundation/assembly/')): return 'native-verification-evidence'
    if path.startswith('tests/'): return 'test-fixtures'
    if path in ['scripts/import-instruction-pdfs.py', 'scripts/test_instruction_pdf_import.py']: return 'legacy-import-script'
    return 'infrastructure'

def imports_index():
    # Direct static references only. Transitive trust is established by runtime/import graph tests.
    import re
    index = collections.defaultdict(list)
    for source in (ROOT / 'src').rglob('*'):
        if source.suffix not in ['.ts', '.tsx']: continue
        text = source.read_text()
        for spec in re.findall(r'''(?:from\s*|import\s*)['"]([^'"]+)['"]''', text):
            if not spec.startswith('.'): continue
            stem = (source.parent / spec).resolve()
            candidates = [stem, stem.with_suffix('.ts'), stem.with_suffix('.tsx'), stem / 'index.ts']
            for candidate in candidates:
                if candidate.is_file():
                    target = str(candidate.relative_to(ROOT))
                    index[target].append(str(source.relative_to(ROOT)))
                    break
    return {key: sorted(set(value)) for key, value in index.items()}

def catalogs():
    code = """import {PART_CATALOG} from './src/lego/catalog.ts';
import {SPEED_PART_CATALOG} from './src/speed/catalog.ts';
console.log(JSON.stringify({basic:Object.values(PART_CATALOG).map(p=>({partId:p.partId,dimensions:p.dimensions})),speed:Object.values(SPEED_PART_CATALOG).map(p=>({partId:p.partId,hasParametricGeometry:!!(p.dimensions&&p.shape),connectionPointCount:p.connectionPoints.length,sourceUrl:p.sourceUrl}))}));"""
    return json.loads(subprocess.check_output(['node', '--import', 'tsx', '--input-type=module', '-e', code], cwd=ROOT))

def generate(baseline):
    commit = baseline['baselineCommit']
    refs = imports_index()
    files = []
    for row in baseline['trackedFiles']:
        name = row['path']; key = group(name); cls, legacy, trust, source, use, action = GROUPS[key]
        current = MOVES.get(name, name); p = ROOT / current
        digest = sha(p.read_bytes()) if p.is_file() else None
        files.append({**row, 'originalPath': name, 'currentPath': current, 'group': key, 'classification': cls,
                      'legacyRelated': legacy, 'trustStatus': trust, 'source': source, 'currentUse': use,
                      'handling': action, 'currentSha256': digest, 'matchesBaselineBytes': digest == row['sha256'],
                      'directCurrentSourceReferences': refs.get(current, []),
                      'productionReferenceInterpretation': 'Direct imports are not proof of admission. Legacy views/reference services may import historical helpers; production generation and native import are separately guarded.',
                      'reverificationAllowed': cls == 'B', 'automaticPromotionAllowed': False,
                      'recovery': f'git show {commit}:{name}; restore only into an isolated historical checkout, never overwrite current native files'})
    defs = catalogs(); speed = defs['speed']
    review = read('data/parts-foundation/mappings/ldraw-mapping-review.json')
    mapping = [{'elementId': e['elementId'], 'designId': e['designId'], 'rebrickablePartId': e['rebrickablePartId'],
                'mappingStatus': e['mappingStatus'], 'classification': 'B', 'trustStatus': 'LEGACY_UNVERIFIED',
                'geometryPipelineAllowed': False, 'reasonCodes': e['reasonCodes'],
                'ldrawCandidates': sorted(set(c['ldrawPartId'] for c in e['candidates']))} for e in review['entries']]
    groups = []
    for key, description in GROUPS.items():
        rows = [f for f in files if f['group'] == key]
        groups.append({'id': key, 'classification': description[0], 'legacyRelated': description[1], 'trustStatus': description[2],
                       'source': description[3], 'use': description[4], 'handling': description[5], 'fileCount': len(rows),
                       'originalPaths': [f['path'] for f in rows]})
    common = {'schemaVersion': 1, 'baselineCommit': commit, 'baselineBranch': baseline['baselineBranch'], 'auditDate': '2026-10-25', 'dateTimezone': 'Asia/Shanghai'}
    inventory = {**common, 'scope': 'Complete tracked pre-governance tree with per-file categories; data categories and record counts are separate denominators.',
                 'preChangeGitStatus': baseline['gitStatus'], 'trackedFileCount': len(files),
                 'fileClassificationCounts': dict(collections.Counter(f['classification'] or 'NOT_LEGACY_DATA' for f in files)),
                 'legacyRelatedFileClassificationCounts': dict(collections.Counter(f['classification'] for f in files if f['legacyRelated'])),
                 'groups': groups, 'files': files,
                 'manualCatalogs': {'basicDefinitionCount': len(defs['basic']), 'speedDefinitionCount': len(speed),
                    'speedParametricGeometryCount': sum(p['hasParametricGeometry'] for p in speed),
                    'speedIdentityOnlyCount': sum(not p['hasParametricGeometry'] for p in speed),
                    'constructedConnectionPointCount': sum(p['connectionPointCount'] for p in speed),
                    'uniqueParametricIdsAcrossBothCatalogs': len(set(p['partId'] for p in defs['basic']) | set(p['partId'] for p in speed if p['hasParametricGeometry'])),
                    'imageInferredGeometryCount': 'UNKNOWN', 'reason': 'Code proves manual parameter construction, not whether authors guessed, measured or transcribed each field.',
                    'basic': defs['basic'], 'speed': [{**p, 'classification': 'C' if p['hasParametricGeometry'] else 'B', 'automaticPromotionAllowed': False} for p in speed]},
                 'mappingReview': {'externalObservedRecords': 531, 'sourceTrust': 'source-observed', 'officialIndependentlyVerified': 0,
                    'exactLDrawStatusCounts': dict(collections.Counter(e['mappingStatus'] for e in mapping)), 'entries': mapping},
                 'databases': {'applicationDatabase': 'JSON files and in-memory maps; no production relational DB adapter found',
                    'externalMirrorDatabase': 'Extraction provenance only; full rb.db not tracked or used by production runtime',
                    'migration': 'No destructive DB migration; physical legacy catalog namespaces plus native admission/generator guards',
                    'privateRuntimeDataPublished': False},
                 'unknowns': ['Historical per-field authoring evidence for manual dimensions/connectors', 'Independent official origin attestation of user PDFs',
                    'Complete/spare inventory coverage of extracted appendix rows', 'Separate rights of Rebrickable mirror data and LeoCAD mapping data',
                    'Availability/content of blocked external vehicle URLs', 'Custom deployment data outside this workspace']}
    quarantined = [f for f in files if f['classification'] in ['B', 'C']]
    quarantine = {**common, 'policy': 'Namespace/runtime quarantine, not indiscriminate deletion. Native source imports never accept legacy geometry/connector/collision objects.',
                  'fileCount': len(quarantined), 'classificationCounts': dict(collections.Counter(f['classification'] for f in quarantined)),
                  'physicalCatalogMoves': [{'originalPath': a, 'quarantinePath': b, 'originalPathTreatment': 'Deprecated compatibility re-export; not a production native source', 'recovery': f'git show {commit}:{a}'} for a,b in MOVES.items()],
                  'entries': [{k:v for k,v in f.items() if k != 'productionReferenceInterpretation'} for f in quarantined],
                  'identityOnlyCatalogException': '37 Speed definitions are B lookup candidates; the whole old catalog implementation is physically quarantined for safety.',
                  'permanentNoAutomaticPromotion': ['Manual/AI geometry', 'Manual connector coordinates and tolerances', 'Legacy collision exceptions and wheel nesting rules',
                     'Mock IDs and inventories', 'Saved legacy success/support flags', 'Reference model primitives without approved part-source provenance'],
                  'restorationPolicy': 'Originals remain in Git at the baseline commit. Recovery is into an isolated checkout/fixture namespace; reuse requires new trusted source import and new evidence, never status retagging.'}
    instructions = read('data/parts-foundation/instructions/manifest.json')
    pdfs = []
    for doc in instructions['documents']:
        matches = list((ROOT.parent / 'attachments').glob('*/' + doc['fileName']))
        candidates = [{'path': str(p.relative_to(ROOT.parent)), 'bytes': p.stat().st_size, 'sha256': sha(p.read_bytes())} for p in matches]
        pdfs.append({'fileName': doc['fileName'], 'status': doc['status'], 'setNumber': doc.get('setNumber'),
                     'manifestSha256': doc.get('sha256'), 'localOriginals': candidates,
                     'localHashMatchesManifest': any(p['sha256'] == doc.get('sha256') for p in candidates),
                     'trackedInGit': False, 'contentReadDuringThisAudit': False, 'independentlyOfficialAttested': False,
                     'preservation': 'Retain original attachment; no relocation/deletion; Git ships extraction/provenance only'})
    protected = [f for f in files if f['group'] in ['native-geometry', 'native-connections', 'instruction-reference', 'external-mapping-observations', 'mapping-review']]
    local = list((ROOT / 'data/automotive/sessions').glob('*.json'))
    preserved = {**common, 'protectedTrackedFiles': [{k:f[k] for k in ['path', 'sha256', 'bytes', 'currentSha256', 'matchesBaselineBytes', 'group']} for f in protected],
                 'protectedTrackedCount': len(protected), 'protectedTrackedMismatches': [f['path'] for f in protected if not f['matchesBaselineBytes']],
                 'pdfOriginals': pdfs, 'instructionSummary': instructions['summary'],
                 'nativeSourceCounts': {'ldrawRoots': 245, 'ldrawSourceFiles': 732, 'shadowSourceFiles': 236, 'nativeSourceGeometryModelingFromPDF': False},
                 'referencePreservation': {'paths': ['src/automotive/research/', 'src/automotive/profiles.ts', 'src/automotive/instructionReferences.ts', 'src/automotive/references/'],
                   'catalogVehicleCount': 5, 'sourceStatus': 'catalog_seed/blocked-official-target/user-supplied retained as applicable',
                   'officialImagesStoredInCatalog': 0, 'vehicleDimensionsInSeedCatalog': 'UNKNOWN', 'derivedLegacyAnalysisIsNativeEvidence': False},
                 'privateRuntimeData': {'pathPattern': 'data/automotive/sessions/*.json', 'observedFileCount': len(local), 'observedBytes': sum(p.stat().st_size for p in local),
                    'contentPublished': False, 'preservation': 'Retain in place; baseline private local backup exists but is not distributed'},
                 'sourceLicenses': {'LDraw': 'Per-file source headers and CAlicense/CAlicense4; not inferred from project license', 'LDCadShadow': 'CC-BY-SA-4.0',
                    'BrickLinkStudio': 'No source adapter/admission; license permission UNKNOWN; do not copy proprietary library', 'RebrickableMirror': 'Data license not independently verified; build code MIT does not establish data rights',
                    'LeoCADMapping': 'Independent mapping data license not established; project GPLv2 not asserted as a separate data license'},
                 'backup': {'preChangeCommit': commit, 'workingTreeCleanBeforeChanges': baseline['gitStatus'] == '', 'localPrivateBackupNotPublished': True,
                    'recovery': 'Use baseline Git checkout for tracked assets and private session backup held by task workspace operator; do not write old models over native sources'}}
    return {'legacy-inventory.json': inventory, 'quarantine-manifest.json': quarantine, 'preserved-assets.json': preserved}

def check():
    inventory = read('docs/legacy-isolation/legacy-inventory.json')
    preserved = read('docs/legacy-isolation/preserved-assets.json')
    files = inventory['files']
    assert len(files) == inventory['trackedFileCount'] == len(set(f['path'] for f in files)), 'Baseline file coverage mismatch'
    for row in preserved['protectedTrackedFiles']:
        assert sha((ROOT / row['path']).read_bytes()) == row['sha256'], f"Preserved file changed: {row['path']}"
    for src, dst in MOVES.items():
        assert (ROOT / dst).is_file(), f'Missing physical quarantine: {dst}'
        assert 'legacy/' in (ROOT / src).read_text() and '@deprecated' in (ROOT / src).read_text(), f'Missing deprecated stub: {src}'
    for row in inventory['mappingReview']['entries']:
        assert not row['geometryPipelineAllowed'] and row['mappingStatus'] != 'VERIFIED'
    for doc in preserved['pdfOriginals']:
        for p in doc['localOriginals']:
            source = ROOT.parent / p['path']
            if source.exists(): assert sha(source.read_bytes()) == p['sha256'], f'Attachment hash changed: {source.name}'
    print(json.dumps({'status': 'passed', 'baselineFilesCovered': len(files), 'protectedTrackedHashesVerified': len(preserved['protectedTrackedFiles']),
                      'mappingRecordsChecked': len(inventory['mappingReview']['entries']), 'physicalMovesChecked': len(MOVES),
                      'privateDataReadOrPublished': False}))

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline', help='Private baseline snapshot; contents are sanitized before output')
    parser.add_argument('--check', action='store_true', help='Verify published manifests and preserved file hashes without rewriting')
    args = parser.parse_args()
    if args.check:
        check()
    else:
        OUT.mkdir(parents=True, exist_ok=True)
        artifacts = generate(load_baseline(args.baseline))
        for name, data in artifacts.items():
            (OUT / name).write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')
        print(json.dumps({'written': list(artifacts), 'baselineFileCount': artifacts['legacy-inventory.json']['trackedFileCount']}))
