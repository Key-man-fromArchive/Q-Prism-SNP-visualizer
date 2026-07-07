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


def cluster_auto(points: list[dict], ntc_threshold: float = 0.1) -> dict[str, str]:
    """Data-driven genotype clustering that does not assume a fixed allele ratio.

    Heterozygote clusters often do not sit at ratio 0.5 — dye efficiencies
    differ, so the het cloud can lean strongly toward one allele. Fixed ratio
    cutoffs (e.g. >0.6 -> Allele 1) then misclassify skewed hets as a
    homozygote. Instead:

    1. Split off NTC wells by low total signal (relative to the population).
    2. KMeans the remaining wells in (fam, allele2) space, choosing k=2 or 3 by
       silhouette (whichever separates better).
    3. Label clusters by the RANK of their mean fam-fraction, not absolute
       thresholds: highest -> Allele 1 Homo, lowest -> Allele 2 Homo, and the
       middle cluster (when k=3) -> Heterozygous.
    """
    import numpy as np
    from sklearn.cluster import KMeans
    from sklearn.metrics import silhouette_score

    if not points:
        return {}

    wells = [p["well"] for p in points]
    fam = np.array([p["norm_fam"] for p in points], dtype=float)
    allele2 = np.array([p["norm_allele2"] for p in points], dtype=float)
    total = fam + allele2
    ratio = np.where(total > 0, fam / np.where(total > 0, total, 1.0), 0.5)

    assignments: dict[str, str] = {}

    # 1. NTC = very low total signal. Use the larger of the configured absolute
    #    threshold and a fraction of the median signal (robust to raw vs
    #    normalized magnitudes).
    positive = total[total > 0]
    median_total = float(np.median(positive)) if positive.size else 0.0
    ntc_cut = max(ntc_threshold, 0.15 * median_total)
    ntc_mask = total < ntc_cut
    for w, is_ntc in zip(wells, ntc_mask):
        if is_ntc:
            assignments[w] = WellType.NTC.value

    sig_idx = [i for i in range(len(wells)) if not ntc_mask[i]]
    if len(sig_idx) < 2:
        for i in sig_idx:
            assignments[wells[i]] = WellType.UNKNOWN.value
        return assignments

    coords = np.column_stack([fam[sig_idx], allele2[sig_idx]])
    n_unique = len(np.unique(coords, axis=0))

    # 2. Pick k = 2 or 3 by silhouette.
    best_labels = None
    best_score = None
    for k in (2, 3):
        if n_unique < k:
            continue
        labels = KMeans(n_clusters=k, n_init=10, random_state=42).fit_predict(coords)
        if len(set(labels)) < 2:
            continue
        score = silhouette_score(coords, labels)
        if best_score is None or score > best_score:
            best_score, best_labels = score, labels

    if best_labels is None:
        for i in sig_idx:
            assignments[wells[i]] = WellType.UNKNOWN.value
        return assignments

    # 3. Rank clusters by mean fam-fraction and label by position.
    members: dict[int, list[int]] = {}
    for local_i, global_i in enumerate(sig_idx):
        members.setdefault(int(best_labels[local_i]), []).append(global_i)

    order = sorted(members, key=lambda lab: float(np.mean([ratio[i] for i in members[lab]])))
    if len(order) >= 3:
        label_map = {
            order[0]: WellType.ALLELE2_HOMO.value,
            order[-1]: WellType.ALLELE1_HOMO.value,
        }
        for mid in order[1:-1]:
            label_map[mid] = WellType.HETEROZYGOUS.value
    else:
        label_map = {
            order[0]: WellType.ALLELE2_HOMO.value,
            order[-1]: WellType.ALLELE1_HOMO.value,
        }

    for lab, idxs in members.items():
        for i in idxs:
            assignments[wells[i]] = label_map.get(lab, WellType.HETEROZYGOUS.value)

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
