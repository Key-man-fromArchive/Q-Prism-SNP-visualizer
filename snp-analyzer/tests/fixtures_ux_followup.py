"""Deterministic, synthetic UX regression inputs; never a biological reference.

Factories return fresh models. Expected contracts live in the adjacent manifest;
they are requirements for future API tests, not claims that those APIs exist.
"""
from __future__ import annotations

from typing import Literal

from app.models import DataWindow, MarkerRegion, UnifiedData, WellCycleData

NtcScenario = Literal["ok", "warning", "no_ntc", "missing_read", "zero_reference"]


def make_ux_plate(
    size: int = 96, *, has_rox: bool = True, ntc: NtcScenario = "ok",
) -> UnifiedData:
    """Build 0=pre-read, 1..40=amplification, 41=post-read absolute cycles."""
    if size not in (96, 384):
        raise ValueError("UX fixtures support only 96 or 384 wells")
    if ntc not in ("ok", "warning", "no_ntc", "missing_read", "zero_reference"):
        raise ValueError(f"Unknown NTC scenario: {ntc}")
    wells = _plate_wells(size)
    ntc_wells = [] if ntc == "no_ntc" else wells[-2:]
    readings = _plate_readings(wells, ntc_wells, ntc, has_rox)
    return UnifiedData(
        instrument="Synthetic UX fixture", allele2_dye="HEX", wells=wells,
        cycles=list(range(42)), data=readings, has_rox=has_rox,
        normalization_mode="passive_reference" if has_rox else "none",
        normalization_channel="ROX" if has_rox else None,
        normalization_dye="ROX" if has_rox else None,
        sample_names={well: f"SYNTHETIC_{well}" for well in wells},
        ntc_wells=ntc_wells, imported_well_types={well: "NTC" for well in ntc_wells},
        data_windows=[
            DataWindow(name="Pre-read", start_cycle=0, end_cycle=0),
            DataWindow(name="Amplification", start_cycle=1, end_cycle=40),
            DataWindow(name="Post-read", start_cycle=41, end_cycle=41),
        ],
    )


def _plate_wells(size: int) -> list[str]:
    rows, columns = (8, 12) if size == 96 else (16, 24)
    return [f"{chr(65 + row)}{col}" for row in range(rows) for col in range(1, columns + 1)]


def _plate_readings(
    wells: list[str], ntc_wells: list[str], scenario: NtcScenario, has_rox: bool,
) -> list[WellCycleData]:
    return [
        _reading(well, index, cycle, ntc_wells, scenario, has_rox)
        for index, well in enumerate(wells)
        for cycle in range(42)
        if not (scenario == "missing_read" and well == wells[-1] and cycle == 40)
    ]


def _reading(
    well: str, index: int, cycle: int, ntc_wells: list[str],
    scenario: NtcScenario, has_rox: bool,
) -> WellCycleData:
    slopes = ((4, 2), (2, 4), (3, 3))
    fam_slope, allele_slope = slopes[index % 3]
    fam, allele2 = 10.0 + fam_slope * cycle, 20.0 + allele_slope * cycle
    if well in ntc_wells:
        fam, allele2 = 2.0, 2.0
        if scenario == "warning" and well == ntc_wells[-1]:
            fam, allele2 = 10.0 + 4 * cycle, 20.0 + 2 * cycle
    if scenario == "zero_reference":
        fam, allele2 = 0.0, 0.0
    return WellCycleData(
        well=well, cycle=cycle, fam=fam, allele2=allele2,
        rox=10.0 if has_rox else None,
    )


def make_ux_markers(data: UnifiedData) -> list[MarkerRegion]:
    """Two disjoint ploidies; leave the final four wells explicitly unassigned."""
    midpoint = len(data.wells) // 2
    return [
        MarkerRegion(id="synthetic-diploid", name="Synthetic diploid", wells=data.wells[:midpoint], ploidy=2),
        MarkerRegion(id="synthetic-hexaploid", name="Synthetic hexaploid", wells=data.wells[midpoint:-4], ploidy=6),
    ]


def make_ux_endpoint() -> UnifiedData:
    """A real single-read shape, where channel_min is a supported background."""
    data = make_ux_plate()
    return data.model_copy(update={
        "cycles": [40], "data": [reading for reading in data.data if reading.cycle == 40],
        "data_windows": [DataWindow(name="End Point", start_cycle=40, end_cycle=40)],
    })
