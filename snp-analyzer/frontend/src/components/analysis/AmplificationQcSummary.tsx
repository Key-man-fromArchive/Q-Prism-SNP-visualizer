import { useI18n } from '@/hooks/use-i18n';
import { channelLabels } from '@/lib/channel-labels';
import { clampQcFraction, DEFAULT_QC_FRACTION, qcSummaryParts } from '@/lib/amplification-qc';
import { useAnalysisStore } from '@/stores/analysis-store';
import { useDataStore } from '@/stores/data-store';
import { useSessionQc } from '@/stores/qc-ui-store';
import { useSettingsStore } from '@/stores/settings-store';

function fractionText(fraction: number): string {
  return Math.abs(fraction - DEFAULT_QC_FRACTION) < 0.005 ? '1/3' : `${Math.round(fraction * 100)}%`;
}

function parseThreshold(raw: string): number | null {
  if (raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

const INPUT_CLASS = 'w-28 rounded border border-border bg-surface px-1.5 py-1';

/** One line stating which amplification thresholds the last analysis applied; in expert mode also a collapsed editor for them. */
export function AmplificationQcSummary() {
  const { t } = useI18n();
  const qc = useAnalysisStore((s) => s.result?.amplification_qc);
  const allele2Dye = useDataStore((s) => s.allele2Dye);
  const roleLabels = useDataStore((s) => s.channelLabels);
  const expert = useSettingsStore((s) => s.expertMode);
  const { settings, setSettings: setQc, open, setOpen } = useSessionQc();
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
      <div className="flex items-center justify-between gap-2">
        <p data-testid="amplification-qc-summary" className="min-w-0 truncate text-xs text-text-muted">{summary ?? t.ampQcTitle}</p>
        {expert && (
          <button type="button" data-testid="qc-adjust" aria-expanded={open} onClick={() => setOpen(!open)}
            className="shrink-0 rounded border border-border px-2 py-0.5 text-xs text-text">{t.ampQcAdjust}</button>
        )}
      </div>
      {expert && open && (
        <div data-testid="amplification-qc-controls"
          className="mt-2 grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2 text-xs text-text">
          <label htmlFor="qc-enabled" className="col-span-2 flex items-center gap-1.5">
            <input id="qc-enabled" type="checkbox" data-testid="qc-enabled" checked={settings.enabled}
              onChange={(e) => setQc({ enabled: e.target.checked })} />
            {t.ampQcEnabled}
          </label>
          <label htmlFor="qc-fraction">{t.ampQcFraction}</label>
          <span className="flex items-center gap-2">
            <input id="qc-fraction" type="range" data-testid="qc-fraction" min={0.05} max={0.9} step={0.05} disabled={!settings.enabled}
              value={settings.fraction} className="w-28"
              onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) setQc({ fraction: clampQcFraction(v) }); }} />
            <span className="w-9 text-right tabular-nums">{settings.fraction.toFixed(2)}</span>
          </span>
          <label htmlFor="qc-fam-threshold">{t.ampQcThresholdInput(labels.fam)}</label>
          <input id="qc-fam-threshold" type="number" data-testid="qc-fam-threshold" min={0} step={0.1} disabled={!settings.enabled}
            value={settings.famThreshold ?? ''} className={INPUT_CLASS}
            onChange={(e) => setQc({ famThreshold: parseThreshold(e.target.value) })} />
          <label htmlFor="qc-allele2-threshold">{t.ampQcThresholdInput(labels.allele2)}</label>
          <input id="qc-allele2-threshold" type="number" data-testid="qc-allele2-threshold" min={0} step={0.1} disabled={!settings.enabled}
            value={settings.allele2Threshold ?? ''} className={INPUT_CLASS}
            onChange={(e) => setQc({ allele2Threshold: parseThreshold(e.target.value) })} />
        </div>
      )}
    </div>
  );
}
