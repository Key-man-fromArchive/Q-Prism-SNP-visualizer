import os
import tempfile
import unittest
import zipfile


class ZipHardeningTest(unittest.TestCase):
    def _zip_with_entries(self, entries):
        fd, path = tempfile.mkstemp(suffix=".zip")
        os.close(fd)
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
            for name, content in entries:
                zf.writestr(name, content)
        self.addCleanup(lambda: os.path.exists(path) and os.remove(path))
        return path

    def test_zip_member_path_traversal_is_rejected(self):
        from app.parsers.detector import _validate_zip_archive

        path = self._zip_with_entries([("../evil.xml", b"x")])
        with zipfile.ZipFile(path, "r") as zf:
            with self.assertRaises(ValueError) as ctx:
                _validate_zip_archive(zf)

        self.assertIn("unsafe path", str(ctx.exception))

    def test_xlsx_archive_path_traversal_is_rejected(self):
        from app.parsers.detector import detect_and_parse

        fd, path = tempfile.mkstemp(suffix=".xlsx")
        os.close(fd)
        with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("../evil.xml", b"x")
        self.addCleanup(lambda: os.path.exists(path) and os.remove(path))

        with self.assertRaises(ValueError) as ctx:
            detect_and_parse(path, original_filename="plate.xlsx")

        self.assertIn("unsafe path", str(ctx.exception))

    def test_zip_uncompressed_size_limit_is_enforced(self):
        from app.parsers import detector

        original_limit = detector.MAX_ZIP_UNCOMPRESSED_BYTES
        detector.MAX_ZIP_UNCOMPRESSED_BYTES = 5
        try:
            path = self._zip_with_entries([("safe.xml", b"123456")])
            with zipfile.ZipFile(path, "r") as zf:
                with self.assertRaises(ValueError) as ctx:
                    detector._validate_zip_archive(zf)
        finally:
            detector.MAX_ZIP_UNCOMPRESSED_BYTES = original_limit

        self.assertIn("uncompressed size", str(ctx.exception))
