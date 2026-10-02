import type { ReactNode } from "react";
import { useI18n } from "@/hooks/use-i18n";

type AnalysisCardHeaderProps = {
  /** Marker name, or the whole-plate scope label. */
  name: string;
  color?: string;
  ploidy: number;
  wells: number;
  /** Extra chips (expert details, trust badge) that sit between ploidy and the well count. */
  children?: ReactNode;
};

const CHIP = "rounded-full px-3 py-1 text-xs bg-bg border border-border text-text";

/** One result-card header for every instrument and scope: scope chip, ploidy, extras, well count. */
export function AnalysisCardHeader({ name, color, ploidy, wells, children }: AnalysisCardHeaderProps) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center gap-2 mb-3" data-testid="analysis-card-header">
      <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs bg-bg border border-border text-text">
        {color && <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: color }} />}
        <b>{name}</b>
      </span>
      <span data-testid="marker-ploidy-badge" className={CHIP}>{t.wsMarkerPloidyUnit(ploidy)}</span>
      {children}
      <span className="ml-auto text-xs text-text-muted">{t.wsAnalysisWellsCount(wells)}</span>
    </div>
  );
}
