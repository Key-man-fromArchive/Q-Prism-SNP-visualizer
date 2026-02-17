from app.models import WellCycleData, NormalizedPoint


def normalize(data: list[WellCycleData], has_rox: bool, use_rox: bool = True) -> list[NormalizedPoint]:
    results = []
    for d in data:
        if has_rox and use_rox and d.rox and d.rox > 0:
            norm_fam = d.fam / d.rox
            norm_allele2 = d.allele2 / d.rox
        else:
            norm_fam = d.fam
            norm_allele2 = d.allele2
        results.append(NormalizedPoint(
            well=d.well,
            cycle=d.cycle,
            norm_fam=round(norm_fam, 6),
            norm_allele2=round(norm_allele2, 6),
            raw_fam=round(d.fam, 4),
            raw_allele2=round(d.allele2, 4),
            raw_rox=round(d.rox, 4) if d.rox is not None else None,
        ))
    return results


def normalize_for_cycle(
    data: list[WellCycleData], cycle: int, has_rox: bool, use_rox: bool = True
) -> list[NormalizedPoint]:
    cycle_data = [d for d in data if d.cycle == cycle]
    return normalize(cycle_data, has_rox, use_rox)
