from types import SimpleNamespace
from unittest.mock import patch

from app.models import UploadResponse
from app.services.import_session import create_session_from_import


def test_create_session_from_import_preserves_persistence_asg_and_response_contract():
    unified = SimpleNamespace(
        instrument="QuantStudio",
        allele2_dye="VIC",
        wells=["A1", "A2"],
        cycles=[1, 2, 3],
        has_rox=True,
        data_windows=None,
        well_groups={"NTC": ["A2"]},
    )
    session_store = {}

    with patch("app.services.import_session.uuid.uuid4") as uuid4:
        uuid4.return_value.hex = "abcdef1234567890"
        with patch("app.db.save_session") as save_session:
            with patch("app.asg_session.bind_session_to_current_asg_launch") as bind_asg:
                with patch("app.processing.ntc_detection.compute_suggested_cycle", return_value=2):
                    response = create_session_from_import(
                        unified=unified,
                        filename="plate.xls",
                        user_id="user-1",
                        session_store=session_store,
                    )

    assert isinstance(response, UploadResponse)
    assert response.session_id == "abcdef123456"
    assert response.instrument == "QuantStudio"
    assert response.num_wells == 2
    assert response.num_cycles == 3
    assert response.suggested_cycle == 2
    assert session_store == {"abcdef123456": unified}
    save_session.assert_called_once_with(
        "abcdef123456",
        unified,
        filename="plate.xls",
        user_id="user-1",
    )
    bind_asg.assert_called_once_with("abcdef123456", "user-1")
