"""Opt-in absolute coordinates without changing legacy zero/latest requests."""
from typing import Literal

from fastapi import HTTPException

CycleMode = Literal["legacy_latest", "absolute"]


def resolve_cycle(cycles: list[int], cycle: int, mode: CycleMode) -> int:
    if mode == "absolute":
        if cycle not in cycles:
            raise HTTPException(400, f"Cycle {cycle} not available")
        return cycle
    return max(cycles) if cycle <= 0 else cycle
