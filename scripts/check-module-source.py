#!/usr/bin/env python3
"""Verify fixed licensed originals and exact selected sections. No installers or
native source writes. The explicit allowlist is independent of recipe metadata.
"""
import argparse
import hashlib
import json
import pathlib
import re
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--source-file', help='Legacy offline copy of the reviewed 76897 original')
parser.add_argument('--source-directory', help='Offline originals named <set>-1.mpd')
parser.add_argument('--output', default='artifacts/module-reuse/source-acquisition.json')
args = parser.parse_args()
root = pathlib.Path(__file__).resolve().parents[1]
prefix = 'https://raw.githubusercontent.com/vdirienzo/ldrawomr/99a10d3d5ec094277793eb5919f13163d279cf2e/corpus/mpds_licensed/'
pins = {
    prefix + '76897-1.mpd': '73e7d39acc7b9f00948f5e2ad7ba1cffaf08febcfd8eda60494a849eac7b0032',
    prefix + '75878-1.mpd': '86cbff6fcbfc1966d503155fc754e1ae97219f0ccf85cfa0a5c2b3982aa3e4b2',
}
library = json.loads((root / 'data/parts-foundation/modules/library.json').read_text())
sources, sections = [], []
for url in dict.fromkeys(recipe['source']['sourceUrl'] for recipe in library['modules']):
    if url not in pins:
        raise ValueError('Source URL is outside the independently reviewed fixed allowlist')
    expected, status = pins[url], None
    offline = pathlib.Path(args.source_directory) / url.rsplit('/', 1)[1] if args.source_directory else None
    if args.source_file and url.endswith('/76897-1.mpd'):
        offline = pathlib.Path(args.source_file)
    if offline:
        raw, method = offline.read_bytes(), 'explicit offline copy'
    else:
        result = subprocess.run(['curl', '--silent', '--show-error', '--max-time', '30', '--max-redirs', '0',
                                 '--max-filesize', '4000000', '--write-out', '\n%{http_code}', url], capture_output=True)
        raw, _, code = result.stdout.rpartition(b'\n')
        status = code.decode(errors='replace')
        if result.returncode or status != '200':
            raise RuntimeError(f'Reviewed source unavailable: HTTP {status}, curl {result.returncode}; no alternate source used')
        method = 'normal HTTPS via inherited network configuration'
    if hashlib.sha256(raw).hexdigest() != expected:
        raise ValueError('Original reviewed MPD SHA-256 differs')
    sources.append({'url': url, 'method': method, 'http': status, 'originalSha256': expected, 'bytes': len(raw)})
    blocks = {b.splitlines()[0].decode(): b'0 FILE ' + b for b in re.split(rb'(?m)^0 FILE ', raw) if b.strip()}
    for recipe in (r for r in library['modules'] if r['source']['sourceUrl'] == url):
        source = recipe['source']
        if source['originalSha256'] != expected:
            raise ValueError('Recipe original hash differs from independent source pin')
        block = blocks[source['section']]
        file = root / 'data/parts-foundation/modules' / source['file']
        if block != file.read_bytes() or hashlib.sha256(block).hexdigest() != source['sha256']:
            raise ValueError('Selected source section is not an exact extraction')
        if f"0 Author: {source['author']}".encode() not in block or b'0 !LICENSE Redistributable under CCAL version 2.0 : see CAreadme.txt' not in block:
            raise ValueError('Per-section authorship or explicit licence missing')
        sections.append({'moduleId': recipe['id'], 'section': source['section'], 'sha256': source['sha256'],
                         'author': source['author'], 'license': source['license']})
report = {'sources': sources, 'sections': sections,
          'scope': 'Licensed third-party set reconstructions, not LEGO-authored CAD; no rights inferred for other repository resources.'}
target = root / args.output
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'sourcesVerified': len(sources), 'recipesVerified': len(sections), 'http': [s['http'] for s in sources]}))
