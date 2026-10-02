"""Current marker/allele names reach exports; display helpers are pure."""
import csv
import io
from types import SimpleNamespace

import pytest

from fixtures_ux_followup import make_ux_markers, make_ux_plate
from test_marker_contract import data_client as _data_client, _register

data_client = _data_client


@pytest.fixture
def plate(data_client: SimpleNamespace) -> SimpleNamespace:
    _register(data_client, "export", make_ux_plate())
    return data_client


def _analyse_markers(plate: SimpleNamespace):
    unified = plate.upload.sessions["export"]
    markers = make_ux_markers(unified)
    response = plate.client.post("/api/data/export/cluster", json={
        "cycle": 20, "use_rox": True, "regions": [m.model_dump() for m in markers],
    })
    assert response.status_code == 200, response.text
    return markers


def _rename(plate: SimpleNamespace, markers, name: str, fam: str, allele2: str):
    from app.models import AlleleLabels
    renamed = [m.model_copy(deep=True) for m in markers]
    renamed[0].name = name
    renamed[0].allele_labels = AlleleLabels(fam=fam, allele2=allele2)
    plate.clustering.marker_store["export"] = renamed
    return renamed


def _capture(plate: SimpleNamespace):
    from app.auth import TokenData
    from app.reporting.result_snapshot import ExportOptions, capture_result_snapshot
    user = TokenData(user_id="u", username="u", role="admin")
    return capture_result_snapshot("export", user, ExportOptions())


def test_csv_uses_current_marker_name_after_rename(plate: SimpleNamespace) -> None:
    markers = _analyse_markers(plate)
    _rename(plate, markers, "RenamedAssay", "WT", "MT")
    response = plate.client.get("/api/data/export/export/csv")
    assert response.status_code == 200
    rows = list(csv.DictReader(io.StringIO(response.text)))
    names = {r["Marker ID"]: r["Marker"] for r in rows if r["Marker ID"]}
    assert names[markers[0].id] == "RenamedAssay"
    assert names[markers[1].id] == markers[1].name


def test_figures_keep_points_and_use_current_name(plate: SimpleNamespace) -> None:
    from app.reporting.result_snapshot import snapshot_rows
    from app.reporting.snapshot_presentation import report_figures
    markers = _analyse_markers(plate)
    snapshot = _capture(plate)
    before = [len(f.points) for f in report_figures(snapshot, snapshot_rows(snapshot))]
    _rename(plate, markers, "RenamedAssay", "WT", "MT")
    snapshot = _capture(plate)
    figures = report_figures(snapshot, snapshot_rows(snapshot))
    assert [len(f.points) for f in figures] == before
    assert all(count > 0 for count in before)
    assert figures[0].title.startswith("RenamedAssay · ")
    assert "[" not in figures[0].title


def test_marker_labels_are_deep_copies(plate: SimpleNamespace) -> None:
    markers = _analyse_markers(plate)
    _rename(plate, markers, "RenamedAssay", "WT", "MT")
    snapshot = _capture(plate)
    label = snapshot.marker_labels[markers[0].id]
    assert label.name == "RenamedAssay"
    assert label.allele_labels.fam == "WT"
    plate.clustering.marker_store["export"][0].name = "Changed Later"
    assert snapshot.marker_labels[markers[0].id].name == "RenamedAssay"


def test_row_carries_allele_names_and_canonical_genotype(plate: SimpleNamespace) -> None:
    from app.reporting.result_snapshot import snapshot_rows
    markers = _analyse_markers(plate)
    _rename(plate, markers, "RenamedAssay", "WT", "MT")
    rows = snapshot_rows(_capture(plate))
    named = [r for r in rows if r.marker and r.marker.marker_id == markers[0].id]
    assert named and all(r.allele_labels.fam == "WT" for r in named)
    diploid = {r.genotype for r in named}
    assert diploid <= {"Allele 1 Homo", "Allele 2 Homo", "Heterozygous", "NTC", "Unknown",
                       "Undetermined", "Omit", "Empty", "Positive Control"}


def test_unnamed_run_table_structure_unchanged(plate: SimpleNamespace) -> None:
    from app.reporting.snapshot_presentation import report_headers
    assert plate.client.post("/api/data/export/cluster", json={
        "cycle": 20, "use_rox": False, "algorithm": "threshold"}).status_code == 200
    snapshot = _capture(plate)
    assert snapshot.marker_labels == {}
    assert "Marker" not in report_headers(snapshot)


def test_filter_snapshot_restricts_labels(plate: SimpleNamespace) -> None:
    from app.reporting.result_snapshot import filter_snapshot
    markers = _analyse_markers(plate)
    _rename(plate, markers, "RenamedAssay", "WT", "MT")
    filtered = filter_snapshot(_capture(plate), (markers[0].id,))
    assert set(filtered.marker_labels) == {markers[0].id}


def _labels(fam: str = "WT", allele2: str = "MT"):
    from app.models import AlleleLabels
    return AlleleLabels(fam=fam, allele2=allele2)


def test_display_genotype_diploid_default_format() -> None:
    from app.reporting.snapshot_presentation import display_genotype
    labels = _labels()
    assert display_genotype("Allele 1 Homo", allele_labels=labels) == "WT/WT"
    assert display_genotype("Heterozygous", allele_labels=labels) == "WT/MT"
    assert display_genotype("Allele 2 Homo", allele_labels=labels) == "MT/MT"
    assert display_genotype("NTC", allele_labels=labels) == "NTC"


def test_display_genotype_without_names_is_canonical() -> None:
    from app.reporting.snapshot_presentation import display_genotype
    assert display_genotype("Heterozygous") == "Heterozygous"
    assert display_genotype("AAAB", allele_labels=_labels()) == "AAAB"


def test_polyploid_legend() -> None:
    from app.reporting.snapshot_presentation import polyploid_legend
    assert polyploid_legend(_labels(), "VIC") == "A = WT (FAM), B = MT (VIC)"
    assert polyploid_legend(None, "VIC") is None


def test_axis_label_named_and_default(plate: SimpleNamespace) -> None:
    from app.reporting.snapshot_presentation import axis_label
    assert plate.client.post("/api/data/export/cluster", json={
        "cycle": 20, "use_rox": True, "algorithm": "threshold"}).status_code == 200
    snapshot = _capture(plate)
    assert axis_label(snapshot, "fam") == "FAM (norm)"
    assert axis_label(snapshot, "fam", allele_labels=_labels()) == "FAM (WT)"
    assert axis_label(snapshot, "allele2", allele_labels=_labels()) == f"{snapshot.unified.allele2_dye} (MT)"


def test_cycle_label_with_and_without_read_labels(plate: SimpleNamespace) -> None:
    from app.models import ReadLabel
    from app.reporting.snapshot_presentation import cycle_label
    assert plate.client.post("/api/data/export/cluster", json={
        "cycle": 20, "use_rox": False, "algorithm": "threshold"}).status_code == 200
    snapshot = _capture(plate)
    assert cycle_label(snapshot, 20) == "20"
    labels = {1: ReadLabel(stage="Pre-read"),
              2: ReadLabel(stage="Amplification", pcr_cycle=36, temperature=40.0),
              3: ReadLabel(stage="Amplification", pcr_cycle=37, temperature=40.0),
              4: ReadLabel(stage="Post-read")}
    snapshot.unified.read_labels = labels
    assert cycle_label(snapshot, 2) == "Amplification 1/2 · PCR 36 · 40°C"
    assert cycle_label(snapshot, 3) == "Amplification 2/2 · PCR 37 · 40°C"
    assert cycle_label(snapshot, 1) == "Pre-read"
