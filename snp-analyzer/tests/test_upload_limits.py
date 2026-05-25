import os
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from fastapi import HTTPException


class FakeUploadFile:
    def __init__(self, chunks, filename="plate.xls", content_type="application/octet-stream"):
        self._chunks = list(chunks)
        self.filename = filename
        self.content_type = content_type

    async def read(self, _size=-1):
        if not self._chunks:
            return b""
        return self._chunks.pop(0)


class UploadLimitTest(unittest.IsolatedAsyncioTestCase):
    async def test_unsupported_extension_is_rejected_before_read(self):
        from app.routers import upload

        with self.assertRaises(HTTPException) as ctx:
            await upload.upload_file(SimpleNamespace(user_id="u1"), FakeUploadFile([b"x"], filename="plate.txt"))

        self.assertEqual(ctx.exception.status_code, 400)

    async def test_unsupported_content_type_is_rejected(self):
        from app.routers import upload

        with self.assertRaises(HTTPException) as ctx:
            await upload.upload_file(
                SimpleNamespace(user_id="u1"),
                FakeUploadFile([b"x"], filename="plate.xls", content_type="text/html"),
            )

        self.assertEqual(ctx.exception.status_code, 400)

    async def test_write_upload_to_temp_rejects_oversized_payload(self):
        from app.routers import upload

        original_limit = upload.MAX_UPLOAD_SIZE_BYTES
        upload.MAX_UPLOAD_SIZE_BYTES = 5
        try:
            with self.assertRaises(HTTPException) as ctx:
                await upload._write_upload_to_temp(FakeUploadFile([b"123", b"456"]), ".xls")
        finally:
            upload.MAX_UPLOAD_SIZE_BYTES = original_limit

        self.assertEqual(ctx.exception.status_code, 413)

    async def test_write_upload_to_temp_removes_tempfile_on_size_error(self):
        from app.routers import upload

        original_limit = upload.MAX_UPLOAD_SIZE_BYTES
        upload.MAX_UPLOAD_SIZE_BYTES = 5
        before = set(os.listdir("/tmp"))
        try:
            with self.assertRaises(HTTPException):
                await upload._write_upload_to_temp(FakeUploadFile([b"123456"]), ".xls")
        finally:
            upload.MAX_UPLOAD_SIZE_BYTES = original_limit
        after = set(os.listdir("/tmp"))

        self.assertEqual(before, after)

    async def test_upload_file_removes_tempfile_on_parser_failure(self):
        from app.routers import upload

        fd, path = tempfile.mkstemp(suffix=".xls")
        os.close(fd)
        os.remove(path)

        def fake_mkstemp(suffix):
            return os.open(path, os.O_CREAT | os.O_RDWR), path

        with patch.object(upload.tempfile, "mkstemp", side_effect=fake_mkstemp):
            with patch.object(upload, "detect_and_parse", side_effect=ValueError("bad file")):
                with self.assertRaises(HTTPException) as ctx:
                    await upload.upload_file(SimpleNamespace(user_id="u1"), FakeUploadFile([b"not xls"]))

        self.assertEqual(ctx.exception.status_code, 400)
        self.assertFalse(os.path.exists(path))

    async def test_upload_file_accepts_valid_parser_result(self):
        from app.routers import upload

        unified = SimpleNamespace(
            instrument="QuantStudio",
            allele2_dye="VIC",
            wells=["A1"],
            cycles=[1, 2],
            has_rox=True,
            data_windows=None,
            well_groups=None,
        )

        with patch.object(upload, "detect_and_parse", return_value=unified):
            with patch("app.db.save_session") as save_session:
                with patch("app.processing.ntc_detection.compute_suggested_cycle", return_value=2):
                    response = await upload.upload_file(
                        SimpleNamespace(user_id="u1"),
                        FakeUploadFile([b"content"], filename="plate.xls", content_type="application/vnd.ms-excel"),
                    )

        self.assertEqual(response.instrument, "QuantStudio")
        self.assertEqual(response.num_wells, 1)
        save_session.assert_called_once()
