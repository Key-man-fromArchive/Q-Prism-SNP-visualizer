// @TASK P20-STALE-DATA - a scatter response whose request started BEFORE a
// cluster-assignment merge must not overwrite that merge if it arrives
// AFTER it (see docs/planning/feedback-2026-09-11/evidence/P20-STALE-DATA.md).
//
// Sequence this reproduces:
//   1. A /scatter request starts (analysis not complete yet on the backend,
//      so its eventual response's own auto_cluster/confidence fields will
//      be null/stale).
//   2. Analysis completes; setClusterAssignments merges the real call and
//      confidence onto the currently-loaded scatterPoints.
//   3. The delayed /scatter response from step 1 finally arrives.
// Without a fix, step 3 blows the merge from step 2 away with the null
// fields it carries, even though the merge is NEWER information.
import { expect, it } from 'vitest';
import { useDataStore } from './data-store';

const point = (over: Partial<ReturnType<typeof basePoint>> = {}) => ({ ...basePoint(), ...over });
function basePoint() {
  return { well: 'A1', norm_fam: 1, norm_allele2: 0, raw_fam: 1, raw_allele2: 0, raw_rox: null,
    sample_name: null, auto_cluster: null as string | null, manual_type: null, confidence: null as number | null };
}

it('keeps a cluster merge that landed while an earlier scatter fetch was in flight', () => {
  const store = useDataStore.getState();
  store.setScatterData([point()], 'VIC');
  const startedAtGeneration = useDataStore.getState().dataGeneration;

  // The cluster merge happens WHILE the (still in-flight) scatter fetch that
  // started at `startedAtGeneration` hasn't resolved yet.
  store.setClusterAssignments({ A1: 'Heterozygous' }, { A1: 0.87 });
  expect(useDataStore.getState().scatterPoints[0]).toMatchObject({ auto_cluster: 'Heterozygous', confidence: 0.87 });

  // The delayed response for the fetch that started before the merge now
  // arrives, carrying the backend's pre-merge (null) auto_cluster/confidence.
  store.setScatterData([point()], 'VIC', null, null, undefined, startedAtGeneration);

  expect(useDataStore.getState().scatterPoints[0]).toMatchObject({ auto_cluster: 'Heterozygous', confidence: 0.87 });
});

it('applies raw scatter data normally when no merge happened while the fetch was in flight', () => {
  const store = useDataStore.getState();
  store.setScatterData([point()], 'VIC');
  store.setClusterAssignments({ A1: 'Heterozygous' }, { A1: 0.87 });
  const startedAtGeneration = useDataStore.getState().dataGeneration;

  // No merge happens in between: the scatter fetch's own (fresh) response
  // wins, same as before this fix -- this guards against always preferring
  // the local overlay and silently ignoring genuinely fresher backend data.
  store.setScatterData([point({ auto_cluster: 'NTC', confidence: 0.5 })], 'VIC', null, null, undefined, startedAtGeneration);

  expect(useDataStore.getState().scatterPoints[0]).toMatchObject({ auto_cluster: 'NTC', confidence: 0.5 });
});

it('applies raw scatter data as-is when the caller does not track generations (backward compatible)', () => {
  const store = useDataStore.getState();
  store.setScatterData([point()], 'VIC');
  store.setClusterAssignments({ A1: 'Heterozygous' }, { A1: 0.87 });
  // No `startedAtGeneration` argument at all.
  store.setScatterData([point()], 'VIC');
  expect(useDataStore.getState().scatterPoints[0]).toMatchObject({ auto_cluster: null, confidence: null });
});
