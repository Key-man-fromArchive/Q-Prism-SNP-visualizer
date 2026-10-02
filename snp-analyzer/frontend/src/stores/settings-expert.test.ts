import { beforeEach, expect, it } from 'vitest';
import { useSettingsStore } from './settings-store';

beforeEach(() => {
  useSettingsStore.getState().resetToDefaults();
  useSettingsStore.setState({ expertMode: false });
});

it('keeps expert mode when the analysis settings are reset', () => {
  useSettingsStore.getState().setExpertMode(true);
  useSettingsStore.getState().resetToDefaults();
  expect(useSettingsStore.getState().expertMode).toBe(true);
});

it('keeps expert mode off by default', () => {
  expect(useSettingsStore.getState().expertMode).toBe(false);
});

it('turns expert mode on and persists it', () => {
  useSettingsStore.getState().setExpertMode(true);
  expect(useSettingsStore.getState().expertMode).toBe(true);
  const stored = JSON.parse(window.localStorage.getItem('snp-analyzer-settings') ?? '{}');
  expect(stored.state.expertMode).toBe(true);
});

it('leaves threshold-edit tool behind when expert mode is turned off', () => {
  useSettingsStore.getState().setExpertMode(true);
  useSettingsStore.getState().setScatterTool('edit');
  useSettingsStore.getState().setExpertMode(false);
  expect(useSettingsStore.getState().scatterTool).toBe('select');
});
