// @TASK Compare Runs UI - Overlay scatter plot and correlation statistics
// @SPEC SNP Discrimination Analyzer - Compare Tab

import { useEffect, useRef, useState, Fragment } from 'react';
import Plotly from 'plotly.js-dist-min';
import { useSettingsStore } from '@/stores/settings-store';
import { getSessions, getCompareScatter, getCompareStats } from '@/lib/api';
import type {
  SessionListItem,
  CompareScatterResponse,
  CompareStatsResponse,
} from '@/types/api';

export function CompareTab() {
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

    const trace1: any = {
      type: 'scattergl',
      mode: 'markers',
      name: `Run A (${run1.instrument})`,
      x: run1.points.map((p) => p.norm_fam),
      y: run1.points.map((p) => p.norm_allele2),
      text: run1.points.map(
        (p) =>
          `Well: ${p.well}<br>FAM: ${p.norm_fam.toFixed(2)}<br>${run1.allele2_dye}: ${p.norm_allele2.toFixed(2)}`
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
          `Well: ${p.well}<br>FAM: ${p.norm_fam.toFixed(2)}<br>${run2.allele2_dye}: ${p.norm_allele2.toFixed(2)}`
      ),
      hoverinfo: 'text',
      marker: {
        color: '#f59e0b',
        size: 8,
        symbol: 'diamond',
      },
    };

    const layout: any = {
      xaxis: {
        title: 'FAM (Allele 1)',
        gridcolor: '#374151',
        zerolinecolor: '#4b5563',
      },
      yaxis: {
        title: `${run1.allele2_dye} (Allele 2)`,
        gridcolor: '#374151',
        zerolinecolor: '#4b5563',
      },
      plot_bgcolor: '#1f2937',
      paper_bgcolor: '#111827',
      font: { color: '#e5e7eb' },
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

  // Helper to get correlation color
  const getCorrelationColor = (r: number) => {
    if (r >= 0.9) return 'text-green-500';
    if (r >= 0.7) return 'text-amber-500';
    return 'text-red-500';
  };

  return (
    <div className="space-y-4">
      {/* Control Panel */}
      <div className="panel">
        <h2 className="text-lg font-semibold text-text mb-3">Compare Runs</h2>

        {!hasEnoughSessions ? (
          <div className="text-amber-500 text-sm">
            ⚠️ Upload at least 2 files to compare runs
          </div>
        ) : (
          <Fragment>
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <label htmlFor="run-a" className="text-sm text-text-muted">
                  Run A:
                </label>
                <select
                  id="run-a"
                  value={runA}
                  onChange={(e) => setRunA(e.target.value)}
                  className="px-3 py-1.5 border border-border rounded bg-surface text-text text-sm"
                >
                  <option value="">Select run...</option>
                  {sessions.map((s) => (
                    <option key={s.session_id} value={s.session_id}>
                      {s.instrument} ({s.num_wells} wells, {s.num_cycles} cycles)
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-2">
                <label htmlFor="run-b" className="text-sm text-text-muted">
                  Run B:
                </label>
                <select
                  id="run-b"
                  value={runB}
                  onChange={(e) => setRunB(e.target.value)}
                  className="px-3 py-1.5 border border-border rounded bg-surface text-text text-sm"
                >
                  <option value="">Select run...</option>
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
                {isLoading ? 'Comparing...' : 'Compare'}
              </button>
            </div>

            {error && (
              <div className="mt-3 text-red-500 text-sm">❌ {error}</div>
            )}
          </Fragment>
        )}
      </div>

      {/* Results */}
      {scatterData && statsData && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Scatter Plot */}
          <div className="lg:col-span-2 panel">
            <h3 className="text-base font-semibold text-text mb-3">
              Overlay Scatter Plot
            </h3>
            <div ref={plotRef} style={{ height: '400px' }} />
          </div>

          {/* Statistics */}
          <div className="panel">
            <h3 className="text-base font-semibold text-text mb-3">Statistics</h3>

            {/* Run A Stats */}
            <div className="mb-4">
              <h4 className="text-sm font-medium text-text mb-2">
                Run A ({statsData.run1.instrument})
              </h4>
              <table className="w-full text-sm">
                <tbody className="text-text-muted">
                  <tr>
                    <td className="py-1">Wells:</td>
                    <td className="text-right text-text">{statsData.run1.num_wells}</td>
                  </tr>
                  <tr>
                    <td className="py-1">Mean FAM:</td>
                    <td className="text-right text-text">
                      {statsData.run1.mean_fam.toFixed(2)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1">Mean {statsData.run1.allele2_dye}:</td>
                    <td className="text-right text-text">
                      {statsData.run1.mean_allele2.toFixed(2)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1">Std FAM:</td>
                    <td className="text-right text-text">
                      {statsData.run1.std_fam.toFixed(2)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1">Std {statsData.run1.allele2_dye}:</td>
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
                    <td className="py-1">Wells:</td>
                    <td className="text-right text-text">{statsData.run2.num_wells}</td>
                  </tr>
                  <tr>
                    <td className="py-1">Mean FAM:</td>
                    <td className="text-right text-text">
                      {statsData.run2.mean_fam.toFixed(2)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1">Mean {statsData.run2.allele2_dye}:</td>
                    <td className="text-right text-text">
                      {statsData.run2.mean_allele2.toFixed(2)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1">Std FAM:</td>
                    <td className="text-right text-text">
                      {statsData.run2.std_fam.toFixed(2)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1">Std {statsData.run2.allele2_dye}:</td>
                    <td className="text-right text-text">
                      {statsData.run2.std_allele2.toFixed(2)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Correlation */}
            <div className="border-t border-border pt-3">
              <h4 className="text-sm font-medium text-text mb-2">Correlation</h4>
              <table className="w-full text-sm">
                <tbody className="text-text-muted">
                  <tr>
                    <td className="py-1">FAM R:</td>
                    <td
                      className={`text-right font-semibold ${getCorrelationColor(
                        statsData.correlation.fam_r
                      )}`}
                    >
                      {statsData.correlation.fam_r.toFixed(3)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1">{statsData.run1.allele2_dye} R:</td>
                    <td
                      className={`text-right font-semibold ${getCorrelationColor(
                        statsData.correlation.allele2_r
                      )}`}
                    >
                      {statsData.correlation.allele2_r.toFixed(3)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-1">Matched Wells:</td>
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
