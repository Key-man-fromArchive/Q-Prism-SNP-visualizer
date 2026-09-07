import { useI18n } from '@/hooks/use-i18n';
import { useNavigationStore } from '@/stores/navigation-store';
import type { QcResponse } from '@/types/api';
import { QcOnset } from './QcOnset';
import { useAnalysisStore } from '@/stores/analysis-store';

function QcLifecycle({ data }: { data: QcResponse }) {
  const state = useAnalysisStore();
  const { t } = useI18n();
  const status = state.pending ? 'computing' : state.status === 'failed' ? 'failed' : data.analysis_status;
  return <>
    <p>{t.qcAnalysisState(status)}</p>
    {state.inputRevisionRefreshing && <p>{t.resultInputRefreshing}</p>}
    {state.inputRevisionError !== null && <p>{t.resultInputUnknown}</p>}
  </>;
}

function Metrics({ name, values }: { name: string; values: Pick<QcResponse, 'call_rate' | 'n_called' | 'n_total' | 'cluster_separation'> }) {
  const { t } = useI18n();
  return <div><strong>{name}</strong>: {t.callRate(Math.round(values.call_rate * 100))} ({values.n_called}/{values.n_total})
    {values.cluster_separation !== null && <> · {t.sep(values.cluster_separation.toFixed(2))}</>}
  </div>;
}
function CompactCall({ data }: { data: QcResponse }) {
  const { t } = useI18n();
  const marker = useNavigationStore(state => state.marker);
  if (data.judgment_status === 'missing') return null;
  if (data.authoritative !== 'markers') return <span>{t.callRate(Math.round(data.call_rate * 100))} · </span>;
  const selected = data.markers?.find(row => row.id === marker);
  return <span>{selected ? `${selected.name}: ${t.callRate(Math.round(selected.call_rate * 100))}` : t.qcMarkerSummary} · </span>;
}
function Judgment({ data }: { data: QcResponse }) {
  const { t } = useI18n();
  const marker = useNavigationStore(state => state.marker);
  const rows = data.markers ?? [];
  const selected = rows.filter(row => marker === null || row.id === marker);
  return <section aria-label={t.qcJudgment}>
    <p>{t.qcJudgmentState(data.judgment_status)}</p>
    <QcLifecycle data={data} />
    {data.analysis_context && <p>{t.qcCaptured(data.analysis_context.cycle, data.input_revision, data.current_input_revision)}
      {' · '}{t.qcReferenceRequested(data.analysis_context.use_rox)}
      {' · '}{t.qcBasis(data.analysis_context.normalization_applied, data.analysis_context.background)}</p>}
    {data.judgment_status !== 'missing' && (data.authoritative === 'markers'
      ? selected.map(row => <Metrics key={row.id} name={row.name} values={row} />)
      : <Metrics name={t.qcWholeRun} values={data} />)}
    {data.authoritative === 'markers' && selected.length === 0 && <p>{t.qcMarkerUnavailable}</p>}
  </section>;
}
function NtcWells({ data }: { data: QcResponse }) {
  const { t } = useI18n();
  const groups = [
    { label: t.qcFlagged, wells: data.ntc_check.wells.filter(well => well.flagged === true) },
    { label: t.qcUnevaluable, wells: data.ntc_check.wells.filter(well => well.flagged === null) },
  ];
  return <>{groups.map(group => <section role="group" aria-label={group.label} key={group.label}>
    <h4>{group.label} ({group.wells.length})</h4>
    <ul>{group.wells.map(well => <li key={well.well}>{well.well}: {t.qcReason(well.reason)}
      {well.signal !== null && <> · {well.signal.toFixed(2)}</>}</li>)}</ul>
  </section>)}</>;
}
export function QcDetails({ data }: { data: QcResponse }) {
  const { t } = useI18n();
  return <details className="relative text-xs" data-testid="qc-details">
    <summary className="cursor-pointer badge qc-badge" data-testid="ntc-status" data-status={data.ntc_check.status}>
      <CompactCall data={data} />
      {t.qcNtcState(data.ntc_check.status)} · {t.qcJudgmentState(data.judgment_status)}
    </summary>
    <div className="absolute left-0 top-full z-50 mt-2 w-80 max-w-[90vw] max-h-[65vh] overflow-auto rounded border border-border bg-surface p-3 shadow-lg">
      <Judgment data={data} />
      <section aria-label={t.qcPlateNtc} className="mt-3">
        <h3>{t.qcPlateNtc}</h3>
        <p>{t.qcPlateConditions(data.ntc_check.cycle, data.ntc_check.wells.length)}</p>
        <p>{t.qcReferenceRequested(data.ntc_check.use_rox)} · {t.qcBasis(data.ntc_check.normalization_applied, data.ntc_check.background)}</p>
        <NtcWells data={data} />
      </section>
      {data.warnings?.map((warning, index) => <p key={index}>{warning}</p>)}
      <QcOnset />
    </div>
  </details>;
}
