"""Layout safety tests for the optional local PDF importer (synthetic pages)."""

import importlib.util
from pathlib import Path
import unittest

import fitz


SPEC = importlib.util.spec_from_file_location("instruction_pdf_import", Path(__file__).with_name("import-instruction-pdfs.py"))
assert SPEC and SPEC.loader
IMPORTER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(IMPORTER)


class PdfEvidenceLayoutTests(unittest.TestCase):
    def make_page(self, entries):
        pdf = fitz.open()
        page = pdf.new_page(width=250, height=150)
        for x, y, text in entries:
            page.insert_text((x, y), text, fontsize=8)
        self.addCleanup(pdf.close)
        return page

    def test_same_baseline_different_columns_do_not_swap_element_ids(self):
        page = self.make_page([(20, 20, "2x"), (20, 32, "302326"), (130, 20, "3x"), (130, 32, "300101")])
        rows, unresolved = IMPORTER.match_inventory_words(page)
        self.assertEqual({(r["elementId"], r["quantity"]) for r in rows}, {("302326", 2), ("300101", 3)})
        self.assertEqual(unresolved, [])

    def test_caption_in_neighboring_column_is_not_used_as_missing_identifier(self):
        page = self.make_page([(20, 20, "2x"), (130, 32, "302326")])
        rows, unresolved = IMPORTER.match_inventory_words(page)
        self.assertEqual(rows, [])
        self.assertEqual(len(unresolved), 1)

    def test_overprinted_same_label_yields_one_documentary_entry(self):
        page = self.make_page([(20, 20, "2x"), (20, 32, "302326"), (20, 32, "302326")])
        rows, unresolved = IMPORTER.match_inventory_words(page)
        self.assertEqual([(r["elementId"], r["quantity"]) for r in rows], [("302326", 2)])
        self.assertEqual(unresolved, [])

    def test_two_conflicting_labels_remain_unresolved(self):
        page = self.make_page([(20, 20, "2x"), (20, 32, "302326"), (20, 44, "300101")])
        rows, unresolved = IMPORTER.match_inventory_words(page)
        self.assertEqual(rows, [])
        self.assertEqual(unresolved[0]["reason"], "no-unique-vertically-adjacent-element-id")

    def test_same_value_at_different_positions_is_not_deduplicated(self):
        page = self.make_page([(20, 20, "2x"), (20, 32, "302326"), (130, 20, "3x"), (130, 32, "302326")])
        rows, unresolved = IMPORTER.match_inventory_words(page)
        self.assertEqual(len(rows), 2)
        self.assertEqual(sorted(r["quantity"] for r in rows), [2, 3])
        self.assertEqual(unresolved, [])


if __name__ == "__main__":
    unittest.main()
