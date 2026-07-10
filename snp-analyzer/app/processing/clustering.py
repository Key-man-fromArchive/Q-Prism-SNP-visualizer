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

# Adjacent clusters separated by fewer than this many pooled SDs (computed
# LOCALLY from just that pair's own points, in the arcsine-sqrt fit space) are
# not a statistically meaningful split -- merge them regardless of the
# fixed-fraction rule above (C2 fix, see cluster_auto / _local_sd_ratio).
_MERGE_SEP_SD = 5.5

# Adjacent dosage classes closer than this many pooled within-class SDs are flagged
# as poorly resolved (reliability warning, esp. high ploidy).
_MIN_SEP_SD = 3.0

# No-call rules, evaluated against the fitted mixture (so they scale with the
# data's own spread and ploidy, not a fixed ratio gap):
#   - a well whose best posterior probability is below this is "between classes"
_CALL_MIN_POSTERIOR = 0.9
#   - a well more than this many pooled SDs from EVERY class mean is an outlier
_OUTLIER_SD = 4.0

# Phase 1 diagnostics (C3): with <4 signal wells there is no mixture fit at
# all -- just a raw ratio-vs-ideal-dosage call, with no statistical evidence of
# cluster separation. That is, at best, "just barely a confident call": the
# SAME bar (_CALL_MIN_POSTERIOR) a normal-sized marker must clear to avoid an
# Undetermined no-call. Reusing that constant (rather than inventing a new
# magic number) means the fallback can never report MORE certainty than a
# properly-fitted call, only exactly the minimum that still counts as one.
_SMALL_REGION_CONFIDENCE = _CALL_MIN_POSTERIOR

# Phase 1 diagnostics (C4): the relative-NTC detector (_NTC_SIGNAL_FRAC below)
# is a signal-level cutoff, not a test of whether that low-signal group is
# actually separated from the real samples by a wide margin. This is the
# minimum gap -- median plate signal vs. the auto-flagged NTC wells' own
# signal -- that counts as a genuine "no-template" gap (one order of
# magnitude). Below this, the wells are still labeled NTC (never invent a new
# label -- see module docstring in tests/test_c4_relative_ntc.py) but flagged
# with the "relative_ntc" warning and a confidence < 1.0.
_NTC_CLEAR_GAP = 10.0


