import { useI18n } from '@/hooks/use-i18n';
import { channelLabels } from '@/lib/channel-labels';
import { clampQcFraction, DEFAULT_QC_FRACTION, qcSummaryParts } from '@/lib/amplification-qc';
import { useAnalysisStore } from '@/stores/analysis-store';
import { useDataStore } from '@/stores/data-store';
import { useSettingsStore } from '@/stores/settings-store';

function fractionText(fraction: number): string {
  return Math.abs(fraction - DEFAULT_QC_FRACTION) < 0.005 ? '1/3' : `${Math.round(fraction * 100)}%`;
}

function parseThreshold(raw: string): number | null {
  if (raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** One line stating which amplification thresholds the last analysis applied; in expert mode also the controls to change them. */
export function AmplificationQcSummary() {
  const { t } = useI18n();
  const qc = useAnalysisStore((s) => s.result?.amplification_qc);
  const allele2Dye = useDataStore((s) => s.allele2Dye);
  const roleLabels = useDataStore((s) => s.channelLabels);
  const expert = useSettingsStore((s) => s.expertMode);
  const settings = useSettingsStore((s) => s.amplificationQc);
  const setQc = useSettingsStore((s) => s.setAmplificationQc);
  const labels = channelLabels({ channel_labels: roleLabels ?? undefined }, allele2Dye);

  const parts = qcSummaryParts(qc, { fam: 'FAM', allele2: allele2Dye || labels.allele2 });
  const checkedOff = (qc && !qc.enabled) || (!qc && !settings.enabled);
  const sourceText = !parts ? '' : parts.source === 'manual' ? t.ampQcSourceManual
    : parts.source === 'mixed' ? t.ampQcSourceMixed : t.ampQcSourceAuto(fractionText(qc?.fraction ?? settings.fraction));
  const summary = parts && parts.channels.length > 0
    ? `${t.ampQcTitle} ${parts.channels.map((c) => `${c.label} ≥ ${c.value}`).join(' · ')} (${sourceText})`
    : checkedOff ? t.ampQcOff : null;

  if (!summary && !expert) return null;
  return (
    <div className="panel" data-testid="amplification-qc-card">
      {summary && <p data-testid="amplification-qc-summary" className="text-xs text-text-muted">{summary}</p>}
      {expert && (
        <div data-testid="amplification-qc-controls" className="mt-2 flex flex-wrap items-end gap-3 text-xs text-text">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" data-testid="qc-enabled" checked={settings.enabled}
              onChange={(e) => setQc({ enabled: e.target.checked })} />
            {t.ampQcEnabled}
          </label>
          <label className="flex flex-col gap-0.5">
            {t.ampQcFraction}: {settings.fraction.toFixed(2)}
            <input type="range" data-testid="qc-fraction" min={0.05} max={0.9} step={0.05} disabled={!settings.enabled}
              value={settings.fraction} className="w-32"
              onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) setQc({ fraction: clampQcFraction(v) }); }} />
          </label>
          <label className="flex flex-col gap-0.5">
            {t.ampQcThresholdInput(labels.fam)}
            <input type="number" data-testid="qc-fam-threshold" min={0} step={0.1} disabled={!settings.enabled}
              value={settings.famThreshold ?? ''} className="w-24 rounded border border-border bg-surface px-1.5 py-1"
              onChange={(e) => setQc({ famThreshold: parseThreshold(e.target.value) })} />
          </label>
          <label className="flex flex-col gap-0.5">
            {t.ampQcThresholdInput(labels.allele2)}
            <input type="number" data-testid="qc-allele2-threshold" min={0} step={0.1} disabled={!settings.enabled}
              value={settings.allele2Threshold ?? ''} className="w-24 rounded border border-border bg-surface px-1.5 py-1"
              onChange={(e) => setQc({ allele2Threshold: parseThreshold(e.target.value) })} />
          </label>
        </div>
      )}
    </div>
  );
}
