import { useEffect, useEffectEvent, type RefObject } from 'react';
import { useNavigationStore, type WorkspaceSurface } from '@/stores/navigation-store';
import { useQualityReveal } from './use-quality-reveal';

function findWell(root: HTMLElement, well: string) {
  return [...root.querySelectorAll<HTMLElement>('[data-well], [data-well-id]')]
    .find(node => (node.dataset.well ?? node.dataset.wellId) === well);
}
/** Waits for the actual target node; never focuses the first/nearest unrelated well. */
export function useQualityFocus(ref: RefObject<HTMLElement | null>, surface: WorkspaceSurface, onFocus?: (well: string) => void) {
  const target = useQualityReveal();
  const active = useNavigationStore(state => state.surface);
  const tab = useNavigationStore(state => state.tab);
  const notify = useEffectEvent((well: string) => onFocus?.(well));
  useEffect(() => {
    const root = ref.current;
    if (!target || !root || active !== surface || tab !== 'analysis') return;
    let completed = false;
    const focus = () => {
      if (completed) return;
      const node = findWell(root, target.well);
      if (!node) return;
      completed = true;
      node.focus();
      node.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      notify(target.well);
    };
    const observer = new MutationObserver(focus);
    observer.observe(root, { childList: true, subtree: true });
    focus();
    return () => observer.disconnect();
  }, [target, ref, surface, active, tab]);
}
