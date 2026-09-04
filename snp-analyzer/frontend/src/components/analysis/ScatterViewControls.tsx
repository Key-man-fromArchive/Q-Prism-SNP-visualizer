// Controls that belong next to the scatter plot rather than in the Settings
// tab: how the axes are ranged, what a drag does, where the NTC quadrant sits,
// and whether the values on screen are normalized.
//
// All four were previously either buried in Settings (axis range, ROX toggle)
// or reachable only by dragging a marker that itself sits inside the data
// cloud (NTC corner). Both hosts — the whole-plate ScatterPlot and the
// per-marker MarkerScatterPlot — render this, so the two plots offer the same
// controls; the NTC corner arrives by prop because the plate keeps it in the
// data store while a marker keeps it in its own threshold_config.
import { useEffect, useState } from "react";
import { AlertTriangle, Crosshair, MousePointer2, RotateCcw } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import { useSettingsStore, type AxisMode } from "@/stores/settings-store";
import { normalizationLabel } from "@/lib/channel-labels";
import { roundBound, type AxisBounds } from "@/lib/scatter-axes";
import type { ChannelLabels } from "@/types/api";

export type ScatterCorner = { fam: number; allele2: number };

/** The highest allele dosage this assay can produce, declared by the operator.
 *
 *  A polyploid marker usually resolves only part of its ladder — a hexaploid
 *  assay commonly tops out at dosage 3, so its classes are 0,1,2,3 out of
 *  0..6 — and that ceiling is a property of the assay, known before any plate
 *  is read. Declaring it up front constrains the fit (the class count cannot
 *  exceed dosage_max + 1, and the dosage window cannot run past it) instead of
 *  leaving the position to be guessed per plate and then corrected.
 *
 *  `applied` is the ceiling the backend actually used, `observed*` describe the
 *  window it ended up reporting, so the control can show what the calls were
 *  made under rather than what was last typed. Committed on Apply, never on
 *  every keystroke — a re-cluster per dropdown change is a request storm. */
export type DosageCeiling = {
  ploidy: number;
  /** Ceiling in force, or null when undeclared (the full ladder). */
  applied: number | null;
  /** Lowest observed dosage. */
  observedFrom: number;
  /** Number of observed classes, so the window is observedFrom..+classes-1. */
  observedClasses: number;
  /** The backend could not anchor the window position from the data. */
  uncertain: boolean;
  /** Declare a ceiling, or null to hand it back to the full ladder. */
  onApply: (dosageMax: number | null) => void;
};

export type ScatterViewControlsProps = {
  /** Where the data lies, for "fit to data" and for seeding manual bounds. */
  dataBounds: AxisBounds;
  labels: ChannelLabels;
  /** Explicit NTC quadrant, or null when it is being inferred. */
  ntcCorner: ScatterCorner | null;
  /** The corner in force right now (explicit, or the inferred fallback). */
  effectiveNtcCorner: ScatterCorner;
  onNtcCornerChange: (corner: ScatterCorner | null) => void;
  /** Whether the plotted values really were divided by the passive reference
   *  (from the response, not from the toggle). */
  normalizationApplied: boolean;
  /** Wells whose passive reference the backend would not divide by. */
  roxOutlierWells?: string[];
  /** The run carries a passive reference at all. Without one the toggle can
   *  only ever be a no-op, so it says so instead of pretending. */
  hasNormalizationChannel?: boolean;
  /** Absent for a diploid marker, where the three classes ARE the ladder and
   *  there is nothing to declare. */
  dosageCeiling?: DosageCeiling | null;
};

const AXIS_MODES: AxisMode[] = ["zero", "auto", "manual"];

