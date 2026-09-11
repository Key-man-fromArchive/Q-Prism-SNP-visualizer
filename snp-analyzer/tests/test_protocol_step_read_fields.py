"""P2-R1-T1: ProtocolStep carries plate_read / temp_increment instead of dropping
them after the parsers already compute them, plus read_channels stays empty
where the source format has no per-step channel data.

Covers:
  - pcrd_raw._parse_protocol(): plate_read + signed temp_increment (touchdown)
  - eds_raw._parse_protocol(): CollectionFlag -> plate_read, ExtTemperature -> temp_increment
  - ProtocolStep(**old_json) backward compatibility (no new keys in stored data)
  - ASG payload serialization (app/asg_result.py:91 model_dump()) includes the
    new fields without raising.
"""

import xml.etree.ElementTree as ET

import pytest

from app.models import ProtocolStep
from app.parsers.eds_raw import _parse_protocol as parse_eds_protocol
from app.parsers.pcrd_raw import _parse_protocol as parse_pcrd_protocol

# Pytest registers a fixture under the name it was originally defined with,
# not under an import alias, so these must be imported under their real names
# to be usable as fixtures here (see test_export_snapshot_reports.py for the
# same pattern). The single ASG test below pulls `plate` via
# request.getfixturevalue() instead of a same-named parameter, so ruff does
# not flag this import as an F811 redefinition.
from test_export_snapshot_csv import plate, data_client  # noqa: F401
from test_export_snapshot_reports import _bind_report_asg


# ---------------------------------------------------------------------------
# Backward compatibility: existing stored JSON (pre-P2-R1-T1) has none of the
# three new fields. app/db.py:692 and :753 both do ProtocolStep(**s) on
# whatever is in the metadata/protocol_overrides tables.
# ---------------------------------------------------------------------------


def test_protocol_step_restores_from_json_with_no_new_fields():
    old_json = {
        "step": 1,
        "temperature": 94.0,
        "duration_sec": 900,
        "cycles": 1,
        "label": "Initial Denaturation",
        "phase": "",
        "goto_label": "",
    }

    step = ProtocolStep(**old_json)

    assert step.plate_read is False
    assert step.temp_increment is None
    assert step.read_channels == []


# ---------------------------------------------------------------------------
# pcrd_raw._parse_protocol(): has_read / inc_temp were already computed and
# silently dropped before this contract.
# ---------------------------------------------------------------------------

_PCRD_PROTOCOL_XML = """
<experimentalData2>
  <protocol2BaseList>
    <TemperatureStep temperatureStepTemp="30" temperatureStepHoldTime="10">
      <PlateReadOption/>
    </TemperatureStep>
    <TemperatureStep temperatureStepTemp="94" temperatureStepHoldTime="900" />
    <TemperatureStep temperatureStepTemp="94" temperatureStepHoldTime="20" />
    <TemperatureStep temperatureStepTemp="61" temperatureStepHoldTime="60">
      <IncrementOption optionTemperatureIncrement="-0.6" />
    </TemperatureStep>
    <GotoStep optionGotoStep="2" optionGotoCycle="9" />
    <TemperatureStep temperatureStepTemp="30" temperatureStepHoldTime="10">
      <PlateReadOption/>
    </TemperatureStep>
  </protocol2BaseList>
</experimentalData2>
"""


def _pcrd_steps() -> list[ProtocolStep]:
    root = ET.fromstring(_PCRD_PROTOCOL_XML)
    return parse_pcrd_protocol(root)


def test_pcrd_parser_carries_plate_read_flag_onto_read_steps():
    steps = _pcrd_steps()

    assert steps[0].label == "Pre-Read"
    assert steps[0].plate_read is True
    assert steps[-1].label == "Post-Read"
    assert steps[-1].plate_read is True

    non_read_steps = [s for s in steps if s.label not in ("Pre-Read", "Post-Read")]
    assert non_read_steps and all(s.plate_read is False for s in non_read_steps)


def test_pcrd_parser_carries_signed_touchdown_increment():
    steps = _pcrd_steps()

    annealing = next(s for s in steps if "TD" in s.label)
    assert annealing.temp_increment == pytest.approx(-0.6)

    non_touchdown = [s for s in steps if "TD" not in s.label]
    assert all(s.temp_increment is None for s in non_touchdown)


def test_pcrd_parser_leaves_read_channels_empty():
    steps = _pcrd_steps()

    assert all(step.read_channels == [] for step in steps)


