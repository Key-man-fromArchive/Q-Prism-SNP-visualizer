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
