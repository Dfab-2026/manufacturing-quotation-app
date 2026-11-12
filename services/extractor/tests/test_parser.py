import unittest
from app.parser import _match, _number, extract_fields


class ParserTests(unittest.TestCase):
    def test_weight(self):
        result = _number("NET WEIGHT: 12.4 KG", [r"WEIGHT\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*KG"])
        self.assertEqual(result.value, 12.4)
        self.assertEqual(result.source, "drawing")

    def test_drawing_number(self):
        result = _match("DRAWING NO: DF-2026-001", [r"DRAWING\s*NO\s*[:\-]?\s*([A-Z0-9\-]+)"])
        self.assertEqual(result.value, "DF-2026-001")

    def test_overall_dimensions_preserve_printed_order(self):
        result = extract_fields(b"OVERALL: 1000 x 500 x 6 MM", "text/plain")
        self.assertEqual(result.length_mm.value, 1000.0)
        self.assertEqual(result.width_mm.value, 500.0)
        self.assertEqual(result.thickness_mm.value, 6.0)


if __name__ == "__main__":
    unittest.main()
