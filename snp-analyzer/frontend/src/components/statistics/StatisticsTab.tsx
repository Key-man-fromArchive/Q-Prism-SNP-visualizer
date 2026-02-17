import { useEffect, useState } from 'react';
import { useSessionStore } from '@/stores/session-store';
import { getStatistics } from '@/lib/api';
import type { StatisticsResponse } from '@/types/api';

export function StatisticsTab() {
  const sessionId = useSessionStore((s) => s.sessionId);
  const [stats, setStats] = useState<StatisticsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setStats(null);
      return;
    }

    const fetchStats = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await getStatistics(sessionId);
        setStats(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load statistics');
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, [sessionId]);

  if (!sessionId) {
    return (
      <div className="p-6">
        <p className="text-text-muted">No session active. Upload a file to begin.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-6">
        <p className="text-text-muted">Loading statistics...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <p className="text-red-500">Error: {error}</p>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="p-6">
        <p className="text-text-muted">No statistics available.</p>
      </div>
    );
  }

  const genotypeOrder = [
    'Allele 1 Homo',
    'Allele 2 Homo',
    'Heterozygous',
    'NTC',
    'Undetermined',
    'Unknown',
    'Positive Control'
  ];

  const genotypeEntries = genotypeOrder
    .map(key => ({
      genotype: key,
      count: stats.genotype_distribution[key] || 0
    }))
    .filter(entry => entry.count > 0);

  const hasAlleleFreq = stats.allele_frequency.total_genotyped > 0;
  const hasHWE = stats.hwe.chi2 !== null && stats.hwe.chi2 !== undefined;

  return (
    <div className="p-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Section 1: Genotype Distribution */}
        <div className="panel">
          <h2 className="text-lg font-semibold text-text mb-3">Genotype Distribution</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-text-muted font-medium text-left py-2 px-3">Genotype</th>
                <th className="text-text-muted font-medium text-left py-2 px-3">Count</th>
                <th className="text-text-muted font-medium text-left py-2 px-3">%</th>
              </tr>
            </thead>
            <tbody>
              {genotypeEntries.map(({ genotype, count }) => (
                <tr key={genotype} className="border-b border-border">
                  <td className="py-2 px-3 text-text">{genotype}</td>
                  <td className="py-2 px-3 text-text">{count}</td>
                  <td className="py-2 px-3 text-text">
                    {((count / stats.total_wells) * 100).toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-text-muted text-xs mt-2">
            Total wells: {stats.total_wells}
          </p>
        </div>

        {/* Section 2: Allele Frequencies */}
        <div className="panel">
          <h2 className="text-lg font-semibold text-text mb-3">Allele Frequencies</h2>
          {hasAlleleFreq ? (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-text-muted font-medium text-left py-2 px-3">Allele</th>
                    <th className="text-text-muted font-medium text-left py-2 px-3">Frequency</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-border">
                    <td className="py-2 px-3 text-text">Allele A (p)</td>
                    <td className="py-2 px-3 text-text font-bold">
                      {stats.allele_frequency.p.toFixed(4)}
                    </td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="py-2 px-3 text-text">Allele B (q)</td>
                    <td className="py-2 px-3 text-text font-bold">
                      {stats.allele_frequency.q.toFixed(4)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3 text-text">Total genotyped</td>
                    <td className="py-2 px-3 text-text">
                      {stats.allele_frequency.total_genotyped}
                    </td>
                  </tr>
                </tbody>
              </table>
              <p className="text-text-muted text-xs mt-2">
                AA={stats.allele_frequency.n_aa}, AB={stats.allele_frequency.n_ab}, BB={stats.allele_frequency.n_bb}
              </p>
            </>
          ) : (
            <p className="text-text-muted text-sm">
              Run clustering first to calculate allele frequencies.
            </p>
          )}
        </div>

        {/* Section 3: Hardy-Weinberg Equilibrium */}
        <div className="panel">
          <h2 className="text-lg font-semibold text-text mb-3">Hardy-Weinberg Equilibrium</h2>
          {hasHWE ? (
            <>
              <table className="w-full text-sm mb-3">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-text-muted font-medium text-left py-2 px-3">Genotype</th>
                    <th className="text-text-muted font-medium text-left py-2 px-3">Observed</th>
                    <th className="text-text-muted font-medium text-left py-2 px-3">Expected</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-border">
                    <td className="py-2 px-3 text-text">AA</td>
                    <td className="py-2 px-3 text-text">{stats.allele_frequency.n_aa}</td>
                    <td className="py-2 px-3 text-text">{stats.hwe.expected_aa.toFixed(2)}</td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="py-2 px-3 text-text">AB</td>
                    <td className="py-2 px-3 text-text">{stats.allele_frequency.n_ab}</td>
                    <td className="py-2 px-3 text-text">{stats.hwe.expected_ab.toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3 text-text">BB</td>
                    <td className="py-2 px-3 text-text">{stats.allele_frequency.n_bb}</td>
                    <td className="py-2 px-3 text-text">{stats.hwe.expected_bb.toFixed(2)}</td>
                  </tr>
                </tbody>
              </table>
              <div className="bg-bg border border-border rounded p-3">
                <p className="text-sm text-text mb-1">
                  χ² = {stats.hwe.chi2.toFixed(4)}
                </p>
                <p className="text-sm text-text mb-2">
                  p-value = {stats.hwe.p_value.toFixed(4)}
                </p>
                <div
                  className={`px-3 py-2 rounded text-sm font-medium ${
                    stats.hwe.in_hwe
                      ? 'bg-green-500/20 text-green-400'
                      : 'bg-red-500/20 text-red-400'
                  }`}
                >
                  {stats.hwe.in_hwe
                    ? 'In HWE (p > 0.05)'
                    : 'Deviates from HWE (p ≤ 0.05)'}
                </div>
              </div>
            </>
          ) : (
            <p className="text-text-muted text-sm">
              {hasAlleleFreq
                ? 'HWE test not available.'
                : 'Run clustering first to calculate allele frequencies.'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
