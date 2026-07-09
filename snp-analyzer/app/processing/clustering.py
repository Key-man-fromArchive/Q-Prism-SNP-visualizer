from __future__ import annotations

from app.models import ThresholdConfig, WellType
from app.processing.genotype_vocab import (
    DEFAULT_PLOIDY,
    genotype_label,
    label_by_ratio,
    validate_ploidy,
)

# All thresholds below are scale-invariant (a fraction of the plate's own signal,
# a dimensionless ratio, or a ratio of distances) — never an absolute magnitude,
# because ROX concentration varies between kits and rescales the whole plate.

# NTC = total signal below this fraction of the plate's median total signal.
_NTC_SIGNAL_FRAC = 0.2

# Two fitted clusters closer than this fraction of the ideal dosage spacing
# (1/ploidy) are treated as one dosage class that BIC over-split on noise.
_DOSAGE_MERGE_FRAC = 0.5

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
    ploidy: int = DEFAULT_PLOIDY,
) -> tuple[dict[str, str], dict[str, float]]:
    """Model-based, ploidy-aware genotype clustering, fully scale-invariant.

    Generalizes to any ploidy P (2=diploid .. 8): a locus resolves into up to
    ``P + 1`` allele-dosage classes along the fam-fraction axis. The genotyping
    model follows fitPoly/fitTetra: the per-well ratio ``r = fam/(fam+allele2)``
    is arcsine-sqrt transformed (variance stabilization), then a 1-D Gaussian
    mixture with a shared (tied) variance and free mixing proportions is fitted;
    the number of present dosage classes is chosen by BIC (this replaces the old
    diploid-only silhouette + separation gate). Fitted clusters are mapped to
    dosages by a monotonic best-fit against the ideal ratios ``d/P``, so a skewed
    homozygote (e.g. r~0.30 from dye imbalance) is still ranked correctly.

    Returns ``(assignments, confidences)`` where confidence is a 0..1 margin
    score: how far the well sits from the genotype decision boundary
    (1 - nearest/second-nearest distance in fam-fraction space). A well is
    Undetermined (no-call) when that margin drops below ``1 - _AMBIG_RATIO``.

    Genotype is the fam-fraction (angle), not the signal magnitude, and the ROX
    scale varies between kits — so this never hard-filters on an absolute value.

    1. NTC: total signal below a fraction of the plate's median total.
    2. Fit an arcsine-sqrt-ratio Gaussian mixture (tied variance), K present
       dosage classes chosen by BIC over 1..P+1. K=1 => monomorphic plate.
    3. Map each cluster to an allele dosage by a monotonic best-fit of the
       cluster ratios to the ideal ``d/P`` positions (rank-preserving, so skew
       cannot reorder dosages), then label via the genotype vocabulary.
    4. Confidence in ratio space: assign each well to the nearest genotype
       ratio-centre; wells in the gap between two genotypes — or in singleton
       clusters — are Undetermined. Low-signal wells are NOT penalised for
       magnitude, only for ambiguous ratio.

    ``ntc_threshold`` is accepted for API compatibility but no longer used as an
    absolute cutoff (NTC is now purely relative).
    """
    import numpy as np
    from sklearn.mixture import GaussianMixture

    validate_ploidy(ploidy)

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
            assignments[wells[i]] = label_by_ratio(ratio[i], ploidy)
            confidences[wells[i]] = 1.0
        return assignments, confidences

    # 2. Fit a 1-D Gaussian mixture on the arcsine-sqrt-transformed ratio
    #    (variance stabilization, fitPoly/fitTetra). Tied covariance = one shared
    #    variance across dosage classes; free weights = no segregation assumption
    #    (p.free). The number of PRESENT dosage classes K is chosen by BIC over
    #    1..P+1 — K=1 is a monomorphic plate, so BIC replaces the old silhouette +
    #    separation gate and will not split measurement noise into fake genotypes.
    rt = np.arcsin(np.sqrt(np.clip(ratio[sig_idx], 0.0, 1.0)))
    X = rt.reshape(-1, 1)
    n_unique = len(np.unique(np.round(rt, 9)))
    k_max = min(ploidy + 1, n_unique)

    best_gmm = None
    best_bic = None
    for k in range(1, k_max + 1):
        gmm = GaussianMixture(
            n_components=k,
            covariance_type="tied",
            random_state=42,
            n_init=5,
            reg_covar=1e-6,
        )
        gmm.fit(X)
        bic = gmm.bic(X)
        if best_bic is None or bic < best_bic:
            best_bic, best_gmm = bic, gmm

    comp = best_gmm.predict(X)
    members: dict[int, list[int]] = {}
    for local_i, global_i in enumerate(sig_idx):
        members.setdefault(int(comp[local_i]), []).append(global_i)

    # 3. Map each present cluster to an allele dosage. Sort clusters by their
    #    median ratio and pick the monotonically increasing dosage assignment
    #    (subset of 0..P) that best matches the ideal d/P positions. Rank order is
    #    preserved, so a skewed homozygote (r far from 0 or 1) can never be
    #    reordered past a neighbouring cluster — only snapped to its dosage.
    cluster_ratio = {
        lab: float(np.median([ratio[i] for i in idxs])) for lab, idxs in members.items()
    }
    order = sorted(members, key=lambda lab: cluster_ratio[lab])

    # Merge adjacent clusters that sit far closer than the ideal dosage spacing
    # (1/P): they are one dosage that BIC over-split on noise, not two dosages.
    # Without this the dosage DP below (which forces distinct dosages) would
    # promote a noise-split into a spurious neighbouring dosage class.
    if len(order) > 1:
        min_sep = _DOSAGE_MERGE_FRAC / ploidy
        groups: list[list[int]] = [[order[0]]]
        for lab in order[1:]:
            if cluster_ratio[lab] - cluster_ratio[groups[-1][-1]] < min_sep:
                groups[-1].append(lab)
            else:
                groups.append([lab])
        if len(groups) < len(order):
            merged: dict[int, list[int]] = {}
            for gi, group in enumerate(groups):
                idxs: list[int] = []
                for lab in group:
                    idxs.extend(members[lab])
                merged[gi] = idxs
            members = merged
            cluster_ratio = {
                lab: float(np.median([ratio[i] for i in idxs]))
                for lab, idxs in members.items()
            }
            order = sorted(members, key=lambda lab: cluster_ratio[lab])

    dosages = _assign_dosages([cluster_ratio[lab] for lab in order], ploidy)
    label_map = {lab: genotype_label(d, ploidy) for lab, d in zip(order, dosages)}

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


