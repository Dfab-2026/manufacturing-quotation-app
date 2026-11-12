"""Regression tests: a second AI call must not run for a searchable no-weight PDF."""
import unittest
from app.extraction.vision import needs_focused_weight_check


class FastWeightVerificationTests(unittest.TestCase):
    def test_searchable_drawing_without_weight_skips_extra_ai_call(self):
        content = "PART DESCRIPTION: STAINLESS STEEL OUTLET PIPE. DIMENSIONS 100 X 50 MM. " * 4
        self.assertFalse(needs_focused_weight_check(content, None))

    def test_mass_label_requires_verification(self):
        content = "PART DESCRIPTION: STAINLESS STEEL OUTLET PIPE. DIMENSIONS 100 X 50 MM. " * 4
        self.assertTrue(needs_focused_weight_check(content + " Unit Weight: 2.4 kg", None))

    def test_scanned_pdf_still_requires_verification(self):
        self.assertTrue(needs_focused_weight_check("", None))

    def test_model_weight_without_evidence_requires_verification(self):
        content = "PART DESCRIPTION: STAINLESS STEEL OUTLET PIPE. DIMENSIONS 100 X 50 MM. " * 4
        self.assertTrue(needs_focused_weight_check(content, 2.4))


if __name__ == "__main__":
    unittest.main()