def cluster_threshold(
    points: list[dict],
    config: ThresholdConfig | None = None,
    ploidy: int = DEFAULT_PLOIDY,
) -> dict[str, str]:
    """Threshold labeling by absolute fam-fraction cuts.

    When ``config.boundaries`` is set (the P draggable radial-line positions),
    each well is labeled by dosage via those cuts for the given ``ploidy``.
    Otherwise the legacy diploid two-cutoff behavior is preserved exactly.
    """
    if config is None:
        config = ThresholdConfig()
    validate_ploidy(ploidy)
    cuts = config.boundaries

    assignments: dict[str, str] = {}
    for p in points:
        total = p["norm_fam"] + p["norm_allele2"]
        if total < config.ntc_threshold:
            assignments[p["well"]] = WellType.NTC.value
            continue
        ratio = p["norm_fam"] / total
        if cuts:
            assignments[p["well"]] = label_by_ratio(ratio, ploidy, cuts, config.offset)
        elif ratio > config.allele2_ratio_min:
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
    warnings: list[str] | None = None,
    anchor_state: dict | None = None,
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

    ``warnings``, if given a list, is appended to IN PLACE with non-fatal
    diagnostic codes ("low_n", "relative_ntc", "anchor_conflict" -- see the
    constants above); the return contract is always the ``(assignments,
    confidences)`` 2-tuple regardless of whether ``warnings`` is passed, so
    existing callers are unaffected.

    ``control_wells`` may also mark ALLELE1_CONTROL / ALLELE2_CONTROL wells
    (C1): homozygous reference wells excluded from the fit exactly like NTC /
    Positive Control, but ALSO used to anchor the dosage ladder's extremes --
    the fitted sample cluster nearest an allele-1 control is fixed to dosage
    ``ploidy``, nearest an allele-2 control to dosage 0 -- making the offset
    DETERMINED rather than a guess (see ``_resolve_anchor_dosages``). If an
    anchor sits implausibly far (> ``_OUTLIER_SD`` pooled SDs) from every
    fitted cluster, it is NOT used to override the offset; instead
    ``"anchor_conflict"`` is appended to ``warnings``.

    ``anchor_state``, if given a dict, is updated IN PLACE with
    ``{"resolved": bool}`` -- True when at least one allele-control anchor was
    successfully used to fix the offset (so callers, e.g. ``genotype_window``,
    know the offset is determined rather than an axis-hugging guess). Additive
    and optional; existing callers that don't pass it are unaffected.
    """
    import numpy as np
    from sklearn.mixture import GaussianMixture

    validate_ploidy(ploidy)

    if not points:
        return {}, {}

    control_wells = control_wells or {}
    assignments: dict[str, str] = {}
    confidences: dict[str, float] = {}
    if anchor_state is not None:
        anchor_state.setdefault("resolved", False)

    # Honor user-marked controls (NTC / Positive Control / allele controls) and
    # exclude them from the clustering input so a control can't distort the
    # genotype clusters. Allele-1/Allele-2 control wells (C1) additionally
    # contribute their fam-fraction ratio as a dosage-ladder anchor point,
    # collected here and resolved below (section 3) once the sample clusters
    # are fitted.
    work = []
    anchor1_ratios: list[float] = []  # allele-1 control (homozygous, ratio~1 -> dosage P)
    anchor2_ratios: list[float] = []  # allele-2 control (homozygous, ratio~0 -> dosage 0)
    for p in points:
        ctype = control_wells.get(p["well"])
        if ctype in (
            WellType.NTC.value,
            WellType.POSITIVE_CONTROL.value,
            WellType.ALLELE1_CONTROL.value,
            WellType.ALLELE2_CONTROL.value,
        ):
            assignments[p["well"]] = ctype
            confidences[p["well"]] = 1.0
            if ctype in (WellType.ALLELE1_CONTROL.value, WellType.ALLELE2_CONTROL.value):
                c_total = p["norm_fam"] + p["norm_allele2"]
                c_ratio = p["norm_fam"] / c_total if c_total > 0 else 0.5
                if ctype == WellType.ALLELE1_CONTROL.value:
                    anchor1_ratios.append(c_ratio)
                else:
                    anchor2_ratios.append(c_ratio)
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

    # C4 (conservative, warning-only): the mask above is a pure signal-level
    # cutoff -- it says nothing about whether the flagged wells are actually a
    # genuine no-template gap, or just the low end of a narrow, low-dynamic-
    # range marker. Compare the flagged wells' OWN signal to the plate median
    # they were cut from: a real NTC is orders of magnitude below the samples;
    # anything closer is ambiguous, so it keeps the "NTC" label (never invent a
    # new one) but is flagged and denied a blind maximum-confidence call.
    ntc_confidence = 1.0
    if bool(np.any(ntc_mask)):
        ntc_max_total = float(np.max(total[ntc_mask]))
        gap_ratio = (median_total / ntc_max_total) if ntc_max_total > 0 else float("inf")
        if gap_ratio < _NTC_CLEAR_GAP:
            if warnings is not None:
                warnings.append("relative_ntc")
            ntc_confidence = max(0.0, min(0.99, gap_ratio / _NTC_CLEAR_GAP))

    for w, is_ntc in zip(wells, ntc_mask):
        if is_ntc:
            assignments[w] = WellType.NTC.value
            confidences[w] = ntc_confidence

    sig_idx = [i for i in range(len(wells)) if not ntc_mask[i]]

    # Too few signal wells to cluster reliably — call by absolute ratio.
    if len(sig_idx) < 4:
        # C3: no mixture was fit, so there is no statistical evidence backing
        # a maximum-confidence call -- cap it (see _SMALL_REGION_CONFIDENCE)
        # and flag the marker so a human can review a 1-3 well genotype call.
        if sig_idx and warnings is not None:
            warnings.append("low_n")
        for i in sig_idx:
            assignments[wells[i]] = label_by_ratio(ratio[i], ploidy)
            confidences[wells[i]] = _SMALL_REGION_CONFIDENCE
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

    # Reverse-lookup: arcsine-sqrt (fit-space) value for each GLOBAL well index.
    # Built once here so it can be used both by the merge test right below and by
    # the confidence scoring further down (section 4).
    rt_by_global = {global_i: float(rt[j]) for j, global_i in enumerate(sig_idx)}

    def _local_sd_ratio(lab_a: int, lab_b: int) -> float:
        """Two-sample separation of clusters A/B, in pooled-SD units, computed
        ONLY from A's and B's own member points (never the other, unrelated
        clusters) -- a per-pair Welch/pooled-variance style effect size."""
        a = np.array([rt_by_global[i] for i in members[lab_a]], dtype=float)
        b = np.array([rt_by_global[i] for i in members[lab_b]], dtype=float)
        df = len(a) + len(b) - 2
        if df < 1:
            return float("inf")  # too few samples to judge -- defer to the fixed rule
        var_a = float(a.var(ddof=1)) if len(a) > 1 else 0.0
        var_b = float(b.var(ddof=1)) if len(b) > 1 else 0.0
        pooled_var = ((len(a) - 1) * var_a + (len(b) - 1) * var_b) / df
        pooled_sd = float(np.sqrt(max(pooled_var, 1e-8)))
        gap = abs(float(a.mean()) - float(b.mean()))
        return gap / pooled_sd

    # Merge adjacent clusters that sit far closer than the ideal dosage spacing
    # (1/P): they are one dosage that BIC over-split on noise, not two dosages.
    # Without this the dosage DP below (which forces distinct dosages) would
    # promote a noise-split into a spurious neighbouring dosage class.
    if len(order) > 1:
        min_sep = _DOSAGE_MERGE_FRAC / ploidy

        # C2 fix: a fixed fraction of 1/ploidy is, by construction, always SMALLER
        # than one whole dosage step -- so at high ploidy (small 1/P) a genuinely
        # single, tight distribution can have real replicate noise whose spread
        # approaches or even exceeds that fixed fraction, letting BIC carve it
        # into adjacent "dosage classes" that are noise, not biology (this is
        # exactly what happened to qTotal11.1: ratios ~0.67-0.81 vs a merge
        # threshold of 0.083 at ploidy=6). A threshold tied to the *ideal*
        # spacing can never adapt to the *data's own* measurement noise.
        # So, in addition to the fixed-fraction rule, ALSO merge adjacent
        # clusters when their separation is not statistically meaningful in
        # pooled-SD units -- computed LOCALLY from just that pair's own member
        # points (``_local_sd_ratio`` above), not a global/tied estimate shared
        # across every BIC component. A global tied estimate gets diluted by
        # unrelated, far-away clusters and is easily thrown off by a genuinely
        # wide multi-dosage spread; a per-pair pooled SD is not, so it stays
        # reliable across both a narrow monomorphic marker split by noise and a
        # wide, genuinely multi-dosage one (see tests/test_cluster_auto_c2_narrow_marker.py).
        groups: list[list[int]] = [[order[0]]]
        for lab in order[1:]:
            prev = groups[-1][-1]
            raw_gap = cluster_ratio[lab] - cluster_ratio[prev]
            if raw_gap < min_sep or _local_sd_ratio(prev, lab) < _MERGE_SEP_SD:
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

    # 3b. C1: allele-control anchors, if present, FIX the dosage offset instead
    # of leaving it a guess -- see _resolve_anchor_dosages. Falls back to the
    # existing estimate_window-based assignment (byte-identical to today) when
    # there are no anchors, or none could be used without conflict.
    dosages = None
    if anchor1_ratios or anchor2_ratios:
        dosages = _resolve_anchor_dosages(
            order, members, rt_by_global, cluster_ratio, ploidy,
            anchor1_ratios, anchor2_ratios, warnings,
        )
    if dosages is not None:
        if anchor_state is not None:
            anchor_state["resolved"] = True
    else:
        dosages = _assign_dosages([cluster_ratio[lab] for lab in order], ploidy)
    label_map = {lab: genotype_label(d, ploidy) for lab, d in zip(order, dosages)}

    # 4. Call + confidence from the fitted mixture, evaluated in the SAME
    #    arcsine-sqrt space the clusters were found in (not a raw-ratio margin).
    #    Reconstruct one Gaussian per FINAL dosage cluster (mean + shared pooled
    #    SD, weight = cluster size); each well is assigned to its maximum-posterior
    #    class and the confidence IS that posterior. A well is Undetermined when
    #    the model is unsure: the best posterior is weak (it sits between two
    #    classes) OR it is an outlier many SDs from every class. Both criteria
    #    scale with the fitted spread and ploidy. Genotype is still the ratio, not
    #    the magnitude — a genuine low-signal het stays on its cluster's angle.
    #    (``rt_by_global`` was already built above, ahead of the merge step.)
    tiny_labels = {lab for lab, idxs in members.items() if len(idxs) < 2}

    means: dict[int, float] = {}
    within: list[float] = []
    for lab, idxs in members.items():
        if lab in tiny_labels:
            continue
        vals = np.array([rt_by_global[i] for i in idxs], dtype=float)
        means[lab] = float(vals.mean())
        within.append(float(vals.var()))
    pooled_var = float(np.mean(within)) if within else 1e-4
    sigma = float(np.sqrt(max(pooled_var, 1e-4)))
    live = [lab for lab in members if lab not in tiny_labels]

    for lab, idxs in members.items():
        for i in idxs:
            w = wells[i]
            if lab in tiny_labels or not live:
                assignments[w] = WellType.UNDETERMINED.value
                confidences[w] = 0.0
                continue
            rt_i = rt_by_global[i]
            # Posterior over the live clusters (log weight = log cluster size).
            log_scores = {
                g: np.log(len(members[g])) - 0.5 * ((rt_i - means[g]) / sigma) ** 2
                for g in live
            }
            m = max(log_scores.values())
            exps = {g: np.exp(s - m) for g, s in log_scores.items()}
            z = sum(exps.values())
            post = {g: v / z for g, v in exps.items()}
            best = max(post, key=post.get)
            best_post = float(post[best])
            nearest_sd = min(abs(rt_i - means[g]) / sigma for g in live)
            if nearest_sd > _OUTLIER_SD:
                assignments[w] = WellType.UNDETERMINED.value
                confidences[w] = 0.0
            elif best_post < _CALL_MIN_POSTERIOR:
                assignments[w] = WellType.UNDETERMINED.value
                confidences[w] = best_post
            else:
                assignments[w] = label_map[best]
                confidences[w] = best_post

    return assignments, confidences


def genotype_window(
    points: list[dict],
    assignments: dict[str, str],
    ploidy: int = DEFAULT_PLOIDY,
    anchor_resolved: bool = False,
) -> dict:
    """Describe the OBSERVED dosage window for the draggable-line UI.

    A polyploid marker often resolves only a contiguous SUBSET of the 0..P dosage
    ladder, and its absolute position (offset) is marker-dependent and frequently
    not identifiable from fluorescence alone (e.g. sweetpotato 6x often shows 3
    classes that could be dosages 0,1,2 or 4,5,6). This returns:
      - ``boundaries``: the K-1 internal fam-fraction cuts (descending) between the
        observed classes — the seed positions for the radial lines,
      - ``offset``: the proposed dosage of the lowest observed class,
      - ``offset_uncertain``: True when no observed class sits near an axis
        extreme (r~0 = dosage 0, r~1 = dosage P), so the offset is a guess the
        user should confirm/shift.
    Cuts between two present classes use their empirical midpoint; gaps fall back
    to the equal-spacing ideal ``(d+0.5)/P``.

    ``anchor_resolved`` (C1): True when ``cluster_auto`` already fixed the
    offset from a homozygous allele-control anchor (see
    ``_resolve_anchor_dosages``) -- ``assignments`` was labeled using that
    DETERMINED offset, so this skips its own (independent, ratio-only) offset
    guess and reports the assignments' own lowest present dosage, uncertain
    False. Defaults to False, so a caller that doesn't pass it (or has no
    anchors) gets the exact prior behavior."""
    from app.processing.genotype_vocab import default_ratio_cuts, dosage_of_label

    validate_ploidy(ploidy)
    ratio_by_dosage: dict[int, list[float]] = {}
    for p in points:
        d = dosage_of_label(assignments.get(p["well"], ""), ploidy)
        if d is None:
            continue
        total = p["norm_fam"] + p["norm_allele2"]
        if total > 0:
            ratio_by_dosage.setdefault(d, []).append(p["norm_fam"] / total)

    if not ratio_by_dosage:
        # No genotype calls yet — offer the full ladder, offset 0, flagged uncertain.
        return {"boundaries": default_ratio_cuts(ploidy), "offset": 0, "offset_uncertain": True}

    import statistics as _stats

    centre = {d: _stats.median(rs) for d, rs in ratio_by_dosage.items()}
    present = sorted(centre)
    top = present[-1]

    if anchor_resolved:
        # The offset was already fixed (from a real allele-control anchor, not
        # a ratio guess) -- the lowest dosage assignments were labeled with IS
        # that offset, so just read it back rather than re-deriving a
        # (possibly different) one from the raw ratios alone.
        offset, uncertain = present[0], False
    else:
        # Offset + uncertainty from the same window estimator the auto labeller
        # uses, so the drag-tool seed stays consistent with the auto calls.
        offset, _step, uncertain = estimate_window([centre[d] for d in present], ploidy)

    # Internal cuts across the observed window [offset, top], high-r first
    # (empirical midpoint where both flanking classes are present, else ideal).
    cuts: list[float] = []
    for d in range(top - 1, offset - 1, -1):  # boundary between dosage d and d+1
        if d in centre and (d + 1) in centre:
            cuts.append((centre[d] + centre[d + 1]) / 2.0)
        else:
            cuts.append((d + 0.5) / ploidy)

    # Reliability: at high ploidy adjacent dosage classes are only ~1/P apart, so
    # they may overlap. Flag when any two adjacent PRESENT classes sit closer than
    # _MIN_SEP_SD pooled within-class SDs (in the arcsine-sqrt fit space) — the
    # honest "these dosages aren't cleanly resolvable" signal for the UI.
    low_separation = _window_low_separation(ratio_by_dosage, present)

    return {
        "boundaries": cuts,
        "offset": offset,
        "offset_uncertain": uncertain,
        "low_separation": low_separation,
    }


def _window_low_separation(ratio_by_dosage: dict[int, list[float]], present: list[int]) -> bool:
    import math

    def _t(x: float) -> float:
        return math.asin(math.sqrt(min(max(x, 0.0), 1.0)))

    if len(present) < 2:
        return False
    variances, means = [], {}
    for d in present:
        vals = [_t(r) for r in ratio_by_dosage[d]]
        means[d] = sum(vals) / len(vals)
        if len(vals) >= 2:
            m = means[d]
            variances.append(sum((v - m) ** 2 for v in vals) / (len(vals) - 1))
    pooled_sd = math.sqrt(sum(variances) / len(variances)) if variances else 0.0
    if pooled_sd <= 0:
        return False
    for i in range(len(present) - 1):
        gap = means[present[i + 1]] - means[present[i]]
        if gap < _MIN_SEP_SD * pooled_sd:
            return True
    return False


def estimate_window(sorted_ratios: list[float], ploidy: int) -> tuple[int, int, bool]:
    """Estimate the observed dosage window from cluster ratios (sorted ascending).

    Returns ``(offset, step, uncertain)`` where the K clusters map to dosages
    ``offset, offset+step, ..., offset+(K-1)*step``:
      - ``step`` (dosage units) comes from the median inter-cluster SPACING
        (``round(gap * P)``, >=1): 1 = a contiguous window, 2 = every other dosage.
      - ``offset`` is the arithmetic-progression start that best fits the ratios
        to the ideals ``d/P`` (least squares) — a fit, not just the lowest dosage.
      - ``uncertain`` is True when NO cluster hugs an axis extreme (r~0 = dosage 0,
        r~1 = dosage P), so the absolute position of the window is a guess the
        fluorescence cannot anchor (the sweetpotato "0,1,2 vs 4,5,6" ambiguity).

    This preserves rank order and replaces the old d/P-snapping DP; it handles
    non-contiguous windows via ``step`` and gives a defensible offset + honesty
    flag rather than silently committing to a possibly-wrong absolute dosage."""
    k = len(sorted_ratios)
    if k == 0:
        return 0, 1, True
    edge = 0.5 / ploidy
    low_anchor = sorted_ratios[0] < edge
    high_anchor = sorted_ratios[-1] > 1.0 - edge

    if k == 1:
        offset = max(0, min(ploidy, round(sorted_ratios[0] * ploidy)))
        return offset, 1, not (low_anchor or high_anchor)

    gaps = sorted(sorted_ratios[i + 1] - sorted_ratios[i] for i in range(k - 1))
    med_gap = gaps[len(gaps) // 2]
    step = max(1, round(med_gap * ploidy))
    step = min(step, max(1, ploidy // (k - 1)))  # keep the window inside 0..P

    # Fit the offset in the arcsine-sqrt space the mixture is fitted in (variance-
    # stabilized), so the least-squares match is consistent with where clusters
    # were found rather than in raw ratio.
    import math

    def _t(x: float) -> float:
        return math.asin(math.sqrt(min(max(x, 0.0), 1.0)))

    obs = [_t(r) for r in sorted_ratios]
    max_offset = ploidy - (k - 1) * step
    best_off, best_cost = 0, float("inf")
    for off in range(0, max_offset + 1):
        cost = sum((obs[i] - _t((off + i * step) / ploidy)) ** 2 for i in range(k))
        if cost < best_cost:
            best_cost, best_off = cost, off
    return best_off, step, not (low_anchor or high_anchor)


def _assign_dosages(sorted_ratios: list[float], ploidy: int) -> list[int]:
    """Strictly-increasing allele dosage per cluster ratio (sorted ascending),
    from the estimated observed window (see estimate_window)."""
    offset, step, _ = estimate_window(sorted_ratios, ploidy)
    return [offset + i * step for i in range(len(sorted_ratios))]


def _resolve_anchor_dosages(
    order: list[int],
    members: dict[int, list[int]],
    rt_by_global: dict[int, float],
    cluster_ratio: dict[int, float],
    ploidy: int,
    anchor1_ratios: list[float],
    anchor2_ratios: list[float],
    warnings: list[str] | None,
) -> list[int] | None:
    """C1: fix the dosage offset from homozygous allele-control anchors.

    ``order`` is the final (post-merge) list of fitted sample cluster labels,
    ascending by fam-fraction. An allele-1 control anchors dosage ``ploidy``
    (highest ratio); an allele-2 control anchors dosage 0 (lowest ratio). Each
    anchor is mapped to its NEAREST fitted cluster (in the same arcsine-sqrt
    fit space, in units of the fitted sample population's own pooled SD) and
    that cluster is fixed to the anchor's dosage. If an anchor is implausibly
    far (> ``_OUTLIER_SD`` pooled SDs) from every cluster, it is a conflict --
    ``"anchor_conflict"`` is appended to ``warnings`` and that anchor is NOT
    used (never silently override).

    Returns a dosage list parallel to ``order`` (strictly increasing, so
    rank/label assignment stays consistent with the rest of the module), or
    ``None`` when no anchor could be used -- the caller then falls back to the
    existing (non-anchored) ``_assign_dosages``.
    """
    import math

    import numpy as np

    def _t(x: float) -> float:
        return math.asin(math.sqrt(min(max(x, 0.0), 1.0)))

    cluster_means: dict[int, float] = {
        lab: float(np.mean([rt_by_global[i] for i in idxs])) for lab, idxs in members.items()
    }

    # An allele-control anchor is a DIFFERENT population from the samples --
    # by design it may sit well beyond the fitted sample clusters (that's the
    # whole point: it extends the ladder past what the observed samples show,
    # e.g. a skewed extreme homozygote not otherwise present in this batch).
    # So "far" cannot be judged against tight within-cluster replicate noise
    # (section 4's ``sigma``) -- every legitimate anchor would fail that. It
    # is instead judged against the spread of the FITTED SAMPLE POPULATION AS
    # A WHOLE (every signal well's own fit-space value, pooled): this scales
    # with how widely this marker's own dosage classes already range, so a
    # modestly-further anchor is plausible while one many multiples of the
    # observed spread away is not.
    all_rt = np.array(list(rt_by_global.values()), dtype=float)
    sigma = float(all_rt.std(ddof=1)) if all_rt.size > 1 else 0.0
    if sigma <= 0:
        sigma = 1e-6

    def _nearest(anchor_rt: float) -> tuple[int, float]:
        # cluster_means is always non-empty here (members comes from a fitted
        # GMM with >=1 component over the >=4 signal wells required to reach
        # this point in cluster_auto).
        best_lab: int = next(iter(cluster_means))
        best_d = float("inf")
        for lab, m in cluster_means.items():
            d = abs(anchor_rt - m)
            if d < best_d:
                best_lab, best_d = lab, d
        return best_lab, (best_d / sigma if sigma > 0 else float("inf"))

    forced: dict[int, int] = {}  # cluster label -> forced dosage

    if anchor1_ratios:
        lab, sd = _nearest(float(np.median([_t(r) for r in anchor1_ratios])))
        if sd > _OUTLIER_SD:
            if warnings is not None and "anchor_conflict" not in warnings:
                warnings.append("anchor_conflict")
        else:
            forced[lab] = ploidy

    if anchor2_ratios:
        lab, sd = _nearest(float(np.median([_t(r) for r in anchor2_ratios])))
        if sd > _OUTLIER_SD:
            if warnings is not None and "anchor_conflict" not in warnings:
                warnings.append("anchor_conflict")
        else:
            # Same cluster nearest to both anchors -- degenerate/contradictory,
            # do not force it to both 0 and ploidy.
            if lab in forced and forced[lab] != 0:
                pass
            else:
                forced[lab] = 0

    if not forced:
        return None

    rank = {lab: i for i, lab in enumerate(order)}
    forced_ranks = sorted({(rank[lab], d) for lab, d in forced.items()})

    if len(forced_ranks) == 1:
        r0, d0 = forced_ranks[0]
        # Single anchor: the offset is fixed by the anchor, the spacing
        # between the (unanchored) clusters still comes from the normal
        # gap-based step estimate.
        _off, step, _ = estimate_window([cluster_ratio[lab] for lab in order], ploidy)
        offset = d0 - r0 * step
    else:
        (r0, d0), (r1, d1) = forced_ranks[0], forced_ranks[-1]
        if r1 == r0:
            return None
        step = round((d1 - d0) / (r1 - r0))
        if step < 1:
            return None
        offset = d0 - r0 * step

    dosages = [offset + i * step for i in range(len(order))]
    if any(d < 0 or d > ploidy for d in dosages):
        return None
    if len(set(dosages)) != len(dosages):
        return None
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
        # Diploid label via the central vocabulary (was an inline 0.6/0.4 cut).
        labels[i] = label_by_ratio(ratio, 2, [0.6, 0.4])

    for i in range(n):
        if i not in labels:
            labels[i] = WellType.UNKNOWN.value

    return labels
