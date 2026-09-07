import { expect, it } from 'vitest';
import { useNavigationStore } from './navigation-store';
import { useSelectionStore } from './selection-store';

it('keeps legacy cycle consumers as a projection of the navigation owner including restored absolute zero', () => {
  useNavigationStore.getState().clear();
  useSelectionStore.getState().setCycle(20);
  expect(useNavigationStore.getState().cycle).toBe(20);
  const generation = useNavigationStore.getState().beginRestore('s');
  useNavigationStore.getState().complete(generation, { reasons: [], value: {
    session: 's', tab: 'analysis', surface: 'analysis', marker: null, cycle: 0,
  } });
  expect(useSelectionStore.getState().currentCycle).toBe(0);
});
