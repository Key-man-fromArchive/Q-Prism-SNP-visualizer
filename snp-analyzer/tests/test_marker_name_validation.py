"""MarkerRegion.name hygiene: strict on input paths, lenient on restore."""
import pytest
from pydantic import ValidationError

from app.models import MarkerRegion

STRICT = {"strict_marker_name": True}


def _region(name):
    return {"id": "m1", "name": name, "wells": ["A1"], "ploidy": 2}


def test_strict_strips_surrounding_whitespace():
    assert MarkerRegion.model_validate(_region("  qSwet5.3 \t"), context=STRICT).name == "qSwet5.3"


@pytest.mark.parametrize("bad", ["", "   ", "a\x00b", "a\nb", "‮x", "a​b", "a b", "a b", "a\x7fb"])
def test_strict_rejects_blank_and_control_characters(bad):
    with pytest.raises(ValidationError):
        MarkerRegion.model_validate(_region(bad), context=STRICT)


@pytest.mark.parametrize("legacy", ["", "a\nb", " padded "])
def test_default_construction_keeps_legacy_names(legacy):
    # Session restore / import build MarkerRegion(**row) with no context; a
    # previously stored name must never make a session unloadable.
    assert MarkerRegion(**_region(legacy)).name == legacy
