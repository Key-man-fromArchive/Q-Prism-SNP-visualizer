import { useI18n } from "@/hooks/use-i18n";
import { useIsDarkMode } from "@/hooks/use-dark-mode";
import { chartCategory, callAppearance } from "@/lib/chart-semantics";
import type { CallCount } from "@/lib/genotype-counts";

type GenotypeSummaryProps = {
  ploidy: number;
  entries: CallCount[];
  /** Wells flagged as not amplified; shown in their own cell. */
  noAmplification?: number;
  excluded: number;
};

/** The "Genotype calls" card shared by the per-marker and the whole-plate view. */
export function GenotypeSummary({ ploidy, entries, noAmplification = 0, excluded }: GenotypeSummaryProps) {
  const { t } = useI18n();
  const dark = useIsDarkMode();
  return (
    <div className="panel" data-testid="genotype-counts-card">
      <h3 className="text-sm font-semibold mb-2 text-text">{t.wsAnalysisGenotypeCountsTitle}</h3>
      <div data-testid="genotype-counts" className="grid gap-2"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(72px, 1fr))" }}>
        {entries.map(({ label, count }) => (
          <div key={label} className="border border-border rounded-md p-2 text-center" style={{ background: "var(--color-bg)" }}>
            <div className="text-lg font-bold tabular-nums" style={{ color: chartCategory(label, ploidy, dark).text }}>{count}</div>
            <div className="text-[10px] text-text-muted font-mono mt-0.5">{callAppearance(label, ploidy, dark, t).label}</div>
          </div>
        ))}
        {noAmplification > 0 && (
          <div data-testid="genotype-count-no-amplification" className="border border-border rounded-md p-2 text-center">
            <div className="text-lg font-bold tabular-nums text-text-muted">{noAmplification}</div>
            <div className="text-[10px] text-text-muted mt-0.5">{t.ampQcWellNone}</div>
          </div>
        )}
        <div className="border border-border rounded-md p-2 text-center">
          <div className="text-lg font-bold tabular-nums text-text-muted">{excluded}</div>
          <div className="text-[10px] text-text-muted mt-0.5">{t.wsAnalysisExcludedLabel}</div>
        </div>
      </div>
    </div>
  );
}
