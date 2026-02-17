import { useEffect, useState } from 'react';
import { useSessionStore } from '@/stores/session-store';
import { useSettingsStore } from '@/stores/settings-store';
import { getQuality } from '@/lib/api';
import type { QualityResponse, QualityResult } from '@/types/api';

type ScoreBucket = {
  range: string;
  count: number;
  percentage: number;
  color: string;
};

export function QualityTab() {
  const sessionId = useSessionStore((s) => s.sessionId);
  const useRox = useSettingsStore((s) => s.useRox);

  const [data, setData] = useState<QualityResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) return;

    let mounted = true;
    setLoading(true);
    setError(null);

    getQuality(sessionId, useRox)
      .then((res) => {
        if (mounted) {
          setData(res);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to fetch quality data');
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [sessionId, useRox]);

  const getScoreColor = (score: number): string => {
    if (score >= 80) return 'text-green-600';
    if (score >= 50) return 'text-amber-600';
    return 'text-red-600';
  };

  const scoreBuckets: ScoreBucket[] = data
    ? [
        { range: '90-100', count: 0, percentage: 0, color: 'bg-green-500' },
        { range: '70-89', count: 0, percentage: 0, color: 'bg-blue-500' },
        { range: '50-69', count: 0, percentage: 0, color: 'bg-amber-500' },
        { range: '0-49', count: 0, percentage: 0, color: 'bg-red-500' },
      ]
    : [];

  // Compute bucket counts
  if (data) {
    Object.values(data.results).forEach((result: QualityResult) => {
      const score = result.score;
      if (score >= 90) scoreBuckets[0].count++;
      else if (score >= 70) scoreBuckets[1].count++;
      else if (score >= 50) scoreBuckets[2].count++;
      else scoreBuckets[3].count++;
    });

    // Calculate percentages
    const total = data.summary.total_wells;
    scoreBuckets.forEach((bucket) => {
      bucket.percentage = total > 0 ? (bucket.count / total) * 100 : 0;
    });
  }

  const lowQualityWells: QualityResult[] = data
    ? Object.values(data.results).filter((r: QualityResult) => r.score < 50)
    : [];

  if (loading) {
    return (
      <div className="p-6">
        <div className="text-text-muted">Loading quality data...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="text-red-600">Error: {error}</div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-6">
        <div className="text-text-muted">No quality data available</div>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="panel">
          <div className="text-sm text-text-muted mb-1">Mean Quality Score</div>
          <div className={`text-3xl font-bold ${getScoreColor(data.summary.mean_score)}`}>
            {data.summary.mean_score.toFixed(1)}
          </div>
        </div>
        <div className="panel">
          <div className="text-sm text-text-muted mb-1">Low Quality Wells</div>
          <div className="text-3xl font-bold text-text">
            {data.summary.low_quality_count}
            <span className="text-base text-text-muted ml-2">
              / {data.summary.total_wells}
            </span>
          </div>
        </div>
      </div>

      {/* Score Distribution */}
      <div className="panel mb-6">
        <h3 className="text-lg font-semibold text-text mb-4">Score Distribution</h3>
        <table className="w-full">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-2 text-text">Range</th>
              <th className="text-left py-2 text-text">Count</th>
              <th className="text-left py-2 text-text">Distribution</th>
            </tr>
          </thead>
          <tbody>
            {scoreBuckets.map((bucket) => (
              <tr key={bucket.range} className="border-b border-border">
                <td className="py-3 text-text">{bucket.range}</td>
                <td className="py-3 text-text">{bucket.count}</td>
                <td className="py-3">
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-surface rounded-full h-4 overflow-hidden">
                      <div
                        className={`h-full ${bucket.color} transition-all duration-300`}
                        style={{ width: `${bucket.percentage}%` }}
                      />
                    </div>
                    <span className="text-sm text-text-muted w-12 text-right">
                      {bucket.percentage.toFixed(0)}%
                    </span>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Low Quality Wells */}
      {lowQualityWells.length > 0 && (
        <div className="panel">
          <h3 className="text-lg font-semibold text-text mb-4">
            Low Quality Wells (Score &lt; 50)
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 text-text">Well</th>
                  <th className="text-left py-2 text-text">Score</th>
                  <th className="text-left py-2 text-text">Flags</th>
                </tr>
              </thead>
              <tbody>
                {lowQualityWells.map((well) => (
                  <tr key={well.well} className="border-b border-border">
                    <td className="py-2 font-mono text-text">{well.well}</td>
                    <td className={`py-2 font-semibold ${getScoreColor(well.score)}`}>
                      {well.score.toFixed(1)}
                    </td>
                    <td className="py-2 text-text-muted">
                      {well.flags.length > 0 ? well.flags.join(', ') : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
