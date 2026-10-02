import { useEffect, useEffectEvent, useState } from 'react';
import { useSessionStore } from '@/stores/session-store';
import { useSettingsStore } from '@/stores/settings-store';
import { getMarkers, getStatistics } from '@/lib/api';
import { displayGenotype, genotypeClasses } from '@/lib/genotype';
import { useI18n } from '@/hooks/use-i18n';
import type { AlleleLabels, MarkerRegion, StatisticsResponse } from '@/types/api';

/** Statistics cover the whole session, so names apply only when every marker agrees. */
function sharedAlleleLabels(markers: MarkerRegion[]): AlleleLabels | null {
  const first = markers[0]?.allele_labels;
  if (!first) return null;
  const same = markers.every((m) => m.allele_labels?.fam === first.fam && m.allele_labels?.allele2 === first.allele2);
  return same ? first : null;
}

export function StatisticsTab() {
  const { t } = useI18n();
  const sessionId = useSessionStore((s) => s.sessionId);
  const ploidy = useSettingsStore((s) => s.ploidy);
  const [stats, setStats] = useState<StatisticsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [alleleLabels, setAlleleLabels] = useState<AlleleLabels | null>(null);
  const loadErrorMessage = useEffectEvent(() => t.errLoadStatistics);

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
        setError(err instanceof Error ? err.message : loadErrorMessage());
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, [sessionId]);

  useEffect(() => {
    setAlleleLabels(null);
    if (!sessionId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await getMarkers(sessionId);
        if (!cancelled) setAlleleLabels(sharedAlleleLabels(res.markers));
      } catch {
        // names are cosmetic: keep the stored labels
      }
    })();
    return () => { cancelled = true; };
  }, [sessionId]);

  if (!sessionId) {
    return (
      <div className="p-6">
        <p className="text-text-muted">{t.noSessionActive}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-6">
        <p className="text-text-muted">{t.loadingStatistics}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <p className="text-danger">Error: {error}</p>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="p-6">
        <p className="text-text-muted">{t.noStatisticsAvailable}</p>
      </div>
    );
  }

  // displayGenotype only reads the allele names
  const marker = alleleLabels ? ({ allele_labels: alleleLabels } as MarkerRegion) : null;
  const shown = (label: string) => displayGenotype(label, marker);
  const homo1 = alleleLabels ? shown('Allele 1 Homo') : 'AA';
  const het = alleleLabels ? shown('Heterozygous') : 'AB';
  const homo2 = alleleLabels ? shown('Allele 2 Homo') : 'BB';

  const genotypeOrder = [
    ...genotypeClasses(ploidy).map((c) => c.key),
    'NTC',
    'Undetermined',
    'Unknown',
    'Positive Control',
  ];

  const genotypeEntries = genotypeOrder
    .map(key => ({
      genotype: key,
      count: stats.genotype_distribution[key] || 0
    }))
    .filter(entry => entry.count > 0);

  // Allele frequency + HWE are biallelic-diploid statistics; polysomic stats
  // are a later phase, so only surface them for diploid.
  const hasAlleleFreq = ploidy === 2 && stats.allele_frequency.total_genotyped > 0;
  const hwe = stats.hwe;
  const hasHWE = ploidy === 2 && hwe.chi2 !== null && hwe.chi2 !== undefined;

  return (
    <div className="p-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Section 1: Genotype Distribution */}
        <div className="panel">
          <h2 className="text-lg font-semibold text-text mb-3">{t.genotypeDistribution}</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="text-text-muted font-medium text-left py-2 px-3">{t.genotype}</th>
                <th className="text-text-muted font-medium text-left py-2 px-3">{t.count}</th>
                <th className="text-text-muted font-medium text-left py-2 px-3">%</th>
              </tr>
            </thead>
            <tbody>
              {genotypeEntries.map(({ genotype, count }) => (
                <tr key={genotype} className="border-b border-border">
                  <td className="py-2 px-3 text-text">{shown(genotype)}</td>
                  <td className="py-2 px-3 text-text">{count}</td>
                  <td className="py-2 px-3 text-text">
                    {((count / stats.total_wells) * 100).toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-text-muted text-xs mt-2">
            {t.totalWells(stats.total_wells)}
          </p>
        </div>

        {/* Section 2: Allele Frequencies */}
        <div className="panel">
          <h2 className="text-lg font-semibold text-text mb-3">{t.alleleFrequencies}</h2>
          {hasAlleleFreq ? (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-text-muted font-medium text-left py-2 px-3">{t.statAllele}</th>
                    <th className="text-text-muted font-medium text-left py-2 px-3">{t.statFrequency}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-border">
                    <td className="py-2 px-3 text-text">{t.alleleA}</td>
                    <td className="py-2 px-3 text-text font-bold">
                      {stats.allele_frequency.p.toFixed(4)}
                    </td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="py-2 px-3 text-text">{t.alleleB}</td>
                    <td className="py-2 px-3 text-text font-bold">
                      {stats.allele_frequency.q.toFixed(4)}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3 text-text">{t.totalGenotyped}</td>
                    <td className="py-2 px-3 text-text">
                      {stats.allele_frequency.total_genotyped}
                    </td>
                  </tr>
                </tbody>
              </table>
              <p className="text-text-muted text-xs mt-2">
                {homo1}={stats.allele_frequency.n_aa}, {het}={stats.allele_frequency.n_ab}, {homo2}={stats.allele_frequency.n_bb}
              </p>
            </>
          ) : (
            <p className="text-text-muted text-sm">
              {t.runClusteringFirst}
            </p>
          )}
        </div>

        {/* Section 3: Hardy-Weinberg Equilibrium */}
        <div className="panel">
          <h2 className="text-lg font-semibold text-text mb-3">{t.hweTitle}</h2>
          {hasHWE ? (
            <>
              <table className="w-full text-sm mb-3">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-text-muted font-medium text-left py-2 px-3">{t.genotype}</th>
                    <th className="text-text-muted font-medium text-left py-2 px-3">{t.observed}</th>
                    <th className="text-text-muted font-medium text-left py-2 px-3">{t.expected}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-border">
                    <td className="py-2 px-3 text-text">{homo1}</td>
                    <td className="py-2 px-3 text-text">{stats.allele_frequency.n_aa}</td>
                    <td className="py-2 px-3 text-text">{hwe.expected_aa.toFixed(2)}</td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className="py-2 px-3 text-text">{het}</td>
                    <td className="py-2 px-3 text-text">{stats.allele_frequency.n_ab}</td>
                    <td className="py-2 px-3 text-text">{hwe.expected_ab.toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td className="py-2 px-3 text-text">{homo2}</td>
                    <td className="py-2 px-3 text-text">{stats.allele_frequency.n_bb}</td>
                    <td className="py-2 px-3 text-text">{hwe.expected_bb.toFixed(2)}</td>
                  </tr>
                </tbody>
              </table>
              <div className="bg-bg border border-border rounded p-3">
                <p className="text-sm text-text mb-1">
                  χ² = {hwe.chi2.toFixed(4)}
                </p>
                <p className="text-sm text-text mb-2">
                  p-value = {hwe.p_value.toFixed(4)}
                </p>
                <div
                  className={`px-3 py-2 rounded text-sm font-medium ${
                    stats.hwe.in_hwe
                      ? 'bg-success/15 text-success'
                      : 'bg-danger/15 text-danger'
                  }`}
                >
                  {stats.hwe.in_hwe
                    ? t.inHWE
                    : t.deviatesFromHWE}
                </div>
              </div>
            </>
          ) : (
            <p className="text-text-muted text-sm">
              {hasAlleleFreq
                ? t.hweNotAvailable
                : t.runClusteringFirst}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
