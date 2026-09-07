import { useI18n } from '@/hooks/use-i18n';
import { useSessionStore } from '@/stores/session-store';
import { useDataStore } from '@/stores/data-store';
import { plateAnalysisScope } from '@/lib/plate-analysis-scope';

export function PlateScopeSummary({ markers }: { markers: readonly { wells: readonly string[] }[] | null }) {
  const { t } = useI18n();
  const wellIds = useSessionStore(state => state.sessionInfo?.well_ids);
  const types = useDataStore(state => state.wellTypeAssignments);
  if (markers === null) return <p role="status" data-testid="marker-scope-unavailable">{t.wsMarkerScopeUnknown}</p>;
  const scope = plateAnalysisScope(wellIds, markers, types);
  const whole = !markers.some(marker => marker.wells.length > 0);
  return <section role="status" aria-live="polite" className="mb-3 rounded-md border border-border bg-bg-secondary p-3 text-sm">
    {whole && <p data-testid="whole-plate-banner">{t.wsWholePlate}</p>}
    {!scope ? <p>{t.wsInventoryUnknown}</p> : <>
      {scope.unassigned > 0 && <p data-testid="unassigned-banner"><span data-testid="unassigned-count">{t.wsUnassignedBanner(scope.unassigned)}</span></p>}
      <p data-testid="analysis-scope-counts">{t.wsScopeCounts(scope.total, scope.eligible, scope.empty, scope.omit)}</p>
      <p className="text-xs text-text-muted">{t.wsScopeIndependent}</p>
    </>}
  </section>;
}
