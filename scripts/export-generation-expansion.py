#!/usr/bin/env python3
"""Distribute only checksum-verified licensed native sources and this run's models.

No whole-repository recursion: historical mappings, private records, PDFs,
Studio files, old model stores and the legacy generators are never packaged.
"""
import argparse
import csv
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import re
import zipfile

ROOT = Path(__file__).resolve().parents[1]
ARTIFACT = ROOT / 'artifacts/generation-expansion'

def sha(raw):
    return hashlib.sha256(raw).hexdigest()

def read(path):
    return json.loads(path.read_text())

def validate_evidence_consistency(directory, model, adopted):
    for field, name in [('steps', 'steps.json'), ('sources', 'sources.json')]:
        if read(directory / name) != model[field]:
            raise ValueError('Exported ' + name + ' differs from the actual generated model')
    for field in ['placements', 'edges', 'sourceHashes']:
        if adopted['model'][field] != model[field]:
            raise ValueError('Reimported ' + field + ' differs from the actual exported model')

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ldraw-archive', required=True)
    parser.add_argument('--shadow-archive', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    output = Path(args.output).resolve()
    if output.exists():
        raise ValueError('Refusing to overwrite an existing distribution')
    spec = importlib.util.spec_from_file_location('reviewed_source_preparer', ROOT / 'scripts/prepare-digital-pilot.py')
    helper = importlib.util.module_from_spec(spec); spec.loader.exec_module(helper)
    upstream = {'ldraw': helper.archive(args.ldraw_archive, helper.LDRAW_SHA),
                'shadow': helper.archive(args.shadow_archive, helper.SHADOW_SHA)}
    manifests = {library: read(ROOT / 'data/parts-foundation' / library / 'manifest.json')
                 for library in ['ldraw', 'shadow']}
    roots = manifests['ldraw']['roots']
    helper.IDS = [row['partId'] for row in roots]
    if len(set(helper.IDS)) != len(roots) or any(row['path'] != 'parts/' + row['partId'] + '.dat' for row in roots):
        raise ValueError('Conflicting native root identity')
    closure = dict(zip(['ldraw', 'shadow'], helper.closure(upstream['ldraw'], upstream['shadow'])))
    for library, manifest in manifests.items():
        names = [helper.canonical(row['path']) for row in manifest['files']]
        if len(names) != len(set(names)) or set(names) != closure[library]:
            raise ValueError('Source manifest is not the exact complete root dependency closure: ' + library)
    coverage = read(ARTIFACT / 'generation-coverage.json')
    migration = read(ROOT / 'data/parts-foundation/assembly/migration.json')
    if coverage['summary']['newlyQualifiedAndGenerated'] < 1:
        raise ValueError('No demonstrated new production generation coverage')
    for key, version in coverage['versions'].items():
        if migration.get(key) != version:
            raise ValueError('Source/qualification/verification versions do not match current coverage')
    entries = {row['partId']: row for row in migration['entries']}
    members = {}
    def add(file):
        file = file.resolve()
        if ROOT not in file.parents:
            raise ValueError('Distribution member outside repository')
        name = str(file.relative_to(ROOT))
        if any(token in name.lower() for token in ['/private/', '/mappings/', '.pdf', '/sessions/', '/legacy/', '/speed/']):
            raise ValueError('Excluded resource in distribution')
        members[name] = file.read_bytes()
    def relative(value):
        if Path(value).is_absolute() or '..' in Path(value).parts:
            raise ValueError('Unsafe generated artifact path')
        return ROOT / value
    notices = {'ldraw': ['CAlicense.txt', 'CAlicense4.txt', 'CAreadme.txt'],
               'shadow': ['LICENSE.md', 'README.md', 'CONTRIBUTING.md']}
    for library in ['ldraw', 'shadow']:
        directory = ROOT / 'data/parts-foundation' / library
        manifest = manifests[library]
        expected_revision = helper.LDRAW_REV if library == 'ldraw' else helper.SHADOW_REV
        if manifest['revision'] != expected_revision:
            raise ValueError('Unreviewed source revision')
        for source in manifest['files']:
            name = helper.canonical(source['path'])
            raw = (directory / 'files' / name).read_bytes()
            if raw != upstream[library].get(name) or sha(raw) != source['sha256'] or len(raw) != source['bytes']:
                raise ValueError('Source is not the unchanged pinned upstream file: ' + name)
            if library == 'ldraw':
                if source['license'] not in helper.LICENSES or not source.get('author'):
                    raise ValueError('Unreviewed geometry licence or missing author')
                original = raw.decode('utf8')
                author = re.search(r'^0 Author:\s*(.+)$', original, re.M)
                licence = re.search(r'^0\s+!LICENSE\s+(.+)$', original, re.M)
                if not author or not licence or source['author'] != author[1].strip() or source['license'] != licence[1].strip():
                    raise ValueError('Attribution/licence differs from original source declaration')
            elif source['license'] != 'CC-BY-SA-4.0':
                raise ValueError('Unreviewed connection licence')
            add(directory / 'files' / name)
        add(directory / 'manifest.json')
        for name in notices[library]:
            if (directory / name).read_bytes() != upstream[library][name.lower()]:
                raise ValueError('Original source notice changed: ' + name)
            add(directory / name)
    witnesses = [row['witness'] for row in coverage['candidates'] if row['actualGenerationCoverage']]
    witnesses += [row['witness'] for row in coverage['structures'] if row['status'] == 'generated']
    if not any('32000' in row['actualPartIds'] for row in witnesses):
        raise ValueError('No actual 32000 model in distribution')
    for witness in witnesses:
        directory = relative(witness['directory'])
        model_bytes = (directory / 'model.json').read_bytes()
        if sha(model_bytes) != witness['exportedJsonSha256']:
            raise ValueError('Generated model differs from its actual API export')
        model = json.loads(model_bytes)
        adopted = read(directory / 'reimported.json')
        if adopted['status'] != 'VALID' or adopted['model'] is None or witness['exportReimportStatus'] != 'VALID':
            raise ValueError('Model lacks current export/reimport evidence')
        validate_evidence_consistency(directory, model, adopted)
        for key in ['partLibraryVersion', 'assemblyEngineVersion', 'connectionRuleVersion', 'collisionVersion']:
            if model[key] != migration[key] or adopted['model'][key] != migration[key]:
                raise ValueError('Stale generated model version')
        placements = {node['instanceId']: node for node in model['placements']}
        quantities = {}
        for node in placements.values():
            id = node['partId']; entry = entries.get(id)
            if not entry or not entry['generatable'] or model['sourceHashes'].get(id) != entry['source']['digest']:
                raise ValueError('Model source/qualification does not match current native admission')
            quantities[id] = quantities.get(id, 0) + 1
        if {row['partId']: row['quantity'] for row in model['bom']} != quantities:
            raise ValueError('Generated BOM does not match actual instances')
        csv_rows = list(csv.DictReader(io.StringIO((directory / 'bom.csv').read_text())))
        if {row['partId']: int(row['quantity']) for row in csv_rows} != quantities:
            raise ValueError('Exported BOM CSV does not match actual instances')
        if len(model['steps']) != len(placements) or any(step['partId'] != placements[step['addedInstanceId']]['partId'] for step in model['steps']):
            raise ValueError('Steps omit/misidentify generated instances')
        for edge in model['edges']:
            for node_key, connection_key in [('fixedInstanceId', 'fixedConnectionId'), ('movingInstanceId', 'movingConnectionId')]:
                id = placements[edge[node_key]]['partId']
                if edge[connection_key] not in entries[id]['allowedConnectionIds']:
                    raise ValueError('Generated model uses a disabled source endpoint')
        for name in ['model.json', 'model.ldr', 'bom.csv', 'steps.json', 'sources.json', 'reimported.json', 'validation.json']:
            add(directory / name)
    for name in ['generation-coverage.json', 'negative-probes.json', 'interface-diff.json']:
        add(ARTIFACT / name)
    add(ROOT / 'data/parts-foundation/assembly/migration.json')
    add(ROOT / 'artifacts/assembly-development/interface-tests.json.gz')
    for name in ['README.md', 'SOURCES.md', 'baseline.json', 'candidates.json', 'validation-results.json']:
        add(ROOT / 'docs/generation-expansion' / name)
    add(ROOT / 'docs/wheel-assembly/REPORT.md')
    add(ROOT / 'artifacts/wheel-assembly/source-assessment.json')
    members['DISTRIBUTION-MANIFEST.json'] = (json.dumps({'schemaVersion': 1,
        'scope': 'Reviewed native sources, current source-bound qualification and this run\'s generated model evidence; not the entire application',
        'sourceArchives': {'ldraw': helper.LDRAW_SHA, 'shadow': helper.SHADOW_SHA},
        'licensing': {'geometry': 'Applicable per-file CC BY declarations and original author notices', 'connectionDerivedData': 'CC-BY-SA-4.0; preserve attribution and share-alike terms'},
        'excluded': ['Historical mapping datasets', 'Private records', 'PDFs', 'Studio resources', 'Legacy models and caches'],
        'files': [{'path': name, 'sha256': sha(raw), 'bytes': len(raw)} for name, raw in sorted(members.items())]}, ensure_ascii=False, indent=2) + '\n').encode()
    output.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(output, 'x', compression=zipfile.ZIP_DEFLATED) as archive:
        for name, raw in sorted(members.items()):
            archive.writestr(name, raw)
    print(json.dumps({'file': str(output), 'bytes': output.stat().st_size, 'sha256': sha(output.read_bytes()),
                      'members': len(members), 'models': len(witnesses), 'historicalMappingFiles': 0, 'studioFiles': 0, 'pdfFiles': 0}))

if __name__ == '__main__':
    main()
