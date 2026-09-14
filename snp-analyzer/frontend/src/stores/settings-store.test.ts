import { beforeEach, expect, it } from 'vitest';
import { useSettingsStore } from './settings-store';

// P4-S1-T1 (FB-04 §3-1): scatter canvas aspect ratio is a user choice, not a
// fixed value -- see the type doc on ScatterAspect for why. These tests
// cover only the store side; the CSS variables it feeds are asserted from
// the two plot components that read this field.

beforeEach(() => {
  useSettingsStore.getState().resetToDefaults();
});

it('defaults scatterAspect to 4:3', () => {
  expect(useSettingsStore.getState().scatterAspect).toBe('4:3');
});

it('setScatterAspect switches to 1:1 and back', () => {
  useSettingsStore.getState().setScatterAspect('1:1');
  expect(useSettingsStore.getState().scatterAspect).toBe('1:1');
  useSettingsStore.getState().setScatterAspect('4:3');
  expect(useSettingsStore.getState().scatterAspect).toBe('4:3');
});

it('resetToDefaults restores 4:3 after it was changed', () => {
  useSettingsStore.getState().setScatterAspect('1:1');
  useSettingsStore.getState().resetToDefaults();
  expect(useSettingsStore.getState().scatterAspect).toBe('4:3');
});

// applyPreset (src/components/settings/apply-preset.ts, out of this task's
// write scope) never references scatterAspect -- PresetSettings has no such
// field -- so applying any preset only ever sets the fields it knows about,
// exactly like the plain partial update below. A legacy preset (no
// scatterAspect key at all) must not disturb the default.
it('leaves scatterAspect at its default when an unrelated (legacy-shaped) partial update is applied', () => {
  useSettingsStore.setState({ useRox: false, fixAxis: true, xMin: 1, xMax: 5 });
  expect(useSettingsStore.getState().scatterAspect).toBe('4:3');
});

// zustand's persist `merge` defaults to `{ ...currentState, ...persistedState }`.
// A pre-P4-S1-T1 localStorage payload has no `scatterAspect` key at all, so
// the spread of `persistedState` contributes no such key and the default
// from `defaults` (spread into `currentState` at store construction) survives.
// This models that merge directly rather than round-tripping localStorage,
// which the persist middleware only touches on module init.
it('models persist merge of a legacy payload without scatterAspect: default survives', () => {
  const currentState = useSettingsStore.getState();
  const legacyPersisted = { useRox: false, ntcThreshold: 0.2 } as Partial<typeof currentState>;
  const merged = { ...currentState, ...legacyPersisted };
  expect(merged.scatterAspect).toBe('4:3');
});

// P27-LOCK-DEFAULT (feedback-2026-09-11): raw RFU is routinely ~4-8x wider in
// x than in y on an allele-specific plate (user report 4a83029e: FAM span
// 11,185 vs allele2 span 2,748 for one real session), so locking the two
// axes to the same data-per-pixel scale squashes the whole plot into a
// horizontal strip along the bottom of the canvas. The lock stays available
// from the scatter toolbar for anyone who wants literal-angle boundary rays;
// only the unattended default changes.
it('defaults lockAspect to false for a brand-new user', () => {
  expect(useSettingsStore.getState().lockAspect).toBe(false);
});

// Pre-fix localStorage payloads were written with lockAspect: true (the old
// default) and no `version` field. Flipping only the in-code default does
// nothing for a returning user: zustand's persist `merge` overlays whatever
// is in storage on top of the new defaults, so their canvas would stay
// flattened until this migration runs once.
it('migrates a pre-fix stored payload (lockAspect: true, no version) to lockAspect: false', async () => {
  window.localStorage.setItem(
    'snp-analyzer-settings',
    JSON.stringify({ state: { lockAspect: true, xMin: 42, xMax: 999 } })
  );
  await useSettingsStore.persist.rehydrate();
  expect(useSettingsStore.getState().lockAspect).toBe(false);
});

// The migration must not touch any other persisted setting -- an operator's
// saved axis range, aspect choice, or color thresholds are unrelated to this
// fix and must survive it untouched.
it('migration leaves unrelated persisted settings untouched', async () => {
  window.localStorage.setItem(
    'snp-analyzer-settings',
    JSON.stringify({
      state: {
        lockAspect: true,
        xMin: 42,
        xMax: 999,
        scatterAspect: '1:1',
        ntcThreshold: 0.33,
      },
    })
  );
  await useSettingsStore.persist.rehydrate();
  const state = useSettingsStore.getState();
  expect(state.xMin).toBe(42);
  expect(state.xMax).toBe(999);
  expect(state.scatterAspect).toBe('1:1');
  expect(state.ntcThreshold).toBe(0.33);
});

// A payload already written at the current version (post-migration, or an
// operator who re-enabled the lock after this fix shipped) must round-trip
// exactly -- the migration is a one-time nudge, not a standing override that
// would make the toolbar's lock button useless.
it('does not re-force lockAspect false for a payload already at the current version', async () => {
  const stored = JSON.parse(window.localStorage.getItem('snp-analyzer-settings') ?? '{}');
  window.localStorage.setItem(
    'snp-analyzer-settings',
    JSON.stringify({ state: { lockAspect: true }, version: stored.version ?? 1 })
  );
  await useSettingsStore.persist.rehydrate();
  expect(useSettingsStore.getState().lockAspect).toBe(true);
});
