#!/usr/bin/env python3
"""Append reviewed exact native roots to production source manifests only.

Uses the same checksum-pinned archives as the isolated pilot. Original source
bytes, dependencies, author headers and licences remain untouched. This command
never writes a migration/qualification record or grants Generator permissions.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import os
import tempfile

ROOT = Path(__file__).resolve().parents[1]
NEW_ROOTS = ['32000', '3623', '60479', '78329', '3456', '69729', '6934', '41539']
NEW_SOURCE_ROOTS = ['3623', '60479', '78329', '3456', '69729', '6934', '41539']

def digest(raw):
    return hashlib.sha256(raw).hexdigest()

def helpers():
    spec = importlib.util.spec_from_file_location('pinned_pilot_preparer', ROOT / 'scripts/prepare-digital-pilot.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def checked_existing(directory, manifest):
    seen = set()
    for row in manifest['files']:
        if row['path'] in seen:
            raise ValueError('CONFLICT: duplicate existing source path')
        seen.add(row['path'])
        raw = (directory / 'files' / row['path']).read_bytes()
        if digest(raw) != row['sha256'] or len(raw) != row['bytes']:
            raise ValueError('Existing production source hash mismatch: ' + row['path'])

def retain_file(path, raw):
    if path.exists():
        if path.read_bytes() != raw:
            raise ValueError('Refusing to replace original source bytes: ' + str(path))
    else:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(raw)

def publish_manifest(path, manifest):
    """Readers see the previous complete manifest or the new complete manifest."""
    raw = (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode()
    if path.read_bytes() == raw:
        return
    fd, temporary = tempfile.mkstemp(prefix=path.name + '.expansion-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(raw)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ldraw-archive', required=True)
    parser.add_argument('--shadow-archive', required=True)
    args = parser.parse_args()
    module = helpers()
    geometry = module.archive(args.ldraw_archive, module.LDRAW_SHA)
    shadow = module.archive(args.shadow_archive, module.SHADOW_SHA)
    module.IDS = list(NEW_ROOTS)
    selected_geometry, selected_shadow = module.closure(geometry, shadow)
    ldraw_dir, shadow_dir = [ROOT / 'data/parts-foundation' / name for name in ['ldraw', 'shadow']]
    ldraw = json.loads((ldraw_dir / 'manifest.json').read_text())
    connections = json.loads((shadow_dir / 'manifest.json').read_text())
    if ldraw['revision'] != module.LDRAW_REV or connections['revision'] != module.SHADOW_REV:
        raise ValueError('Production source revision differs from reviewed archives')
    for directory, manifest in [(ldraw_dir, ldraw), (shadow_dir, connections)]:
        checked_existing(directory, manifest)
    # Applicable notice bytes already accompany the production source package.
    for name in ['CAlicense.txt', 'CAlicense4.txt', 'CAreadme.txt']:
        if (ldraw_dir / name).read_bytes() != geometry[name.lower()]:
            raise ValueError('Production LDraw notice differs from reviewed archive')
    if (shadow_dir / 'LICENSE.md').read_bytes() != shadow['license.md']:
        raise ValueError('Production Shadow licence differs from reviewed archive')
    roots = {row['partId']: row for row in ldraw['roots']}
    if len(roots) != len(ldraw['roots']):
        raise ValueError('CONFLICT: duplicate production native root')
    initial_roots, initial_geometry, initial_shadow = len(roots), len(ldraw['files']), len(connections['files'])
    import re
    for part_id in NEW_ROOTS:
        filename = f'parts/{part_id}.dat'
        title = geometry[filename].decode('utf8').splitlines()[0][2:].strip()
        row = {'partId': part_id, 'path': filename, 'name': title,
               'selectionBasis': 'Generation-expansion candidate: exact pinned native ID; source-derived geometry/interfaces require independent current qualification and actual generation coverage.'}
        if part_id in roots:
            if roots[part_id]['path'] != filename or roots[part_id]['name'] != title:
                raise ValueError('CONFLICT: existing root identity differs from original source')
        else:
            roots[part_id] = row
            ldraw['roots'].append(row)
    for library, selected, source, manifest, directory in [
        ('LDraw', selected_geometry, geometry, ldraw, ldraw_dir),
        ('LDCadShadowLibrary', selected_shadow, shadow, connections, shadow_dir),
    ]:
        by_path = {row['path']: row for row in manifest['files']}
        for name in sorted(selected):
            raw = source[name]
            if name in by_path:
                if by_path[name]['sha256'] != digest(raw):
                    raise ValueError('CONFLICT: same source path has different original bytes')
            else:
                row = {'path': name, 'sha256': digest(raw), 'bytes': len(raw),
                       'license': 'CC-BY-SA-4.0', 'sourceUrl': manifest['sourceRoot'] + name}
                if library == 'LDraw':
                    text = raw.decode('utf8')
                    row['license'] = re.search(r'^0\s+!LICENSE\s+(.+)$', text, re.M)[1].strip()
                    author = re.search(r'^0 Author:\s*(.+)$', text, re.M)
                    row['author'] = author[1].strip() if author else None
                    if not row['author']:
                        raise ValueError('Missing source attribution: ' + name)
                manifest['files'].append(row)
            retain_file(directory / 'files' / name, raw)
    for directory, manifest in [(ldraw_dir, ldraw), (shadow_dir, connections)]:
        publish_manifest(directory / 'manifest.json', manifest)
    print(json.dumps({'productionNativeRootsBefore': initial_roots, 'productionNativeRootsAfter': len(ldraw['roots']),
                      'addedRoots': [part for part in NEW_ROOTS if part not in {row['partId'] for row in ldraw['roots'][:initial_roots]}],
                      'geometrySourceFilesBefore': initial_geometry, 'geometrySourceFilesAfter': len(ldraw['files']),
                      'shadowSourceFilesBefore': initial_shadow, 'shadowSourceFilesAfter': len(connections['files']),
                      'qualificationWrites': 0, 'physicalBuildVerified': False}))

if __name__ == '__main__':
    main()