# ---------------------------------------------------------------------------
# eds_raw._parse_protocol(): CollectionFlag / ExtTemperature were already
# computed and used only inside label strings before this contract.
# ---------------------------------------------------------------------------

_EDS_PROTOCOL_XML = b"""
<TCProtocol>
  <TCStage>
    <StageFlag>PRE_READ</StageFlag>
    <NumOfRepetitions>1</NumOfRepetitions>
    <TCStep>
      <Temperature>30</Temperature>
      <HoldTime>10</HoldTime>
      <CollectionFlag>1</CollectionFlag>
    </TCStep>
  </TCStage>
  <TCStage>
    <StageFlag>PRE_CYCLING</StageFlag>
    <NumOfRepetitions>1</NumOfRepetitions>
    <TCStep>
      <Temperature>95</Temperature>
      <HoldTime>600</HoldTime>
      <CollectionFlag>0</CollectionFlag>
    </TCStep>
  </TCStage>
  <TCStage>
    <StageFlag>CYCLING</StageFlag>
    <NumOfRepetitions>10</NumOfRepetitions>
    <AutoDeltaEnabled>true</AutoDeltaEnabled>
    <TCStep>
      <Temperature>95</Temperature>
      <HoldTime>15</HoldTime>
      <CollectionFlag>0</CollectionFlag>
    </TCStep>
    <TCStep>
      <Temperature>61</Temperature>
      <HoldTime>60</HoldTime>
      <CollectionFlag>1</CollectionFlag>
      <ExtTemperature>-0.6</ExtTemperature>
    </TCStep>
  </TCStage>
  <TCStage>
    <StageFlag>POST_READ</StageFlag>
    <NumOfRepetitions>1</NumOfRepetitions>
    <TCStep>
      <Temperature>30</Temperature>
      <HoldTime>10</HoldTime>
      <CollectionFlag>1</CollectionFlag>
    </TCStep>
  </TCStage>
</TCProtocol>
"""


def _eds_steps() -> list[ProtocolStep]:
    return parse_eds_protocol(_EDS_PROTOCOL_XML)


def test_eds_parser_carries_collection_flag_as_plate_read():
    steps = _eds_steps()

    assert [s.plate_read for s in steps] == [True, False, False, True, True]


def test_eds_parser_carries_signed_touchdown_increment():
    steps = _eds_steps()

    # Only the touchdown-cycling step (CollectionFlag=1, ExtTemperature=-0.6
    # under AutoDeltaEnabled) carries an increment; everything else is None.
    assert [s.temp_increment for s in steps] == [
        None,
        None,
        None,
        pytest.approx(-0.6),
        None,
    ]


def test_eds_parser_leaves_read_channels_empty():
    steps = _eds_steps()

    assert all(step.read_channels == [] for step in steps)


# ---------------------------------------------------------------------------
# ASG payload serialization: app/asg_result.py:91 does
# [step.model_dump() for step in snapshot.protocol]. New fields must survive
# that round trip without raising and without dropping data.
# ---------------------------------------------------------------------------


def test_asg_payload_serializes_new_protocol_fields(
    request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.asg_result import build_result_snapshot
    from app.auth import TokenData
    from app.routers import data

    # Runs the `plate` fixture's setup (registers the "export" session and
    # a completed cluster result) without binding a same-named local, which
    # ruff would otherwise flag as redefining the module-level import above.
    request.getfixturevalue("plate")
    monkeypatch.setitem(
        data.protocol_store,
        "export",
        [
            ProtocolStep(
                step=1,
                temperature=61.0,
                duration_sec=60,
                cycles=10,
                label="Annealing (TD -0.6/cyc)",
                phase="Amplification 1 (Touchdown)",
                plate_read=True,
                temp_increment=-0.6,
                read_channels=[],
            ),
        ],
    )
    _bind_report_asg()
    user = TokenData(user_id="u", username="u", role="user")

    payload = build_result_snapshot("export", user=user)

    steps = payload["result"]["protocol_steps"]
    assert steps == [
        {
            "step": 1,
            "temperature": 61.0,
            "duration_sec": 60,
            "cycles": 10,
            "label": "Annealing (TD -0.6/cyc)",
            "phase": "Amplification 1 (Touchdown)",
            "goto_label": "",
            "plate_read": True,
            "temp_increment": -0.6,
            "read_channels": [],
        },
    ]
