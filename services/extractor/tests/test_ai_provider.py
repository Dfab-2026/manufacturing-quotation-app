import json
import unittest
from unittest.mock import patch

from app.ai_provider import _gemini_text, _json_object, ai_extract, merge_extractions
from app.models import Evidence, Extraction


class AiProviderTests(unittest.TestCase):
    def test_json_object_strips_fence(self):
        self.assertEqual(_json_object('```json\n{"a": 1}\n```'), {"a": 1})

    def test_gemini_text_reads_candidate_parts(self):
        payload = {"candidates": [{"content": {"parts": [{"text": "{\"a\":1}"}]}}]}
        self.assertEqual(_gemini_text(payload), '{"a":1}')

    def test_merge_prefers_missing_ai_value(self):
        local = Extraction(material=Evidence(value=None, confidence=0))
        ai = Extraction(material=Evidence(value="SS304", confidence=0.95, source="drawing"))
        merged = merge_extractions(local, ai)
        self.assertEqual(merged.material.value, "SS304")

    def test_none_provider_skips_external_ai(self):
        class Config:
            ai_provider = "none"
        with patch("app.ai_provider.settings", return_value=Config()):
            self.assertIsNone(ai_extract(b"x", "application/pdf", "a.pdf"))


if __name__ == "__main__":
    unittest.main()


def test_ai_process_route_is_normalized():
    from app.ai_provider import _to_extraction
    result = _to_extraction({
        "manufacturing_processes": [
            {"sequence": 9, "operation": "Laser cutting", "work_center": "Fiber laser", "reason": "Plate profile and cutouts", "confidence": 0.92},
            {"sequence": 10, "operation": "Deburring", "work_center": "Finishing", "reason": "Cut edges", "confidence": 0.8},
        ]
    })
    assert [row.sequence for row in result.manufacturing_processes] == [1, 2]
    assert result.manufacturing_processes[0].operation == "Laser cutting"
    assert result.manufacturing_processes[0].confidence == 0.92
