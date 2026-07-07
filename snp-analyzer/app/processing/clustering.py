from __future__ import annotations

from app.models import ThresholdConfig, WellType

# All thresholds below are scale-invariant (a fraction of the plate's own signal,
# a dimensionless ratio, or a ratio of distances) — never an absolute magnitude,
# because ROX concentration varies between kits and rescales the whole plate.

# NTC = total signal below this fraction of the plate's median total signal.
_NTC_SIGNAL_FRAC = 0.2

# Minimum ratio of inter-cluster spacing to within-cluster spread required to
# accept a multi-cluster (polymorphic) solution; below this the plate is treated
# as a single genotype to avoid splitting noise into fake genotypes.
_SEP_FACTOR = 2.0

# A well is Undetermined when its distance (in fam-fraction) to the nearest
# genotype centre is more than this fraction of its distance to the 2nd-nearest
# — i.e. it sits in the ambiguous gap between two genotypes. The per-call
# confidence is the margin (1 - nearest/second); the no-call cutoff is therefore
# confidence < (1 - _AMBIG_RATIO).
_AMBIG_RATIO = 0.8


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


def cluster_auto(
    points: list[dict],
    ntc_threshold: float = 0.1,
    control_wells: dict[str, str] | None = None,
) -> tuple[dict[str, str], dict[str, float]]:
    """Data-driven genotype clustering, fully scale-invariant.

    Returns ``(assignments, confidences)`` where confidence is a 0..1 margin
    score: how far the well sits from the genotype decision boundary
    (1 - nearest/second-nearest distance in fam-fraction space). A well is
    Undetermined (no-call) when that margin drops below ``1 - _AMBIG_RATIO``.


    Genotype is the fam-fraction (angle), not the signal magnitude, and the ROX
    scale varies between kits — so this never hard-filters on an absolute value.

    1. NTC: total signal below a fraction of the plate's median total.
    2. KMeans the rest in (fam, allele2) space, k=2/3 by silhouette. A
       separation gate collapses to a single genotype (monomorphic) when the
       clusters are not clearly separated relative to their own scatter.
    3. Label each cluster by the ABSOLUTE fam-fraction of its centroid
       (dimensionless 0.65/0.35 cutoffs); the middle cluster is the heterozygote
       when both homozygotes are present (handles hets skewed off 0.5).
    4. Confidence in ratio space: assign each well to the nearest genotype
       ratio-centre; wells in the gap between two genotypes — or in singleton
       clusters — are Undetermined. Low-signal wells are NOT penalised for
       magnitude, only for ambiguous ratio.

    ``ntc_threshold`` is accepted for API compatibility but no longer used as an
    absolute cutoff (NTC is now purely relative).
    """
    import numpy as np
    from sklearn.cluster import KMeans
    from sklearn.metrics import silhouette_score

    if not points:
        return {}, {}

    control_wells = control_wells or {}
    assignments: dict[str, str] = {}
    confidences: dict[str, float] = {}

    # Honor user-marked controls (NTC / Positive Control) and exclude them from
    # the clustering input so a control can't distort the genotype clusters.
    work = []
    for p in points:
        ctype = control_wells.get(p["well"])
        if ctype in (WellType.NTC.value, WellType.POSITIVE_CONTROL.value):
            assignments[p["well"]] = ctype
            confidences[p["well"]] = 1.0
        else:
            work.append(p)
    if not work:
        return assignments, confidences

    wells = [p["well"] for p in work]
    fam = np.array([p["norm_fam"] for p in work], dtype=float)
    allele2 = np.array([p["norm_allele2"] for p in work], dtype=float)
    total = fam + allele2
    ratio = np.where(total > 0, fam / np.where(total > 0, total, 1.0), 0.5)

    # 1. NTC = very low total signal RELATIVE to this plate's own signal level.
    #    NO absolute cutoff: ROX concentration varies between kits, so the axis
    #    scale (numeric magnitude) can differ enormously. Every decision here is
    #    scale-invariant — a fraction of the plate's median, or the dimensionless
    #    fam-fraction ratio.
    positive = total[total > 0]
    median_total = float(np.median(positive)) if positive.size else 0.0
    ntc_mask = total < _NTC_SIGNAL_FRAC * median_total
    for w, is_ntc in zip(wells, ntc_mask):
        if is_ntc:
            assignments[w] = WellType.NTC.value
            confidences[w] = 1.0

    sig_idx = [i for i in range(len(wells)) if not ntc_mask[i]]

    # Too few signal wells to cluster reliably — call by absolute ratio.
    if len(sig_idx) < 4:
        for i in sig_idx:
            assignments[wells[i]] = _label_by_ratio(ratio[i])
            confidences[wells[i]] = 1.0
        return assignments, confidences

    coords = np.column_stack([fam[sig_idx], allele2[sig_idx]])
    n_unique = len(np.unique(coords, axis=0))

    # 2. Pick k = 2 or 3 by silhouette (need more unique points than clusters
    #    so silhouette is defined, and reject solutions with an empty cluster).
    best_labels = None
    best_score = None
    for k in (2, 3):
        if n_unique < k:
            continue
        labels = KMeans(n_clusters=k, n_init=10, random_state=42).fit_predict(coords)
        if len(set(labels)) < k:
            continue
        score = silhouette_score(coords, labels)
        if best_score is None or score > best_score:
            best_score, best_labels = score, labels

    members: dict[int, list[int]] = {}
    if best_labels is not None:
        for local_i, global_i in enumerate(sig_idx):
            members.setdefault(int(best_labels[local_i]), []).append(global_i)

    # Centroids + within-cluster spread (used only for the separation gate,
    # a ratio of two distances in the same space — scale-invariant).
    centroids: dict[int, tuple[float, float]] = {}
    spreads: list[float] = []
    for lab, idxs in members.items():
        cx = float(np.mean(fam[idxs]))
        cy = float(np.mean(allele2[idxs]))
        centroids[lab] = (cx, cy)
        d = np.hypot(fam[idxs] - cx, allele2[idxs] - cy)
        spreads.append(float(np.median(d)))

    cvals = list(centroids.values())
    if len(cvals) >= 2:
        min_inter = min(
            float(np.hypot(cvals[i][0] - cvals[j][0], cvals[i][1] - cvals[j][1]))
            for i in range(len(cvals))
            for j in range(i + 1, len(cvals))
        )
    else:
        min_inter = 0.0
    pooled_spread = float(np.median(spreads)) if spreads else 0.0

    # Separation gate: if the "clusters" are not clearly separated relative to
    # their own scatter, the plate is effectively a single genotype (monomorphic)
    # — KMeans would otherwise split measurement noise into fake genotypes. Fall
    # back to labeling each well by its absolute allele ratio.
    if best_labels is None or len(cvals) < 2 or min_inter < _SEP_FACTOR * pooled_spread:
        for i in sig_idx:
            assignments[wells[i]] = _label_by_ratio(ratio[i])
            confidences[wells[i]] = 1.0
        return assignments, confidences

    # 3. Label clusters by the ABSOLUTE fam-fraction of their centroid ratio
    #    (dimensionless, so ROX scale is irrelevant; homozygotes sit near the
    #    axes so 0.65/0.35 cutoffs are safe). In a genuine 3-cluster solution the
    #    middle cluster is the heterozygote — even when dye skew pushes its ratio
    #    toward a homozygote — but only claim it when both homozygotes are present.
    cluster_ratio = {
        lab: float(np.median([ratio[i] for i in idxs])) for lab, idxs in members.items()
    }
    order = sorted(members, key=lambda lab: cluster_ratio[lab])
    label_map = {lab: _label_by_ratio(cluster_ratio[lab]) for lab in members}
    spans_both = (
        label_map[order[-1]] == WellType.ALLELE1_HOMO.value
        and label_map[order[0]] == WellType.ALLELE2_HOMO.value
    )
    if spans_both:
        for mid in order[1:-1]:
            label_map[mid] = WellType.HETEROZYGOUS.value

    # 4. Confidence in RATIO (angle) space. Genotype is the fam-fraction, not the
    #    signal magnitude, so a genuine low-signal het must NOT be penalised for
    #    being closer to the origin. Build one ratio-centre per genotype, assign
    #    each signal well to the nearest centre, and mark wells that sit in the
    #    gap between two genotypes (nearest/second-nearest ratio distance above
    #    _AMBIG_RATIO) as Undetermined. Singleton clusters are Undetermined.
    tiny_labels = {lab for lab, idxs in members.items() if len(idxs) < 2}
    genotype_ratio: dict[str, list[float]] = {}
    for lab, idxs in members.items():
        if lab in tiny_labels:
            continue
        genotype_ratio.setdefault(label_map[lab], []).extend(float(ratio[i]) for i in idxs)
    centres = {g: float(np.median(v)) for g, v in genotype_ratio.items()}
    centre_items = list(centres.items())

    for lab, idxs in members.items():
        for i in idxs:
            w = wells[i]
            if lab in tiny_labels or not centre_items:
                assignments[w] = WellType.UNDETERMINED.value
                confidences[w] = 0.0
                continue
            ranked = sorted(centre_items, key=lambda gc: abs(ratio[i] - gc[1]))
            nearest_d = abs(ratio[i] - ranked[0][1])
            second_d = abs(ratio[i] - ranked[1][1]) if len(ranked) >= 2 else None
            if second_d is None:
                # Only one genotype present — a confident single-cluster call.
                assignments[w] = ranked[0][0]
                confidences[w] = 1.0
                continue
            frac = nearest_d / second_d if second_d > 0 else 0.0
            confidences[w] = max(0.0, min(1.0, 1.0 - frac))
            if frac > _AMBIG_RATIO:
                assignments[w] = WellType.UNDETERMINED.value
            else:
                assignments[w] = ranked[0][0]

    return assignments, confidences


def _label_by_ratio(r: float) -> str:
    """Fallback single-well genotype call by absolute fam-fraction, used when
    clustering is not reliable (monomorphic plate or very few wells).
    Homozygotes sit near the axes, so wide cutoffs keep skewed hets as Het."""
    if r >= 0.65:
        return WellType.ALLELE1_HOMO.value
    if r <= 0.35:
        return WellType.ALLELE2_HOMO.value
    return WellType.HETEROZYGOUS.value


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
