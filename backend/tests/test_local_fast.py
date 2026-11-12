"""Offline tests: no Supabase credentials or Gemini quota needed."""
import io
import unittest

import pymupdf
from PIL import Image

from app.extraction.local_fast import extract_local_text


class LocalFastTests(unittest.TestCase):
    def test_pdf_text_extraction(self):
        pdf = pymupdf.open()
        page = pdf.new_page()
        page.insert_text((35, 45), "DRAWING NO ABC-123 SS 304 WEIGHT 2.5 KG")
        content = pdf.tobytes()
        pdf.close()
        text, warnings = extract_local_text(content, "sample.pdf")
        self.assertIn("ABC-123", text)
        self.assertIn("2.5 KG", text)
        self.assertEqual(warnings, [])

    def test_bad_pdf_fails_explicitly(self):
        with self.assertRaises(ValueError):
            extract_local_text(b"not a real pdf", "drawing.pdf")

    def test_upload_size_limit(self):
        with self.assertRaises(ValueError):
            extract_local_text(b"x" * (25 * 1024 * 1024 + 1), "drawing.pdf")

    def test_blank_image_requires_review(self):
        image = Image.new("RGB", (240, 80), "white")
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        text, warnings = extract_local_text(buffer.getvalue(), "blank.png")
        self.assertIsInstance(text, str)
        self.assertTrue(warnings)


if __name__ == "__main__":
    unittest.main()