export function ScatterViewControls({
  dataBounds,
  labels,
  ntcCorner,
  effectiveNtcCorner,
  onNtcCornerChange,
  normalizationApplied,
  roxOutlierWells = [],
  hasNormalizationChannel = true,
  dosageCeiling = null,
}: ScatterViewControlsProps) {
  const { t } = useI18n();
  const axisMode = useSettingsStore((s) => s.axisMode);
  const setAxisMode = useSettingsStore((s) => s.setAxisMode);
  const lockAspect = useSettingsStore((s) => s.lockAspect);
  const setLockAspect = useSettingsStore((s) => s.setLockAspect);
  const scatterTool = useSettingsStore((s) => s.scatterTool);
  const setScatterTool = useSettingsStore((s) => s.setScatterTool);
  const useRox = useSettingsStore((s) => s.useRox);
  const setUseRox = useSettingsStore((s) => s.setUseRox);
  const xMin = useSettingsStore((s) => s.xMin);
  const xMax = useSettingsStore((s) => s.xMax);
  const yMin = useSettingsStore((s) => s.yMin);
  const yMax = useSettingsStore((s) => s.yMax);
  const setAxisRange = useSettingsStore((s) => s.setAxisRange);

  // The dropdown is a DRAFT until Apply -- the operator asked for an explicit
  // commit, and re-clustering on every dropdown change would fire a request
  // per keystroke. Re-seeded whenever the ceiling in force changes (applied
  // here, applied in the marker form, or a different marker selected).
  const ceilingInForce = dosageCeiling
    ? String(dosageCeiling.applied ?? dosageCeiling.ploidy)
    : "";
  const [draftCeiling, setDraftCeiling] = useState(ceilingInForce);
  useEffect(() => {
    setDraftCeiling(ceilingInForce);
  }, [ceilingInForce]);

  const manual = axisMode === "manual";
  const step = Math.max(Math.abs(dataBounds.xMax) / 100, 0.0001);

  const fitToData = () =>
    setAxisRange({
      xMin: roundBound(Math.min(0, dataBounds.xMin)),
      xMax: roundBound(dataBounds.xMax),
      yMin: roundBound(Math.min(0, dataBounds.yMin)),
      yMax: roundBound(dataBounds.yMax),
    });

  const axisModeLabel = (mode: AxisMode) =>
    mode === "zero" ? t.axisModeZero : mode === "auto" ? t.axisModeAuto : t.axisModeManual;

  const numberInput = (
    testId: string,
    value: number,
    onChange: (v: number) => void,
    disabled: boolean
  ) => (
    <input
      type="number"
      data-testid={testId}
      value={Number.isFinite(value) ? value : 0}
      step={step}
      disabled={disabled}
      onChange={(event) => {
        const next = Number(event.target.value);
        if (Number.isFinite(next)) onChange(next);
      }}
      className="w-24 rounded-md border border-border bg-surface px-2 py-1 text-xs text-text disabled:opacity-40"
    />
  );

  return (
    <div
      data-testid="scatter-view-controls"
      className="flex flex-wrap items-end gap-x-4 gap-y-2 rounded-md border border-border bg-bg px-3 py-2"
    >
      {/* What a drag does. Kept first: it is the control that decides whether
          the plot is selectable at all. */}
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-text-muted">{t.scatterToolLabel}</span>
        <div className="flex gap-1" role="group" aria-label={t.scatterToolLabel}>
          <button
            type="button"
            data-testid="scatter-tool-select"
            aria-pressed={scatterTool === "select"}
            onClick={() => setScatterTool("select")}
            className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium ${
              scatterTool === "select"
                ? "border-primary bg-primary text-white"
                : "border-border bg-surface text-text hover:border-primary"
            }`}
          >
            <MousePointer2 size={13} aria-hidden="true" /> {t.scatterToolSelect}
          </button>
          <button
            type="button"
            data-testid="scatter-tool-edit"
            aria-pressed={scatterTool === "edit"}
            onClick={() => setScatterTool("edit")}
            className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium ${
              scatterTool === "edit"
                ? "border-amber-500 bg-amber-500 text-black"
                : "border-border bg-surface text-text hover:border-amber-500"
            }`}
          >
            <Crosshair size={13} aria-hidden="true" /> {t.scatterToolEdit}
          </button>
        </div>
      </div>

      {/* Axis range */}
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-text-muted">{t.axisRangeLabel}</span>
        <div className="flex items-center gap-1">
          <select
            data-testid="axis-mode"
            value={axisMode}
            onChange={(event) => setAxisMode(event.target.value as AxisMode)}
            className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-text"
          >
            {AXIS_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {axisModeLabel(mode)}
              </option>
            ))}
          </select>
          <button
            type="button"
            data-testid="axis-fit-to-data"
            onClick={fitToData}
            className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-text hover:border-primary"
          >
            {t.axisFitToData}
          </button>
          <label className="ml-1 inline-flex items-center gap-1 text-xs text-text">
            <input
              type="checkbox"
              data-testid="axis-lock-aspect"
              checked={lockAspect}
              disabled={manual}
              onChange={(event) => setLockAspect(event.target.checked)}
            />
            {t.axisLockAspect}
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-1 text-xs text-text-muted">
          <span className="w-4">x</span>
          {numberInput("axis-x-min", xMin, (v) => setAxisRange({ xMin: v, xMax, yMin, yMax }), !manual)}
          <span>–</span>
          {numberInput("axis-x-max", xMax, (v) => setAxisRange({ xMin, xMax: v, yMin, yMax }), !manual)}
          <span className="ml-2 w-4">y</span>
          {numberInput("axis-y-min", yMin, (v) => setAxisRange({ xMin, xMax, yMin: v, yMax }), !manual)}
          <span>–</span>
          {numberInput("axis-y-max", yMax, (v) => setAxisRange({ xMin, xMax, yMin, yMax: v }), !manual)}
        </div>
      </div>

      {/* NTC quadrant, by number rather than only by drag */}
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-text-muted">
          {t.ntcQuadrantLabel}
          {!ntcCorner && <span className="ml-1 opacity-70">({t.ntcQuadrantInferred})</span>}
        </span>
        <div className="flex flex-wrap items-center gap-1 text-xs text-text-muted">
          <span>{labels.fam} ≤</span>
          {numberInput(
            "ntc-fam-max",
            roundBound(effectiveNtcCorner.fam),
            (v) => onNtcCornerChange({ fam: v, allele2: effectiveNtcCorner.allele2 }),
            false
          )}
          <span className="ml-1">{labels.allele2} ≤</span>
          {numberInput(
            "ntc-allele2-max",
            roundBound(effectiveNtcCorner.allele2),
            (v) => onNtcCornerChange({ fam: effectiveNtcCorner.fam, allele2: v }),
            false
          )}
          <button
            type="button"
            data-testid="ntc-quadrant-reset"
            disabled={!ntcCorner}
            onClick={() => onNtcCornerChange(null)}
            title={t.ntcQuadrantReset}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-xs text-text hover:border-primary disabled:opacity-40"
          >
            <RotateCcw size={12} aria-hidden="true" /> {t.ntcQuadrantReset}
          </button>
        </div>
      </div>

      {/* The assay's dosage ceiling, declared rather than inferred */}
      {dosageCeiling && dosageCeiling.ploidy > 2 && (
        <div className="flex flex-col gap-1" data-testid="dosage-ceiling">
          <span className="text-xs font-medium text-text-muted">
            {t.dosageMaxLabel}
          </span>
          <div className="flex items-center gap-1">
            <select
              data-testid="dosage-max-select"
              value={draftCeiling}
              onChange={(event) => setDraftCeiling(event.target.value)}
              className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-text"
            >
              {/* Dosage 0 would mean the assay can only ever produce one
                  class, which is not a ceiling anyone sets deliberately. */}
              {Array.from({ length: dosageCeiling.ploidy }, (_, i) => i + 1).map((d) => (
                <option key={d} value={String(d)}>
                  {d}
                </option>
              ))}
            </select>
            <button
              type="button"
              data-testid="dosage-max-apply"
              disabled={draftCeiling === String(dosageCeiling.applied ?? dosageCeiling.ploidy)}
              onClick={() => dosageCeiling.onApply(Number(draftCeiling))}
              className="rounded-md border border-primary bg-primary px-2 py-1 text-xs font-semibold text-white disabled:opacity-40"
            >
              {t.apply}
            </button>
            <button
              type="button"
              data-testid="dosage-max-reset"
              disabled={dosageCeiling.applied === null}
              onClick={() => dosageCeiling.onApply(null)}
              title={t.dosageMaxReset}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-xs text-text hover:border-primary disabled:opacity-40"
            >
              <RotateCcw size={12} aria-hidden="true" /> {t.dosageMaxReset}
            </button>
            {dosageCeiling.uncertain && (
              <span
                data-testid="dosage-window-uncertain"
                title={t.dosageWindowUncertainHint}
                className="text-warning"
              >
                <AlertTriangle size={14} aria-hidden="true" />
              </span>
            )}
          </div>
          {/* What the calls on screen were actually made under, so a stale
              draft in the dropdown can never be mistaken for the result. */}
          <span data-testid="dosage-window-observed" className="text-xs text-text-muted">
            {t.dosageWindowObserved(
              dosageCeiling.observedFrom,
              dosageCeiling.observedFrom + Math.max(dosageCeiling.observedClasses - 1, 0)
            )}
            {" · "}
            {dosageCeiling.applied === null
              ? t.dosageMaxUndeclared(dosageCeiling.ploidy)
              : t.dosageMaxApplied(dosageCeiling.applied)}
          </span>
        </div>
      )}

      {/* Normalization: the toggle, and what the plotted numbers actually are */}
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium text-text-muted">
          {normalizationLabel(labels)}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex items-center gap-1 text-xs text-text">
            <input
              type="checkbox"
              data-testid="scatter-use-rox"
              checked={useRox}
              disabled={!hasNormalizationChannel}
              onChange={(event) => setUseRox(event.target.checked)}
            />
            {t.normalizeByReference}
          </label>
          <span
            data-testid="normalization-state"
            data-applied={normalizationApplied}
            className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
              normalizationApplied
                ? "bg-primary/15 text-primary"
                : "bg-surface text-text-muted"
            }`}
          >
            {normalizationApplied
              ? t.normalizationOn(normalizationLabel(labels))
              : t.normalizationOffRaw}
          </span>
          {roxOutlierWells.length > 0 && (
            <span
              data-testid="rox-outlier-warning"
              title={roxOutlierWells.join(", ")}
              className="rounded-full bg-warning/15 px-2 py-0.5 text-xs font-semibold text-warning"
            >
              {t.roxOutlierWells(roxOutlierWells.length)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
