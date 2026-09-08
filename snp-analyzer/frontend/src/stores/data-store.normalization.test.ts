import { expect, it } from 'vitest';
import { useDataStore } from './data-store';

it('distinguishes unreported normalization from authoritative false/true and clears provenance', () => {
  const store = useDataStore.getState();
  store.setScatterData([], 'HEX');
  expect(useDataStore.getState()).toMatchObject({ normalizationReported: false, normalizationApplied: false });
  store.setScatterData([], 'HEX', null, null, { applied: false });
  expect(useDataStore.getState()).toMatchObject({ normalizationReported: true, normalizationApplied: false });
  store.setScatterData([], 'HEX', null, null, { applied: true });
  expect(useDataStore.getState()).toMatchObject({ normalizationReported: true, normalizationApplied: true });
  store.clearData();
  expect(useDataStore.getState()).toMatchObject({ normalizationReported: false, normalizationApplied: false });
});
