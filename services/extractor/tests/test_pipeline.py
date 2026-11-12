import unittest
from unittest.mock import patch

from app.models import Evidence, Extraction
from app.pipeline import analyze_bytes


class PipelineTests(unittest.TestCase):
    def test_visual_pipeline_merges_ai_without_ocr_first(self):
        class Config:
            ai_provider = "gemini"

        local = Extraction(material=Evidence(value=None, confidence=0), raw_text="TITLE BLOCK")
        ai = Extraction(material=Evidence(value="SS304", confidence=0.95, source="drawing"))

        with patch("app.pipeline.settings", return_value=Config()), \
             patch("app.pipeline.extract_fields", return_value=local) as local_extract, \
             patch("app.pipeline.ai_extract", return_value=ai):
            result = analyze_bytes(b"pdf", "application/pdf", "part.pdf")

        self.assertEqual(result.material.value, "SS304")
        self.assertFalse(local_extract.call_args.kwargs["ocr_fallback"])


if __name__ == "__main__":
    unittest.main()