def _assign_dosages(sorted_ratios: list[float], ploidy: int) -> list[int]:
    """Assign a strictly increasing allele dosage to each cluster ratio.

    Given cluster median ratios sorted ascending, choose the increasing dosage
    sequence ``0 <= d0 < d1 < ... < d(k-1) <= P`` minimizing the total distance
    to the ideal positions ``d/P``. Preserving rank order means a dye-skewed
    homozygote is snapped to its dosage but never reordered past a neighbour; a
    full ``k = P+1`` solution is forced to use every dosage. Small DP over
    (cluster index, dosage)."""
    k = len(sorted_ratios)
    ideals = [d / ploidy for d in range(ploidy + 1)]
    inf = float("inf")
    # cost[i][d] = best total cost for clusters 0..i with cluster i taking dosage d
    cost = [[inf] * (ploidy + 1) for _ in range(k)]
    back = [[-1] * (ploidy + 1) for _ in range(k)]
    for d in range(ploidy + 1):
        cost[0][d] = abs(sorted_ratios[0] - ideals[d])
    for i in range(1, k):
        for d in range(ploidy + 1):
            best_prev, best_pd = inf, -1
            for pd in range(d):
                if cost[i - 1][pd] < best_prev:
                    best_prev, best_pd = cost[i - 1][pd], pd
            if best_pd >= 0:
                cost[i][d] = best_prev + abs(sorted_ratios[i] - ideals[d])
                back[i][d] = best_pd
    # best final dosage
    last = min(range(ploidy + 1), key=lambda d: cost[k - 1][d])
    dosages = [0] * k
    dosages[k - 1] = last
    for i in range(k - 1, 0, -1):
        dosages[i - 1] = back[i][dosages[i]]
    return dosages


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
