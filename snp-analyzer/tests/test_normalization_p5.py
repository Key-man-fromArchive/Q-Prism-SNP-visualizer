from pathlib import Path

import pytest

from app.import_models import NormalizationMode
from app.models import UnifiedData, WellCycleData
from app.parsers.generic_table import GenericLongParser
from app.processing.normalize import normalize, normalize_for_cycle


FIXTURES = Path(__file__).parent / "fixtures" / "import"


def test_generic_wt_mt_fixture_without_normalization_stays_raw():
    parser = GenericLongParser()
    run = parser.parse(FIXTURES / "generic_long" / "wt_mt.csv", "wt_mt.csv")
    unified = parser.to_unified(run)

    assert unified.normalization_mode == NormalizationMode.NONE.value
    assert unified.normalization_channel is None

    point = normalize_for_cycle(unified, 1)[0]

    assert point.norm_fam == pytest.approx(120.0)
    assert point.norm_allele2 == pytest.approx(96.0)
    assert point.raw_rox is None


def test_generic_passive_reference_fixture_can_return_raw_or_normalized_points():
    parser = GenericLongParser()
    run = parser.parse(FIXTURES / "generic_long" / "wt_mt_rox_norm.csv", "wt_mt_rox_norm.csv")
    unified = parser.to_unified(run)

    assert unified.normalization_mode == NormalizationMode.PASSIVE_REFERENCE.value
    assert unified.normalization_channel == "ROX"

    normalized = normalize_for_cycle(unified, 1)[0]
    raw = normalize_for_cycle(unified, 1, use_rox=False)[0]

    assert normalized.norm_fam == pytest.approx(round(120.1 / 900.0, 6))
    assert normalized.norm_allele2 == pytest.approx(round(98.2 / 900.0, 6))
    assert normalized.raw_rox == pytest.approx(900.0)
    assert raw.norm_fam == pytest.approx(120.1)
    assert raw.norm_allele2 == pytest.approx(98.2)
    assert raw.raw_rox == pytest.approx(900.0)


def test_generic_passive_reference_uses_selected_non_rox_normalization_channel(tmp_path):
    fixture = tmp_path / "wt_mt_cy5_norm.csv"
    fixture.write_text(
        "\n".join(
            [
                "well,cycle,dye,role,rfu,sample,target,sample_type",
                "A1,1,FAM,WT,120.0,Sample_01,SNP1,unkn",
                "A1,1,VIC,MT1,60.0,Sample_01,SNP1,unkn",
                "A1,1,Cy5,normalization,30.0,Sample_01,SNP1,unkn",
                "A1,2,FAM,WT,150.0,Sample_01,SNP1,unkn",
                "A1,2,VIC,MT1,90.0,Sample_01,SNP1,unkn",
                "A1,2,Cy5,normalization,30.0,Sample_01,SNP1,unkn",
            ]
        )
    )
    parser = GenericLongParser()
    unified = parser.to_unified(parser.parse(fixture, fixture.name))

    assert unified.has_rox is True
    assert unified.normalization_channel == "Cy5"
    assert unified.normalization_dye == "Cy5"

    normalized = normalize(unified)

    assert normalized[0].norm_fam == pytest.approx(4.0)
    assert normalized[0].norm_allele2 == pytest.approx(2.0)
    assert normalized[0].raw_rox == pytest.approx(30.0)


def test_explicit_none_normalization_mode_keeps_raw_values_even_with_reference_data():
    unified = UnifiedData(
        instrument="Generic Long Table",
        allele2_dye="VIC",
        wells=["A1"],
        cycles=[1],
        data=[
            WellCycleData(
                well="A1",
                cycle=1,
                fam=120.0,
                allele2=60.0,
                rox=30.0,
                normalization_value=30.0,
            )
        ],
        has_rox=True,
        normalization_mode=NormalizationMode.NONE.value,
        normalization_channel="Cy5",
        normalization_dye="Cy5",
    )

    point = normalize(unified)[0]

    assert point.norm_fam == pytest.approx(120.0)
    assert point.norm_allele2 == pytest.approx(60.0)
    assert point.raw_rox == pytest.approx(30.0)


def test_legacy_list_signature_still_uses_rox_when_enabled():
    points = normalize(
        [WellCycleData(well="A1", cycle=1, fam=120.0, allele2=60.0, rox=30.0)],
        has_rox=True,
    )

    assert points[0].norm_fam == pytest.approx(4.0)
    assert points[0].norm_allele2 == pytest.approx(2.0)
