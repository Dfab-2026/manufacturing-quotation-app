import hashlib
import hmac
import time
import unittest
from unittest.mock import patch

from app.security import verify_service_signature


class SecurityTests(unittest.TestCase):
    def test_file_signature_is_accepted(self):
        class Config:
            extractor_hmac_secret = "test-secret"

        data = b"drawing-bytes"
        filename = "part.pdf"
        mime = "application/pdf"
        timestamp = str(int(time.time()))
        digest = hashlib.sha256(data).hexdigest()
        canonical = f"{timestamp}.{digest}.{filename}.{mime}".encode()
        signature = hmac.new(b"test-secret", canonical, hashlib.sha256).hexdigest()

        with patch("app.security.settings", return_value=Config()):
            verify_service_signature(
                data=data,
                file_name=filename,
                mime_type=mime,
                signature=signature,
                timestamp=timestamp,
            )


if __name__ == "__main__":
    unittest.main()
