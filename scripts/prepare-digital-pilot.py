#!/usr/bin/env python3
"""Prepare a separate, pinned pilot source closure from already obtained archives.

No network access, legacy catalog reads, production-source writes or qualification
promotion. Unknown licenses, missing dependencies and changed destinations fail.
"""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import tarfile

ROOT = Path(__file__).resolve().parents[1]
LDRAW_REV = 'c43ed06a128a10ed65675166bf42eb6fd608b9b0'
SHADOW_REV = '9b1131fb1991f8c0bfc072325e4e12f6271aba35'
LDRAW_SHA = 'cbdd578181a13ca0406211206da8bf3852cd6bb4f01b981ecbd8e40444368292'
SHADOW_SHA = 'a91dbdb5487a5796bdb76de64966e11e9c25ee1de56121000d7d943d3cfa1b3a'
IDS = ['3001', '3005', '3020', '3024', '3710', '3023b', '91988', '3068b', '3070b', '3069b',
       '99780', '99207', '15573', '87087', '11477', '15068', '18973', '18974', '18976',
       '4624', '3641', '3700', '3705', '2780', '32000', '32054']
LICENSES = {'Licensed under CC BY 4.0 : see CAreadme.txt',
            'Licensed under CC BY 2.0 and CC BY 4.0 : see CAreadme.txt'}

def sha(data):
    return hashlib.sha256(data).hexdigest()

def canonical(value):
    value = value.strip().replace('\\', '/').lower()
    if not value or value.startswith('/') or ':' in value or any(ord(c) < 32 for c in value):
        raise ValueError('Unsafe source reference')
    if any(p in ('', '..') for p in value.split('/')):
        raise ValueError('Unsafe source reference')
    value = '/'.join(p for p in value.split('/') if p != '.')
    if not value.endswith('.dat'):
        raise ValueError('Only .dat references are supported')
    return value

def archive(filename, expected):
    raw = Path(filename).read_bytes()
    if sha(raw) != expected:
        raise ValueError('Pinned archive digest mismatch: ' + str(filename))
    result = {}
    with tarfile.open(filename, 'r:gz') as tar:
        for member in tar.getmembers():
            if not member.isfile():
                continue
            name = member.name.split('/', 1)[-1]
            if PurePosixPath(name).is_absolute() or '..' in PurePosixPath(name).parts:
                raise ValueError('Unsafe archive member')
            key = name.lower()
            if key in result:
                raise ValueError('CONFLICT: duplicate archive member: ' + key)
            result[key] = tar.extractfile(member).read()
    return result

def closure(geometry, shadow):
    selected, selected_shadow = set(), set()
    def resolve(reference, current, files, shadow_only=False):
        ref = canonical(reference)
        parent = current.rsplit('/', 1)[0] + '/'
        candidates = [ref, parent + ref, 'parts/' + ref, 'p/' + ref] if shadow_only else [parent + ref, ref, 'parts/' + ref, 'p/' + ref]
        return next((p for p in candidates if p in files), None)
    def visit_shadow(name, stack):
        if name in stack:
            raise ValueError('Cyclic Shadow source')
        if name in selected_shadow:
            return
        selected_shadow.add(name)
        for ref in re.findall(r'!LDCAD\s+SNAP_INCL\b[^\r\n]*?\[ref=([^\]]+)\]', shadow[name].decode('utf8'), re.I):
            child = resolve(ref, name, shadow, True)
            if child is None:
                raise ValueError('Missing Shadow include: ' + ref)
            visit_shadow(child, stack + [name])
    def visit(name, stack):
        if name in stack or len(stack) >= 48:
            raise ValueError('Cyclic or excessive source dependencies')
        if name in selected:
            return
        if name not in geometry:
            raise ValueError('Missing native source: ' + name)
        selected.add(name)
        text = geometry[name].decode('utf8')
        license_line = re.search(r'^0\s+!LICENSE\s+(.+)$', text, re.M)
        if not license_line or license_line[1].strip() not in LICENSES:
            raise ValueError('Unreviewed source license: ' + name)
        for line in text.splitlines():
            tokens = line.split()
            if tokens and tokens[0] == '1':
                if len(tokens) < 15:
                    raise ValueError('Malformed native reference: ' + name)
                ref = ' '.join(tokens[14:])
                child = resolve(ref, name, geometry)
                if child is None:
                    raise ValueError('Missing native dependency: ' + ref)
                visit(child, stack + [name])
        if name in shadow:
            visit_shadow(name, [])
    for part_id in IDS:
        root = 'parts/' + part_id + '.dat'
        if root not in geometry:
            raise ValueError('Missing exact native root: ' + root)
        declared = re.search(r'^0\s+Name:\s*(.+)$', geometry[root].decode('utf8'), re.M)
        if not declared or declared[1].strip().lower() != part_id + '.dat':
            raise ValueError('CONFLICT: native Name header does not match the requested ID')
        visit(root, [])
    return selected, selected_shadow

