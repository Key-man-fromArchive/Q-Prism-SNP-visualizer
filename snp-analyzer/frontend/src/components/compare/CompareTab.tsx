// @TASK Compare Runs UI - Overlay scatter plot and correlation statistics
// @SPEC SNP Discrimination Analyzer - Compare Tab

import { useEffect, useRef, useState, Fragment } from 'react';
import { AlertTriangle } from 'lucide-react';
import Plotly from 'plotly.js-dist-min';
import { useSettingsStore } from '@/stores/settings-store';
import { useI18n } from '@/hooks/use-i18n';
import { getSessions, getCompareScatter, getCompareStats } from '@/lib/api';
import { channelLabels } from '@/lib/channel-labels';
import { plotlyColors } from '@/lib/plotly-theme';
import type {
  SessionListItem,
  CompareScatterResponse,
  CompareStatsResponse,
} from '@/types/api';

export function CompareTab() {
  const { t } = useI18n();
  const plotRef = useRef<HTMLDivElement>(null);
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [runA, setRunA] = useState<string>('');
  const [runB, setRunB] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [scatterData, setScatterData] = useState<CompareScatterResponse | null>(null);
  const [statsData, setStatsData] = useState<CompareStatsResponse | null>(null);
  const [error, setError] = useState<string>('');

  const useRox = useSettingsStore((s) => s.useRox);

  // Fetch sessions on mount
  useEffect(() => {
    const loadSessions = async () => {
      try {
        const data = await getSessions();
        setSessions(data);
      } catch (err) {
        console.error('Failed to load sessions:', err);
        setError('Failed to load sessions');
      }
    };
    loadSessions();
  }, []);

  // Handle compare button click
  const handleCompare = async () => {
    if (!runA || !runB || runA === runB) return;

    setIsLoading(true);
    setError('');
    setScatterData(null);
    setStatsData(null);

    try {
      const [scatter, stats] = await Promise.all([
        getCompareScatter(runA, runB, undefined, undefined, useRox),
        getCompareStats(runA, runB, undefined, undefined, useRox),
      ]);

      setScatterData(scatter);
      setStatsData(stats);
    } catch (err) {
      console.error('Compare failed:', err);
      setError(err instanceof Error ? err.message : 'Failed to compare runs');
    } finally {
      setIsLoading(false);
    }
  };

  // Render scatter plot
  useEffect(() => {
    if (!plotRef.current || !scatterData) return;

    const { run1, run2 } = scatterData;
    const run1Labels = channelLabels(run1, run1.allele2_dye);
    const run2Labels = channelLabels(run2, run2.allele2_dye);

    const trace1: any = {
      type: 'scattergl',
      mode: 'markers',
      name: `Run A (${run1.instrument})`,
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

    const trace2: any = {
      type: 'scattergl',
      mode: 'markers',
      name: `Run B (${run2.instrument})`,
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
    const layout: any = {
      xaxis: {
        title: run1Labels.fam,
        gridcolor: c.gridColor,
        zerolinecolor: c.lineColor,
      },
      yaxis: {
        title: run1Labels.allele2,
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

    const config: any = {
      responsive: true,
      displayModeBar: true,
      displaylogo: false,
    };

    Plotly.newPlot(plotRef.current, [trace1, trace2], layout, config);

    return () => {
      if (plotRef.current) {
        Plotly.purge(plotRef.current);
      }
    };
  }, [scatterData]);

  const canCompare = runA && runB && runA !== runB;
  const hasEnoughSessions = sessions.length >= 2;
  const statsRun1Labels = statsData ? channelLabels(statsData.run1, statsData.run1.allele2_dye) : null;
  const statsRun2Labels = statsData ? channelLabels(statsData.run2, statsData.run2.allele2_dye) : null;

  // Helper to get correlation color
  const getCorrelationColor = (r: number) => {
    if (r >= 0.9) return 'text-success';
    if (r >= 0.7) return 'text-warning';
    return 'text-danger';
  };

  return (
    <div className="space-y-4">
      {/* Control Panel */}
      <div className="panel">
        <h2 className="text-lg font-semibold text-text mb-3">{t.compareRuns}</h2>

        {!hasEnoughSessions ? (
          <div className="text-warning text-sm flex items-center gap-1.5">
            <AlertTriangle size={14} aria-hidden="true" /> {t.uploadAtLeast2}
          </div>
        ) : (
          <Fragment>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <label htmlFor="run-a" className="text-sm text-text-muted">
                  {t.runA}
                </label>
                <select
                  id="run-a"
                  value={runA}
                  onChange={(e) => setRunA(e.target.value)}
                  className="px-3 py-1.5 border border-border rounded bg-surface text-text text-sm"
                >
                  <option value="">{t.selectRun}</option>
                  {sessions.map((s) => (
                    <option key={s.session_id} value={s.session_id}>
                      {s.instrument} ({s.num_wells} wells, {s.num_cycles} cycles)
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2">
                <label htmlFor="run-b" className="text-sm text-text-muted">
                  {t.runB}
                </label>
                <select
                  id="run-b"
                  value={runB}
                  onChange={(e) => setRunB(e.target.value)}
                  className="px-3 py-1.5 border border-border rounded bg-surface text-text text-sm"
                >
                  <option value="">{t.selectRun}</option>
                  {sessions.map((s) => (
                    <option key={s.session_id} value={s.session_id}>
                      {s.instrument} ({s.num_wells} wells, {s.num_cycles} cycles)
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

            {error && (
              <div className="mt-3 text-danger text-sm">❌ {error}</div>
            )}
          </Fragment>
        )}
      </div>

      {/* Results */}
      {scatterData && statsData && statsRun1Labels && statsRun2Labels && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Scatter Plot */}
          <div className="lg:col-span-2 panel">
            <h3 className="text-base font-semibold text-text mb-3">
              {t.overlayScatterPlot}
            </h3>
            <div ref={plotRef} style={{ height: '400px' }} />
          </div>

          {/* Statistics */}
          <div className="panel">
            <h3 className="text-base font-semibold text-text mb-3">{t.statistics}</h3>

            {/* Run A Stats */}
            <div className="mb-4">
              <h4 className="text-sm font-medium text-text mb-2">
                Run A ({statsData.run1.instrument})
              </h4>
              <table className="w-full text-sm">
                <tbody className="text-text-muted">
                  <tr>
                    <td className="py-1">{t.wells}:</td>
                    <td className="text-right text-text">{statsData.run1.num_wells}</td>
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
                Run B ({statsData.run2.instrument})
              </h4>
              <table className="w-full text-sm">
                <tbody className="text-text-muted">
                  <tr>
                    <td className="py-1">{t.wells}:</td>
                    <td className="text-right text-text">{statsData.run2.num_wells}</td>
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
                      {statsData.correlation.fam_r.toFixed(3)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1">{statsRun1Labels.allele2} R:</td>
                    <td
                      className={`text-right font-semibold ${getCorrelationColor(
                        statsData.correlation.allele2_r
                      )}`}
                    >
                      {statsData.correlation.allele2_r.toFixed(3)}
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
