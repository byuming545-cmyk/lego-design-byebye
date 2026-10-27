"""Compliance packaging checks, using synthetic restricted files in temp copies."""
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import shutil
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[1]

def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / 'scripts' / filename)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value

class DigitalPilotDistribution(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='digital-pilot-package-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.export = module('pilot_export_test', 'export-digital-pilot.py')
        self.export.ROOT = self.root
        self.export.BUNDLE = self.root / 'data/parts-foundation/pilots/speed-26'
        self.export.REPORTS = self.root / 'docs/digital-import'
        shutil.copytree(ROOT / 'data/parts-foundation/pilots/speed-26', self.export.BUNDLE)
        shutil.copytree(ROOT / 'docs/digital-import', self.export.REPORTS)
        self.target = self.root / 'distribution.zip'

    def report(self, mutate):
        file = self.export.REPORTS / 'pilot-results.json'
        value = json.loads(file.read_text()); mutate(value)
        file.write_text(json.dumps(value))

    def run_export(self):
        with patch.object(sys, 'argv', ['export-digital-pilot.py', '--output', str(self.target)]), contextlib.redirect_stdout(io.StringIO()):
            self.export.main()

    def test_only_fixed_source_allowlist_is_distributed(self):
        # These are original synthetic marker strings, never real external data.
        for relative in ['data/parts-foundation/mappings/restricted.json', 'data/parts-foundation/private/private.json',
                         'data/models/legacy.json', 'unknown-source.bin']:
            file = self.root / relative; file.parent.mkdir(parents=True, exist_ok=True); file.write_text('SYNTHETIC-EXCLUDED-MARKER')
        (self.export.BUNDLE / 'unreviewed-resource.bin').write_text('SYNTHETIC-EXCLUDED-MARKER')
        self.run_export()
        with zipfile.ZipFile(self.target) as archive:
            self.assertIn('DISTRIBUTION-MANIFEST.json', archive.namelist())
            self.assertTrue(any(name.endswith('/shadow/LICENSE.md') for name in archive.namelist()))
            self.assertFalse(any(b'SYNTHETIC-EXCLUDED-MARKER' in archive.read(name) for name in archive.namelist()))
            manifest = json.loads(archive.read('DISTRIBUTION-MANIFEST.json'))
            for record in manifest['files']:
                self.assertEqual(hashlib.sha256(archive.read(record['path'])).hexdigest(), record['sha256'])

    def test_complete_candidate_rows_cannot_enter_public_demand_metadata(self):
        self.report(lambda value: value['results'][0]['demandEvidence'][0].update({'elementId': 'synthetic-private-id'}))
        with self.assertRaisesRegex(ValueError, 'Unreviewed inventory mapping'):
            self.run_export()
        self.assertFalse(self.target.exists())

    def test_self_declared_new_manifest_is_not_upstream_authority(self):
        file = self.export.BUNDLE / 'ldraw/manifest.json'
        value = json.loads(file.read_text()); value['roots'][0]['name'] = 'Synthetic replacement'
        file.write_text(json.dumps(value))
        self.report(lambda value: value['sourceManifestHashes'].update(ldraw=hashlib.sha256(file.read_bytes()).hexdigest()))
        with self.assertRaisesRegex(ValueError, 'independently reviewed'):
            self.run_export()
        self.assertFalse(self.target.exists())

    def test_extra_notice_paths_cannot_smuggle_unreviewed_files(self):
        self.report(lambda value: value['attributionAndLicenceCopies'].append({'file': '../../private.json', 'sha256': '0' * 64}))
        with self.assertRaisesRegex(ValueError, 'fixed licence/attribution allowlist'):
            self.run_export()
        self.assertFalse(self.target.exists())

    def test_wrong_archive_bytes_are_rejected_before_source_preparation(self):
        prepare = module('pilot_prepare_test', 'prepare-digital-pilot.py')
        bad = self.root / 'untrusted.tar.gz'; bad.write_bytes(b'Synthetic nonarchive bytes')
        with self.assertRaisesRegex(ValueError, 'digest mismatch'):
            prepare.archive(bad, '0' * 64)

    def test_dependency_references_cannot_escape_the_approved_namespace(self):
        prepare = module('pilot_prepare_path_test', 'prepare-digital-pilot.py')
        for reference in ['../other.dat', '/private.dat', 'https://example.invalid/x.dat', 'parts//bad.dat']:
            with self.assertRaises(ValueError):
                prepare.canonical(reference)

if __name__ == '__main__':
    unittest.main()
