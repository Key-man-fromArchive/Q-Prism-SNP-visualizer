import { parseNavigation, useNavigationStore } from '@/stores/navigation-store';
import { useAnalysisStore } from '@/stores/analysis-store';
import { useSessionStore } from '@/stores/session-store';
import { useSettingsStore } from '@/stores/settings-store';
import { useSelectionStore } from '@/stores/selection-store';
import { restoreSettings } from './workspace-restore';
import type { ReadyAnalysisSession } from './analysis-session';
import type { DataWindow } from '@/types/api';

function windowName(windows: DataWindow[] | null | undefined, cycle: number | null): string | null {
  if (cycle === null) return null;
  return windows?.find(window => cycle >= window.start_cycle && cycle <= window.end_cycle)?.name ?? null;
}
function navigationFor(session: string, value: ReadyAnalysisSession, cycles: number[]) {
  const preferred = useAnalysisStore.getState().result?.cycle ?? value.info.suggested_cycle;
  const cycle = preferred !== null && cycles.includes(preferred) ? preferred : cycles.at(-1) ?? null;
  return parseNavigation(useSessionStore.getState().restoreQuery ?? '', {
    session, cycles, windows: value.info.data_windows ?? [], markers: value.markers.map(marker => marker.id),
    defaults: { session, tab: 'results', surface: 'analysis', marker: value.markers[0]?.id ?? null, cycle },
  });
}
/** All cross-store values are applied behind the restoring barrier; ready is the final publication. */
export function completeWorkspaceRestore(owner: string, session: string, generation: number, value: ReadyAnalysisSession) {
  const cycles = [...value.info.cycles].sort((left, right) => left - right);
  const context = useAnalysisStore.getState().result?.analysis_context ?? null;
  const restored = restoreSettings(owner, session, context, value.info, value.ploidy);
  const navigation = navigationFor(session, value, cycles);
  useNavigationStore.getState().setAvailableCycles(cycles);
  useSettingsStore.setState(restored.settings);
  useSelectionStore.getState().setDataWindow(windowName(value.info.data_windows, navigation.value.cycle));
  const accepted = useNavigationStore.getState().complete(generation, { ...navigation, reasons: [...navigation.reasons, ...restored.reasons] });
  return { accepted, cycle: navigation.value.cycle };
}
