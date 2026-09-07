import { navigateQualityTarget } from '@/lib/quality-navigation';
import type { QualityTarget } from '@/lib/quality-target';
import { useNavigationStore } from '@/stores/navigation-store';

export function QualityWellLink({ target }: { target: QualityTarget }) {
  const pending = useNavigationStore(state => state.qualityNavigating);
  return <button type="button" disabled={pending} className="text-primary underline underline-offset-2 cursor-pointer disabled:opacity-50"
    onClick={() => { if (!useNavigationStore.getState().qualityNavigating) void navigateQualityTarget(target); }}>{target.well}</button>;
}
