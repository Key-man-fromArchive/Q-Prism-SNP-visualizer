from __future__ import annotations

from app.models import ThresholdConfig, WellType


def cluster_threshold(
    points: list[dict], config: ThresholdConfig | None = None
) -> dict[str, str]:
    if config is None:
        config = ThresholdConfig()

    assignments: dict[str, str] = {}
    for p in points:
        total = p["norm_fam"] + p["norm_allele2"]
        if total < config.ntc_threshold:
            assignments[p["well"]] = WellType.NTC.value
            continue
        ratio = p["norm_fam"] / total
        if ratio > config.allele2_ratio_min:
            assignments[p["well"]] = WellType.ALLELE1_HOMO.value
        elif ratio < config.allele1_ratio_max:
            assignments[p["well"]] = WellType.ALLELE2_HOMO.value
        else:
            assignments[p["well"]] = WellType.HETEROZYGOUS.value
    return assignments


def cluster_kmeans(points: list[dict], n_clusters: int = 4) -> dict[str, str]:
    import numpy as np
    from sklearn.cluster import KMeans

    if not points:
        return {}

    coords = np.array([[p["norm_fam"], p["norm_allele2"]] for p in points])
    wells = [p["well"] for p in points]

    unique_points = np.unique(coords, axis=0)
    actual_k = min(n_clusters, len(unique_points))
    if actual_k < 2:
        return {w: WellType.UNKNOWN.value for w in wells}

    km = KMeans(n_clusters=actual_k, n_init=10, random_state=42)
    labels = km.fit_predict(coords)
    centers = km.cluster_centers_

    cluster_labels = _label_clusters(centers)

    return {well: cluster_labels[label] for well, label in zip(wells, labels)}


def _label_clusters(centers) -> dict[int, str]:
    n = len(centers)
    labels: dict[int, str] = {}

    center_info = []
    for i, (fam, allele2) in enumerate(centers):
        total = fam + allele2
        ratio = fam / total if total > 0 else 0.5
        center_info.append((i, total, ratio))

    by_total = sorted(center_info, key=lambda x: x[1])

    # Lowest total -> NTC if signal is very low
    if by_total[0][1] < 0.5:
        labels[by_total[0][0]] = WellType.NTC.value

    for i, total, ratio in center_info:
        if i in labels:
            continue
        if ratio > 0.6:
            labels[i] = WellType.ALLELE1_HOMO.value
        elif ratio < 0.4:
            labels[i] = WellType.ALLELE2_HOMO.value
        else:
            labels[i] = WellType.HETEROZYGOUS.value

    for i in range(n):
        if i not in labels:
            labels[i] = WellType.UNKNOWN.value

    return labels
