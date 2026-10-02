import { useMemo } from 'react';
import { NO_AMPLIFICATION } from '@/lib/constants';
import { useAnalysisStore } from '@/stores/analysis-store';
import type { AmplificationQcConfig, AmplificationQcResult } from '@/types/api';

export { NO_AMPLIFICATION };

export const DEFAULT_QC_FRACTION = 1 / 3;
export const QC_FRACTION_MIN = 0.05;
export const QC_FRACTION_MAX = 0.9;

/** The operator's amplification-check choices, kept in the settings store. */
export type AmplificationQcSettings = {
  enabled: boolean;
  fraction: number;
  famThreshold: number | null;
  allele2Threshold: number | null;
};

export const DEFAULT_QC_SETTINGS: AmplificationQcSettings = {
  enabled: true, fraction: DEFAULT_QC_FRACTION, famThreshold: null, allele2Threshold: null,
};

const EMPTY: ReadonlySet<string> = new Set();

export function noAmplificationSet(qc: AmplificationQcResult | null | undefined): ReadonlySet<string> {
  if (!qc || !qc.enabled || !qc.available || qc.no_amplification_wells.length === 0) return EMPTY;
  return new Set(qc.no_amplification_wells);
}

/** Wells of the latest analysis that the amplification check flagged. */
export function useNoAmplificationWells(): ReadonlySet<string> {
  const qc = useAnalysisStore((s) => s.result?.amplification_qc);
  return useMemo(() => noAmplificationSet(qc), [qc]);
}

type CallRow = { well: string; auto_cluster: string | null };

/** Shows flagged wells that have no real call as `NO_AMPLIFICATION`; returns the input when none apply. */
export function markNoAmplification<T extends CallRow>(rows: readonly T[], flagged: ReadonlySet<string>): readonly T[] {
  if (flagged.size === 0) return rows;
  return rows.map((row) => flagged.has(row.well) && (row.auto_cluster === null || row.auto_cluster === 'Undetermined')
    ? { ...row, auto_cluster: NO_AMPLIFICATION }
    : row);
}

/** True when the call is the display-only no-amplification call. */
export function isNoAmplification(call: string | null | undefined): boolean {
  return call === NO_AMPLIFICATION;
}

/** Request field for the stored choices; absent at the defaults so unchanged requests stay unchanged. */
export function qcConfigFromSettings(s: AmplificationQcSettings): AmplificationQcConfig | undefined {
  if (s.enabled && s.fraction === DEFAULT_QC_FRACTION && s.famThreshold === null && s.allele2Threshold === null) return undefined;
  return { enabled: s.enabled, fraction: s.fraction, fam_threshold: s.famThreshold, allele2_threshold: s.allele2Threshold };
}

export function clampQcFraction(value: number): number {
  return Math.min(QC_FRACTION_MAX, Math.max(QC_FRACTION_MIN, value));
}

/** Applied thresholds with the run's real channel labels; null when the check did not run. */
export function qcSummaryParts(
  qc: AmplificationQcResult | null | undefined,
  labels: { fam: string; allele2: string },
): { channels: { label: string; value: string }[]; source: AmplificationQcResult['source'] } | null {
  if (!qc || !qc.enabled || !qc.available) return null;
  const channels = [
    { label: labels.fam, value: qc.fam_threshold },
    { label: labels.allele2, value: qc.allele2_threshold },
  ].filter((c): c is { label: string; value: number } => c.value !== null)
    .map((c) => ({ label: c.label, value: c.value.toFixed(2) }));
  return { channels, source: qc.source };
}