def write_new(path, raw):
    if path.exists():
        if path.read_bytes() != raw:
            raise ValueError('Refusing to overwrite a different staged source: ' + str(path))
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(raw)

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ldraw-archive', required=True)
    parser.add_argument('--shadow-archive', required=True)
    parser.add_argument('--output', default=str(ROOT / 'data/parts-foundation/pilots/speed-26'))
    args = parser.parse_args()
    destination = Path(args.output).resolve()
    forbidden = [ROOT / 'data/parts-foundation/ldraw', ROOT / 'data/parts-foundation/shadow', ROOT / 'data/parts-foundation/assembly']
    if any(destination == p or destination in p.parents or p in destination.parents for p in forbidden):
        raise ValueError('Pilot cannot overwrite production sources or qualifications')
    geometry, shadow = archive(args.ldraw_archive, LDRAW_SHA), archive(args.shadow_archive, SHADOW_SHA)
    if b'Attribution-ShareAlike 4.0 International' not in shadow['license.md']:
        raise ValueError('Shadow license text missing or unreviewed')
    selected, selected_shadow = closure(geometry, shadow)
    def json_bytes(value):
        return (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode()
    geometry_root = f'https://raw.githubusercontent.com/pybricks/ldraw/{LDRAW_REV}/'
    shadow_root = f'https://raw.githubusercontent.com/RolandMelkert/LDCadShadowLibrary/{SHADOW_REV}/'
    files = []
    for name in sorted(selected):
        raw = geometry[name]; text = raw.decode('utf8')
        author = re.search(r'^0 Author:\s*(.+)$', text, re.M)
        files.append({'path': name, 'sha256': sha(raw), 'bytes': len(raw),
                      'license': re.search(r'^0\s+!LICENSE\s+(.+)$', text, re.M)[1].strip(),
                      'author': author[1].strip() if author else None, 'sourceUrl': geometry_root + name})
        write_new(destination / 'ldraw/files' / name, raw)
    roots = [{'partId': id, 'path': f'parts/{id}.dat', 'name': geometry[f'parts/{id}.dat'].decode('utf8').splitlines()[0][2:].strip(),
              'selectionBasis': 'Reviewed native-ID pilot: category coverage plus separately unverified instruction demand hints; no exact set membership claim.'} for id in IDS]
    write_new(destination / 'ldraw/manifest.json', json_bytes({'schemaVersion': 1, 'library': 'LDraw', 'revision': LDRAW_REV,
              'sourceRoot': geometry_root, 'archive': {'sourceUrl': f'https://codeload.github.com/pybricks/ldraw/tar.gz/{LDRAW_REV}', 'sha256': LDRAW_SHA}, 'roots': roots, 'files': files}))
    for name in ['CAreadme.txt', 'CAlicense.txt', 'CAlicense4.txt']:
        write_new(destination / 'ldraw' / name, geometry[name.lower()])
    shadow_files = []
    for name in sorted(selected_shadow):
        raw = shadow[name]
        shadow_files.append({'path': name, 'sha256': sha(raw), 'bytes': len(raw), 'license': 'CC-BY-SA-4.0', 'sourceUrl': shadow_root + name})
        write_new(destination / 'shadow/files' / name, raw)
    for name in ['LICENSE.md', 'README.md', 'CONTRIBUTING.md']:
        write_new(destination / 'shadow' / name, shadow[name.lower()])
    write_new(destination / 'shadow/manifest.json', json_bytes({'schemaVersion': 1, 'library': 'LDCadShadowLibrary', 'revision': SHADOW_REV,
              'sourceRoot': shadow_root, 'license': 'CC-BY-SA-4.0', 'attribution': 'Roland Melkert and LDCad Shadow Library contributors',
              'modified': False, 'archive': {'sourceUrl': f'https://codeload.github.com/RolandMelkert/LDCadShadowLibrary/tar.gz/{SHADOW_REV}', 'sha256': SHADOW_SHA},
              'files': shadow_files}))
    write_new(destination / '.gitattributes', b'ldraw/files/** -text\nshadow/files/** -text\nldraw/*.txt -text\nshadow/*.md -text\nldraw/manifest.json -text\nshadow/manifest.json -text\n')
    print(json.dumps({'roots': len(roots), 'geometrySourceFiles': len(files), 'shadowSourceFiles': len(shadow_files),
                      'destination': str(destination), 'productionQualificationWrites': 0}))

if __name__ == '__main__':
    main()
