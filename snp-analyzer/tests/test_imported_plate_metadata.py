import xml.etree.ElementTree as ET
from unittest.mock import patch

from app.models import UnifiedData, WellCycleData
from app.parsers.eds_raw import _parse_plate_metadata
from app.parsers.pcrd_raw import _parse_dye_layers
from app.services.import_session import _build_imported_marker_regions, create_session_from_import


def test_pcrd_reads_explicit_samples_targets_and_well_types() -> None:
    plate_setup = ET.fromstring(
        """
        <plateSetup2 rows="8" columns="12">
          <dyeLayersList>
            <dyeLayer plateName="FAM">
              <fluor channelPosition="0" />
              <wellSamples>
                <wellSample plateIndex="0" wellSampleType="wcSample" sampleId="S-01" geneName="M1" />
                <wellSample plateIndex="1" wellSampleType="wcNTC" sampleId="NTC-1" geneName="M1" />
                <wellSample plateIndex="2" wellSampleType="wcPositiveControl" sampleId="PC-1" geneName="M2" />
              </wellSamples>
            </dyeLayer>
            <dyeLayer plateName="HEX">
              <fluor channelPosition="1" />
              <wellSamples>
                <wellSample plateIndex="0" wellSampleType="wcSample" sampleId="S-01" geneName="M1" />
                <wellSample plateIndex="1" wellSampleType="wcNTC" sampleId="NTC-1" geneName="M1" />
                <wellSample plateIndex="2" wellSampleType="wcPositiveControl" sampleId="PC-1" geneName="M2" />
              </wellSamples>
            </dyeLayer>
          </dyeLayersList>
          <wellGroups><wellGroup name="Group 1" /></wellGroups>
        </plateSetup2>
        """
    )

    parsed = _parse_dye_layers(plate_setup)

    assert parsed[3] == {0: "S-01", 1: "NTC-1", 2: "PC-1"}
    assert parsed[4] == {"A2"}
    assert parsed[6] == {0: "M1", 1: "M1", 2: "M2"}
    assert parsed[7] == {0: "Unknown", 1: "NTC", 2: "Positive Control"}


def test_pcrd_does_not_trust_conflicting_target_names_across_dyes() -> None:
    plate_setup = ET.fromstring(
        """
        <plateSetup2>
          <dyeLayer plateName="FAM"><fluor channelPosition="0" />
            <wellSample plateIndex="0" wellSampleType="wcSample" geneName="M1" />
          </dyeLayer>
          <dyeLayer plateName="VIC"><fluor channelPosition="1" />
            <wellSample plateIndex="0" wellSampleType="wcSample" geneName="M2" />
          </dyeLayer>
        </plateSetup2>
        """
    )

    assert _parse_dye_layers(plate_setup)[6] == {}


def test_eds_reads_single_marker_sample_names_and_genotyping_tasks() -> None:
    xml_data = b"""
    <PlateSetup>
      <FeatureMap>
        <Feature><Id>sample</Id></Feature>
        <FeatureValue><Index>0</Index><Sample><Name>Leaf-01</Name></Sample></FeatureValue>
        <FeatureValue><Index>1</Index><Sample><Name>Water</Name></Sample></FeatureValue>
      </FeatureMap>
      <FeatureMap>
        <Feature><Id>marker-task</Id></Feature>
        <FeatureValue><Index>0</Index><MarkerTask><Marker><Name>SNP-A</Name></Marker><Task>UNKNOWN</Task></MarkerTask></FeatureValue>
        <FeatureValue><Index>1</Index><MarkerTask><Marker><Name>SNP-A</Name></Marker><Task>NTC</Task></MarkerTask></FeatureValue>
        <FeatureValue><Index>2</Index><MarkerTask><Marker><Name>SNP-A</Name></Marker><Task>POSITIVE_1_1</Task></MarkerTask></FeatureValue>
      </FeatureMap>
    </PlateSetup>
    """

    samples, markers, well_types = _parse_plate_metadata(xml_data)

    assert samples == {0: "Leaf-01", 1: "Water"}
    assert markers == {"SNP-A": [0, 1, 2]}
    assert well_types == {0: "Unknown", 1: "NTC", 2: "Allele 1 Control"}


def test_imported_assays_become_colored_editable_marker_regions() -> None:
    unified = UnifiedData(
        instrument="test",
        allele2_dye="HEX",
        wells=["A1", "A2", "A3"],
        cycles=[1],
        data=[
            WellCycleData(well=well, cycle=1, fam=1.0, allele2=2.0)
            for well in ["A1", "A2", "A3"]
        ],
        imported_markers={"M1": ["A1", "A2"], "M2": ["A3"]},
        ploidy=6,
    )

    regions = _build_imported_marker_regions(unified)

    assert [(region["name"], region["wells"]) for region in regions] == [
        ("M1", ["A1", "A2"]),
        ("M2", ["A3"]),
    ]
    assert all(region["ploidy"] == 6 for region in regions)
    assert regions[0]["color"] != regions[1]["color"]


def test_import_session_persists_and_exposes_imported_markers_immediately() -> None:
    unified = UnifiedData(
        instrument="test",
        allele2_dye="VIC",
        wells=["A1", "A2"],
        cycles=[1],
        data=[
            WellCycleData(well=well, cycle=1, fam=1.0, allele2=2.0)
            for well in ["A1", "A2"]
        ],
        imported_markers={"SNP-A": ["A1", "A2"]},
    )
    session_store: dict[str, UnifiedData] = {}

    with (
        patch("app.services.import_session.uuid.uuid4") as uuid4,
        patch("app.services.import_session.db.save_session"),
        patch("app.services.import_session.db.save_marker_regions") as save_markers,
        patch("app.services.import_session.asg_session.bind_session_to_current_asg_launch"),
        patch("app.services.import_session.ntc_detection.compute_suggested_cycle", return_value=1),
    ):
        uuid4.return_value.hex = "1234567890abcdef"
        response = create_session_from_import(
            unified=unified,
            filename="plate.eds",
            user_id="user-1",
            session_store=session_store,
        )

    from app.routers.clustering import marker_store

    assert response.session_id == "1234567890ab"
    save_markers.assert_called_once()
    assert [marker.name for marker in marker_store[response.session_id]] == ["SNP-A"]


def test_manual_well_type_overrides_imported_ntc_per_well() -> None:
    from app.routers.clustering import ntc_wells_for, welltype_store

    unified = UnifiedData(
        instrument="test",
        allele2_dye="VIC",
        wells=["A1", "A2"],
        cycles=[1],
        data=[],
        imported_well_types={"A1": "NTC", "A2": "Unknown"},
        ntc_wells=["A1"],
    )
    welltype_store["metadata-test"] = {"A1": "Unknown", "A2": "NTC"}
    try:
        assert ntc_wells_for("metadata-test", unified) == {"A2"}
    finally:
        welltype_store.pop("metadata-test", None)
