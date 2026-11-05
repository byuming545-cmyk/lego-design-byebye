#!/usr/bin/env python3
"""Recheck the reviewed licensed model and exact section extraction. No installs.
The full upstream model is temporary; only independently licensed sections live
in the module library. This command never writes native geometry or recipes.
"""
import argparse
import hashlib
import json
import pathlib
import re
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--source-file', help='Optional local copy of the exact reviewed original MPD')
parser.add_argument('--output', default='artifacts/module-reuse/source-acquisition.json')
args = parser.parse_args()
root = pathlib.Path(__file__).resolve().parents[1]
url = 'https://raw.githubusercontent.com/vdirienzo/ldrawomr/99a10d3d5ec094277793eb5919f13163d279cf2e/corpus/mpds_licensed/76897-1.mpd'
expected = '73e7d39acc7b9f00948f5e2ad7ba1cffaf08febcfd8eda60494a849eac7b0032'
status = None
if args.source_file:
    raw = pathlib.Path(args.source_file).read_bytes()
    method = 'explicit local copy'
else:
    result = subprocess.run(['curl', '--silent', '--show-error', '--max-time', '30', '--max-redirs', '0',
                             '--max-filesize', '4000000', '--write-out', '\n%{http_code}', url], capture_output=True)
    raw, _, code = result.stdout.rpartition(b'\n')
    status = code.decode(errors='replace')
    if result.returncode or status != '200':
        raise RuntimeError(f'Reviewed source unavailable: HTTP {status}, curl {result.returncode}; no alternate URL or guessed data used')
    method = 'normal HTTPS via inherited network configuration'
actual = hashlib.sha256(raw).hexdigest()
if actual != expected:
    raise ValueError('Original reviewed MPD SHA-256 differs')
library = json.loads((root / 'data/parts-foundation/modules/library.json').read_text())
sections = []
for recipe in library['modules']:
    name = recipe['source']['section']
    block = b'0 FILE ' + next(b for b in re.split(rb'(?m)^0 FILE ', raw) if b.strip() and b.splitlines()[0].decode() == name)
    file = root / 'data/parts-foundation/modules' / recipe['source']['file']
    if block != file.read_bytes() or hashlib.sha256(block).hexdigest() != recipe['source']['sha256']:
        raise ValueError('Selected source section is not an exact extraction')
    sections.append({'moduleId': recipe['id'], 'section': name, 'sha256': recipe['source']['sha256'],
                     'author': recipe['source']['author'], 'license': recipe['source']['license']})
report = {'url': url, 'method': method, 'http': status, 'originalSha256': actual, 'bytes': len(raw), 'sections': sections,
          'scope': 'Licensed third-party set reconstruction, not LEGO-authored CAD; no permission inferred for the rest of the repository.'}
target = root / args.output
target.parent.mkdir(parents=True, exist_ok=True)
target.write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'originalSha256': actual, 'sectionsVerified': len(sections), 'http': status}))
