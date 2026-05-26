from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from app.models import UploadPreviewRequiredResponse, UploadResponse


class FakeUploadFile:
    def __init__(self, chunks, filename="plate.csv", content_type="text/csv"):
        self._chunks = list(chunks)
        self.filename = filename
        self.content_type = content_type

    async def read(self, _size=-1):
        if not self._chunks:
            return b""
        return self._chunks.pop(0)


@pytest.mark.asyncio
async def test_upload_returns_preview_required_for_generic_csv_without_parsing():
    from app.routers import upload

    with patch.object(upload, "detect_and_parse") as detect_and_parse:
        response = await upload.upload_file(
            SimpleNamespace(user_id="u1"),
            FakeUploadFile([b"well,cycle,dye,rfu\nA1,1,FAM,10"], filename="plate.csv"),
        )

    assert isinstance(response, UploadPreviewRequiredResponse)
    assert response.status == "preview_required"
    assert response.filename == "plate.csv"
    assert response.reason_code == "mapping_required"
    detect_and_parse.assert_not_called()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("filename", "content_type"),
    [
        ("plate.tsv", "text/tab-separated-values"),
        ("plate.txt", "text/plain"),
        ("plate.rdml", "application/zip"),
        ("plate.rdm", "application/zip"),
    ],
)
async def test_upload_preview_required_accepts_planned_import_extensions(filename, content_type):
    from app.routers import upload

    response = await upload.upload_file(
        SimpleNamespace(user_id="u1"),
        FakeUploadFile([b"content"], filename=filename, content_type=content_type),
    )

    assert isinstance(response, UploadPreviewRequiredResponse)
    assert response.status == "preview_required"


@pytest.mark.asyncio
async def test_upload_still_rejects_unsupported_file_types():
    from app.routers import upload

    with pytest.raises(HTTPException) as ctx:
        await upload.upload_file(SimpleNamespace(user_id="u1"), FakeUploadFile([b"x"], filename="plate.png"))

    assert ctx.value.status_code == 400


@pytest.mark.asyncio
async def test_upload_vendor_success_remains_upload_response_contract():
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
        with patch.object(upload, "create_session_from_import") as create_session:
            create_session.return_value = UploadResponse(
                session_id="sid",
                instrument="QuantStudio",
                allele2_dye="VIC",
                num_wells=1,
                num_cycles=2,
                has_rox=True,
            )
            response = await upload.upload_file(
                SimpleNamespace(user_id="u1"),
                FakeUploadFile([b"content"], filename="plate.xls", content_type="application/vnd.ms-excel"),
            )

    assert isinstance(response, UploadResponse)
    assert response.session_id == "sid"
    create_session.assert_called_once()
