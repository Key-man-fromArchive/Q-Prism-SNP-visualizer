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
import { AlertTriangle, Crosshair, Lock, Maximize2, MousePointer2, RotateCcw, SlidersHorizontal, Unlock } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import { useSettingsStore, type AxisMode, type ScatterAspect } from "@/stores/settings-store";
import { normalizationLabel } from "@/lib/channel-labels";
import { roundBound, type AxisBounds } from "@/lib/scatter-axes";
import type { ChannelLabels } from "@/types/api";
import { useDataStore } from "@/stores/data-store";

export type ScatterCorner = { fam: number; allele2: number };

function ScatterReferenceBasis({ requested, applied }: { requested: boolean; applied: boolean }) {
  const { t } = useI18n();
  const reported = useDataStore(s => s.normalizationReported);
  return <span data-testid="normalization-state" data-applied={applied} data-reported={reported}>{t.scatterReferenceBasis(requested, reported, applied)}</span>;
}

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

const SCATTER_ASPECTS: ScatterAspect[] = ["4:3", "1:1"];

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
  const scatterAspect = useSettingsStore((s) => s.scatterAspect);
  const setScatterAspect = useSettingsStore((s) => s.setScatterAspect);
  const useRox = useSettingsStore((s) => s.useRox);
  const backgroundMode = useSettingsStore((s) => s.backgroundMode);
  const setUseRox = useSettingsStore((s) => s.setUseRox);
  const xMin = useSettingsStore((s) => s.xMin);
  const xMax = useSettingsStore((s) => s.xMax);
  const yMin = useSettingsStore((s) => s.yMin);
  const yMax = useSettingsStore((s) => s.yMax);
  const setAxisRange = useSettingsStore((s) => s.setAxisRange);
  const xNtcOffsetRaw = useSettingsStore((s) => s.xNtcOffsetRaw);
  const yNtcOffsetRaw = useSettingsStore((s) => s.yNtcOffsetRaw);
  const xNtcOffsetNormalized = useSettingsStore((s) => s.xNtcOffsetNormalized);
  const yNtcOffsetNormalized = useSettingsStore((s) => s.yNtcOffsetNormalized);
  const setNtcAxisOffset = useSettingsStore((s) => s.setNtcAxisOffset);
  const resetNtcAxisOffsets = useSettingsStore((s) => s.resetNtcAxisOffsets);
  const offsetBasis: "raw" | "normalized" = normalizationApplied ? "normalized" : "raw";
  const ntcOffsets = normalizationApplied
    ? { x: xNtcOffsetNormalized, y: yNtcOffsetNormalized }
    : { x: xNtcOffsetRaw, y: yNtcOffsetRaw };
  const defaultOffsets = normalizationApplied ? { x: 0.1, y: 0.1 } : { x: 100, y: 100 };
  const offsetsAtDefault = ntcOffsets.x === defaultOffsets.x && ntcOffsets.y === defaultOffsets.y;

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

  // The "Axis settings…" popover IS the request to go manual (FB-04 §3-2):
  // the operator asked for min/max text entry reachable directly, not gated
  // behind first finding and picking "Manual" in the mode dropdown. Visible
  // only while in manual mode, so switching the mode dropdown away closes it
  // instead of leaving disabled inputs open.
  const [axisPopoverOpen, setAxisPopoverOpen] = useState(false);
  const axisPopoverVisible = manual && axisPopoverOpen;
  const toggleAxisSettings = () => {
    if (axisPopoverVisible) {
      setAxisPopoverOpen(false);
      return;
    }
    if (!manual) setAxisMode("manual");
    setAxisPopoverOpen(true);
  };

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
    disabled: boolean,
    inputStep = step,
    ariaLabel?: string,
    minValue?: number,
  ) => (
    <input
      type="number"
      id={testId}
      data-testid={testId}
      value={Number.isFinite(value) ? value : 0}
      step={inputStep}
      min={minValue}
      aria-label={ariaLabel}
      disabled={disabled}
      onChange={(event) => {
        const next = Number(event.target.value);
        if (Number.isFinite(next)) onChange(next);
      }}
      className="w-24 rounded-md border border-border bg-surface px-2 py-1 text-xs text-text disabled:opacity-40"
    />
  );

  const referenceChannelName = normalizationLabel(labels);

  return (
    <div className="mb-2 flex flex-col gap-2">
      {/* The plot header bar: everything decided while looking at the plot
          (drag tool, normalization, axis range/aspect) lives here, always
          visible. It used to share a collapsed <details> with the NTC
          quadrant and dosage ceiling below -- reachable only after
          discovering and expanding "View and calculation settings" (FB-04
          §3-2). Only the low-frequency, expert settings stay collapsed.
          P4-S3-T1 followup: this used to wrap to 2 rows (each group stacked
          a text label over its control row, and the axis-range group alone
          spelled out "Fit to data"/"Equal x/y scale"/"Axis settings…" in
          full) -- pushing the canvas 83px further down the page than right
          after P4-S1-T1. Per-group labels are now `aria-label`s on a
          `role="group"` wrapper (not a visible line), and the three
          axis-range actions are icon-only buttons with the same text as a
          title/aria-label, so all 4 groups fit on one row without losing
          any control or its `data-testid`. */}
      <div
        data-testid="scatter-plot-header"
        className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-border bg-bg px-3 py-2"
      >
        {/* What a drag does. Kept first: it is the control that decides whether
            the plot is selectable at all. */}
        <div className="flex items-center gap-1" role="group" aria-label={t.scatterToolLabel}>
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

        <div className="h-6 w-px bg-border" aria-hidden="true" />

        {/* Normalization: the toggle, which channel it divides by, and
            whether the run even has one to divide by. */}
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label={normalizationLabel(labels)}>
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
          {/* Runtime re-assignment of the reference channel is out of
              scope: the saved session model keeps one reference slot, not
              the full set of collected channels (FB-04 §3-4 Step 2). This
              shows the one channel actually in force. */}
          <select
            data-testid="normalization-channel-select"
            aria-label={t.normalizationChannelLabel}
            value={referenceChannelName}
            disabled={!hasNormalizationChannel}
            onChange={() => {}}
            className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-text disabled:opacity-40"
          >
            <option value={referenceChannelName}>{referenceChannelName}</option>
          </select>
          {!hasNormalizationChannel && (
            <span data-testid="normalization-channel-reason" className="text-xs text-text-muted">
              {t.normalizationChannelUnavailable}
            </span>
          )}
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

        <div className="h-6 w-px bg-border" aria-hidden="true" />

        {/* Axis range */}
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1" role="group" aria-label={t.axisRangeLabel}>
            <select
              data-testid="axis-mode"
              aria-label={t.axisRangeLabel}
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
              title={t.axisFitToData}
              aria-label={t.axisFitToData}
              className="rounded-md border border-border bg-surface p-1.5 text-text hover:border-primary"
            >
              <Maximize2 size={14} aria-hidden="true" />
            </button>
            <button
              type="button"
              data-testid="axis-lock-aspect"
              aria-pressed={lockAspect}
              disabled={manual}
              onClick={() => setLockAspect(!lockAspect)}
              title={t.axisLockAspect}
              aria-label={t.axisLockAspect}
              className={`rounded-md border p-1.5 disabled:opacity-40 ${
                lockAspect
                  ? "border-primary bg-primary text-white"
                  : "border-border bg-surface text-text hover:border-primary"
              }`}
            >
              {lockAspect ? <Lock size={14} aria-hidden="true" /> : <Unlock size={14} aria-hidden="true" />}
            </button>
            {/* "Axis settings…" IS the manual bounds request (FB-04 §3-2,
                user feedback 7ec0ec1e5e8a4870 item 4): opening it commits to
                manual mode instead of asking the operator to find and pick
                "Manual" in the dropdown above first. */}
            <button
              type="button"
              data-testid="axis-settings-toggle"
              aria-expanded={axisPopoverVisible}
              onClick={toggleAxisSettings}
              title={t.axisSettingsButton}
              aria-label={t.axisSettingsButton}
              className={`rounded-md border p-1.5 ${
                axisPopoverVisible
                  ? "border-primary bg-primary text-white"
                  : "border-border bg-surface text-text hover:border-primary"
              }`}
            >
              <SlidersHorizontal size={14} aria-hidden="true" />
            </button>
          </div>
          {axisPopoverVisible && (
            <div
              data-testid="axis-settings-popover"
              className="flex flex-wrap items-center gap-1 rounded-md border border-border bg-surface p-2 text-xs text-text-muted"
            >
              <span className="w-4">x</span>
              {numberInput("axis-x-min", xMin, (v) => setAxisRange({ xMin: v, xMax, yMin, yMax }), false)}
              <span>–</span>
              {numberInput("axis-x-max", xMax, (v) => setAxisRange({ xMin, xMax: v, yMin, yMax }), false)}
              <span className="ml-2 w-4">y</span>
              {numberInput("axis-y-min", yMin, (v) => setAxisRange({ xMin, xMax, yMin: v, yMax }), false)}
              <span>–</span>
              {numberInput("axis-y-max", yMax, (v) => setAxisRange({ xMin, xMax, yMin, yMax: v }), false)}
              <button
                type="button"
                data-testid="axis-settings-close"
                onClick={() => setAxisPopoverOpen(false)}
                className="ml-1 rounded-md border border-border bg-surface px-2 py-1 text-xs text-text hover:border-primary"
              >
                {t.close}
              </button>
            </div>
          )}
        </div>

        <div className="h-6 w-px bg-border" aria-hidden="true" />

        {/* Canvas aspect ratio (P4-S1-T1's settings-store.scatterAspect --
            this is only the control, the state and the CSS geometry it
            drives live there). */}
        <div className="flex items-center gap-1.5" role="group" aria-label={t.scatterAspectLabel}>
          <select
            data-testid="scatter-aspect-select"
            aria-label={t.scatterAspectLabel}
            value={scatterAspect}
            onChange={(event) => setScatterAspect(event.target.value as ScatterAspect)}
            className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-text"
          >
            {SCATTER_ASPECTS.map((aspect) => (
              <option key={aspect} value={aspect}>
                {aspect}
              </option>
            ))}
          </select>
        </div>
      </div>

      <details data-testid="analysis-advanced-settings" className="analysis-advanced-settings">
        {/* P4-S3-T1 followup: axis mode and lock-aspect are dropped from this
            summary -- both are now always visible above (axis-mode select,
            axis-lock-aspect icon toggle), so repeating them here just made
            an already-long line wrap to 2 lines for no new information.
            `ScatterReferenceBasis`'s text/testid are untouched (root E2E
            tests/26-chart-semantics.spec.ts asserts on it directly). */}
        <summary className="cursor-pointer text-xs text-text rounded border border-border p-2">
          {t.analysisAdvancedSettings} · {labels.fam}/{labels.allele2} · <ScatterReferenceBasis requested={useRox} applied={normalizationApplied} /> · {t.chartBackground(backgroundMode)}
          {' · '}{t.ntcAxisOffsetLabel}: {ntcOffsets.x}, {ntcOffsets.y}
          {' · '}{t.analysisNtcMode(ntcCorner !== null)}: {labels.fam} ≤{roundBound(effectiveNtcCorner.fam)}, {labels.allele2} ≤{roundBound(effectiveNtcCorner.allele2)}
        </summary>
        <div
          data-testid="scatter-view-controls"
          className="flex flex-wrap items-end gap-x-4 gap-y-2 rounded-md border border-border bg-bg px-3 py-2"
        >
        {/* The default range starts a small, operator-controlled distance before
            the NTC ratio origin. Raw RFU and normalized values have different
            units, so each basis has its own persisted pair. */}
        <div className="flex flex-col gap-1" data-testid="ntc-axis-offsets">
          <span className="text-xs font-medium text-text-muted">{t.ntcAxisOffsetLabel}</span>
          <div className="flex flex-wrap items-center gap-1 text-xs text-text-muted">
            <label htmlFor="ntc-axis-x-offset">{labels.fam}</label>
            {numberInput(
              "ntc-axis-x-offset",
              ntcOffsets.x,
              (v) => setNtcAxisOffset(offsetBasis, "x", v),
              axisMode !== "zero",
              normalizationApplied ? 0.01 : 10,
              `${labels.fam} ${t.ntcAxisOffsetLabel}`,
              0,
            )}
            <label htmlFor="ntc-axis-y-offset" className="ml-1">{labels.allele2}</label>
            {numberInput(
              "ntc-axis-y-offset",
              ntcOffsets.y,
              (v) => setNtcAxisOffset(offsetBasis, "y", v),
              axisMode !== "zero",
              normalizationApplied ? 0.01 : 10,
              `${labels.allele2} ${t.ntcAxisOffsetLabel}`,
              0,
            )}
            <button
              type="button"
              data-testid="ntc-axis-offset-reset"
              disabled={offsetsAtDefault}
              onClick={() => resetNtcAxisOffsets(offsetBasis)}
              title={t.ntcAxisOffsetReset}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-xs text-text hover:border-primary disabled:opacity-40"
            >
              <RotateCcw size={12} aria-hidden="true" /> {t.ntcAxisOffsetReset}
            </button>
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
        </div>
      </details>
    </div>
  );
}
