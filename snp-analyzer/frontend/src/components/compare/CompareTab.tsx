// @TASK Compare Runs UI - Overlay scatter plot and correlation statistics
// @SPEC SNP Discrimination Analyzer - Compare Tab

import { useEffect, useRef, Fragment } from 'react';
import { AlertTriangle } from 'lucide-react';
import Plotly from 'plotly.js-dist-min';
import type { Data, Layout, Config } from 'plotly.js';
import { useSettingsStore } from '@/stores/settings-store';
import { useI18n } from '@/hooks/use-i18n';
import { comparisonRunLabel, useComparison } from './use-comparison';
import { useAuthStore } from '@/stores/auth-store';
import { useSessionStore } from '@/stores/session-store';
import { channelLabels } from '@/lib/channel-labels';
import { plotlyColors } from '@/lib/plotly-theme';

export function CompareTab() {
  const owner = useAuthStore(s => s.generation);
  const entry = useSessionStore(s => s.entryGeneration);
  return <CompareWorkspace key={`${owner}:${entry}`} />;
}

function CompareWorkspace() {
  const { t } = useI18n();
  const plotRef = useRef<HTMLDivElement>(null);
  const useRox = useSettingsStore((s) => s.useRox);
  const { sessions, listState, load, runA, runB, setRunA, setRunB, phase, result, compare: handleCompare } = useComparison(useRox);
  const scatterData = result?.scatter, statsData = result?.stats;
  const names = result?.names;
  const isLoading = phase === 'loading';

  // Render scatter plot
  useEffect(() => {
    if (!plotRef.current || !scatterData) return;
    const plot = plotRef.current;

    const { run1, run2 } = scatterData;
    const run1Labels = channelLabels(run1, run1.allele2_dye);
    const run2Labels = channelLabels(run2, run2.allele2_dye);

    const trace1: Data = {
      type: 'scattergl',
      mode: 'markers',
      name: `${t.runA} ${names?.[0]}`,
      x: run1.points.map((p) => p.norm_fam),
      y: run1.points.map((p) => p.norm_allele2),
      text: run1.points.map(
        (p) =>
          `Well: ${p.well}<br>${run1Labels.fam}: ${p.norm_fam.toFixed(2)}<br>${run1Labels.allele2}: ${p.norm_allele2.toFixed(2)}`
      ),
      hoverinfo: 'text',
      marker: {
        color: '#2563eb',
        size: 8,
        symbol: 'circle',
      },
    };

    const trace2: Data = {
      type: 'scattergl',
      mode: 'markers',
      name: `${t.runB} ${names?.[1]}`,
      x: run2.points.map((p) => p.norm_fam),
      y: run2.points.map((p) => p.norm_allele2),
      text: run2.points.map(
        (p) =>
          `Well: ${p.well}<br>${run2Labels.fam}: ${p.norm_fam.toFixed(2)}<br>${run2Labels.allele2}: ${p.norm_allele2.toFixed(2)}`
      ),
      hoverinfo: 'text',
      marker: {
        color: '#f59e0b',
        size: 8,
        symbol: 'diamond',
      },
    };

    const c = plotlyColors();
    const layout: Partial<Layout> = {
      xaxis: {
        title: { text: run1Labels.fam },
        gridcolor: c.gridColor,
        zerolinecolor: c.lineColor,
      },
      yaxis: {
        title: { text: run1Labels.allele2 },
        gridcolor: c.gridColor,
        zerolinecolor: c.lineColor,
      },
      plot_bgcolor: c.plot_bgcolor,
      paper_bgcolor: c.paper_bgcolor,
      font: { color: c.fontColor },
      showlegend: true,
      legend: {
        x: 1,
        xanchor: 'right',
        y: 1,
      },
      margin: { l: 60, r: 40, t: 40, b: 60 },
    };

    const config: Partial<Config> = {
      responsive: true,
      displayModeBar: true,
      displaylogo: false,
    };

    Plotly.newPlot(plot, [trace1, trace2], layout, config);

    return () => {
      Plotly.purge(plot);
    };
  }, [scatterData, names, t.runA, t.runB]);

  const canCompare = runA && runB && runA !== runB;
  const hasEnoughSessions = sessions.length >= 2;
  const statsRun1Labels = statsData ? channelLabels(statsData.run1, statsData.run1.allele2_dye) : null;
  const statsRun2Labels = statsData ? channelLabels(statsData.run2, statsData.run2.allele2_dye) : null;

  // Helper to get correlation color
  const getCorrelationColor = (r: number | null) => {
    if (r === null) return 'text-text-muted';
    if (r >= 0.9) return 'text-success';
    if (r >= 0.7) return 'text-warning';
    return 'text-danger';
  };

  return (
    <div className="space-y-4 p-4 min-w-0">
      {/* Control Panel */}
      <div className="panel">
        <h2 className="text-lg font-semibold text-text mb-3">{t.compareRuns}</h2>

        <ComparisonFeedback listState={listState} phase={phase} reload={load} />
        {listState === 'ready' && (!hasEnoughSessions ? (
          <div className="text-warning text-sm flex items-center gap-1.5">
            <AlertTriangle size={14} aria-hidden="true" /> {t.uploadAtLeast2}
          </div>
        ) : (
          <Fragment>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2 min-w-0 max-w-full">
                <label htmlFor="run-a" className="text-sm text-text-muted">
                  {t.runA}
                </label>
                <select
                  id="run-a"
                  value={runA}
                  onChange={(e) => setRunA(e.target.value)}
                  className="min-w-0 max-w-full px-3 py-1.5 border border-border rounded bg-surface text-text text-sm"
                >
                  <option value="">{t.selectRun}</option>
                  {sessions.map((s) => (
                    <option key={s.session_id} value={s.session_id}>
                      {comparisonRunLabel(s)}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2 min-w-0 max-w-full">
                <label htmlFor="run-b" className="text-sm text-text-muted">
                  {t.runB}
                </label>
                <select
                  id="run-b"
                  value={runB}
                  onChange={(e) => setRunB(e.target.value)}
                  className="min-w-0 max-w-full px-3 py-1.5 border border-border rounded bg-surface text-text text-sm"
                >
                  <option value="">{t.selectRun}</option>
                  {sessions.map((s) => (
                    <option key={s.session_id} value={s.session_id}>
                      {comparisonRunLabel(s)}
                    </option>
                  ))}
                </select>
              </div>

              <button
                onClick={handleCompare}
                disabled={!canCompare || isLoading}
                className="px-4 py-1.5 bg-primary text-white rounded text-sm font-medium disabled:opacity-50"
              >
                {isLoading ? t.comparing : t.compare}
              </button>
            </div>

          </Fragment>
        ))}
      </div>

      {/* Results */}
      {scatterData && statsData && statsRun1Labels && statsRun2Labels && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Scatter Plot */}
          <div className="lg:col-span-2 panel" role="region" aria-label={`${t.overlayScatterPlot}: ${names?.[0]} — ${names?.[1]}`}>
            <h3 className="text-base font-semibold text-text mb-3">
              {t.overlayScatterPlot}
            </h3>
            <div
              ref={plotRef}
              role="img"
              aria-label={`${t.overlayScatterPlot}: ${names?.[0]} — ${names?.[1]}`}
              style={{ height: '400px' }}
            />
          </div>

          {/* Statistics */}
          <div className="panel">
            <h3 className="text-base font-semibold text-text mb-3">{t.statistics}</h3>

            {/* Run A Stats */}
            <div className="mb-4">
              <h4 className="text-sm font-medium text-text mb-2">
                {t.runA} {names?.[0]}
              </h4>
              <table className="w-full text-sm">
                <tbody className="text-text-muted">
                  <tr>
                    <td className="py-1">{t.wells}:</td>
                    <td className="text-right text-text">{statsData.run1.n_wells}</td>
                  </tr>
                  <tr>
                    <td className="py-1">Mean {statsRun1Labels.fam}:</td>
                    <td className="text-right text-text">
                      {statsData.run1.mean_fam.toFixed(2)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1">Mean {statsRun1Labels.allele2}:</td>
                    <td className="text-right text-text">
                      {statsData.run1.mean_allele2.toFixed(2)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1">Std {statsRun1Labels.fam}:</td>
                    <td className="text-right text-text">
                      {statsData.run1.std_fam.toFixed(2)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1">Std {statsRun1Labels.allele2}:</td>
                    <td className="text-right text-text">
                      {statsData.run1.std_allele2.toFixed(2)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Run B Stats */}
            <div className="mb-4">
              <h4 className="text-sm font-medium text-text mb-2">
                {t.runB} {names?.[1]}
              </h4>
              <table className="w-full text-sm">
                <tbody className="text-text-muted">
                  <tr>
                    <td className="py-1">{t.wells}:</td>
                    <td className="text-right text-text">{statsData.run2.n_wells}</td>
                  </tr>
                  <tr>
                    <td className="py-1">Mean {statsRun2Labels.fam}:</td>
                    <td className="text-right text-text">
                      {statsData.run2.mean_fam.toFixed(2)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1">Mean {statsRun2Labels.allele2}:</td>
                    <td className="text-right text-text">
                      {statsData.run2.mean_allele2.toFixed(2)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1">Std {statsRun2Labels.fam}:</td>
                    <td className="text-right text-text">
                      {statsData.run2.std_fam.toFixed(2)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1">Std {statsRun2Labels.allele2}:</td>
                    <td className="text-right text-text">
                      {statsData.run2.std_allele2.toFixed(2)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Correlation */}
            <div className="border-t border-border pt-3">
              <h4 className="text-sm font-medium text-text mb-2">{t.correlation}</h4>
              <table className="w-full text-sm">
                <tbody className="text-text-muted">
                  <tr>
                    <td className="py-1">{statsRun1Labels.fam} R:</td>
                    <td
                      className={`text-right font-semibold ${getCorrelationColor(
                        statsData.correlation.fam_r
                      )}`}
                    >
                      {statsData.correlation.fam_r?.toFixed(3) ?? t.compareUnavailable}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1">{statsRun1Labels.allele2} R:</td>
                    <td
                      className={`text-right font-semibold ${getCorrelationColor(
                        statsData.correlation.allele2_r
                      )}`}
                    >
                      {statsData.correlation.allele2_r?.toFixed(3) ?? t.compareUnavailable}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1">{t.matchedWells}</td>
                    <td className="text-right text-text">
                      {statsData.correlation.n_matched_wells}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ComparisonFeedback({ listState, phase, reload }: { listState: string; phase: string; reload: () => Promise<void> }) {
  const { t } = useI18n();
  if (listState === 'loading') return <p role="status">{t.loading}</p>;
  if (listState === 'error') return <div role="alert">{t.errLoadSessions} <button type="button" onClick={reload}>{t.retry}</button></div>;
  if (phase === 'error') return <p role="alert">{t.errCompareRuns}</p>;
  return null;
}
