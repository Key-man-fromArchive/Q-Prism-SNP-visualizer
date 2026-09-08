import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ScatterViewControls } from './ScatterViewControls';
import { useLanguageStore } from '@/stores/language-store';
import { useSettingsStore } from '@/stores/settings-store';

it.each(['en', 'ko'] as const)('summarizes inferred thresholds and unlocked axes without applying settings (%s)', language => {
  useLanguageStore.getState().setLanguage(language);
  useSettingsStore.setState({ lockAspect: false, useRox: false, axisMode: 'zero', backgroundMode: 'none' });
  const change = vi.fn();
  render(<ScatterViewControls dataBounds={{ xMin: 0, xMax: 2, yMin: 0, yMax: 2 }}
    labels={{ fam: 'FAM', allele2: 'VIC' }} ntcCorner={null} effectiveNtcCorner={{ fam: 0.12, allele2: 0.34 }}
    onNtcCornerChange={change} normalizationApplied={false} />);
  const summary = screen.getByTestId('analysis-advanced-settings').querySelector('summary')!;
  expect(summary).toHaveTextContent('FAM ≤0.12');
  expect(summary).toHaveTextContent('VIC ≤0.34');
  expect(summary).toHaveTextContent(language === 'en' ? 'Auto' : '자동');
  expect(summary).toHaveTextContent(language === 'en' ? 'Independent scales' : '독립 축');
  fireEvent.click(summary);
  expect(change).not.toHaveBeenCalled();
  expect(useSettingsStore.getState().lockAspect).toBe(false);
  expect(useSettingsStore.getState().useRox).toBe(false);
});

it.each(['en', 'ko'] as const)('summarizes explicit thresholds and locked axes (%s)', language => {
  useLanguageStore.getState().setLanguage(language);
  useSettingsStore.setState({ lockAspect: true, useRox: true, axisMode: 'auto', backgroundMode: 'pre_read' });
  render(<ScatterViewControls dataBounds={{ xMin: 0, xMax: 2, yMin: 0, yMax: 2 }}
    labels={{ fam: 'FAM', allele2: 'VIC' }} ntcCorner={{ fam: 0.12, allele2: 0.34 }} effectiveNtcCorner={{ fam: 0.12, allele2: 0.34 }}
    onNtcCornerChange={vi.fn()} normalizationApplied />);
  const summary = screen.getByTestId('analysis-advanced-settings').querySelector('summary')!;
  expect(summary).toHaveTextContent(language === 'en' ? 'Explicit NTC' : '지정 NTC');
  expect(summary).toHaveTextContent(language === 'en' ? 'Equal scales' : '동일 축');
});

it('edits and resets the raw NTC axis margins without touching manual bounds', () => {
  useLanguageStore.getState().setLanguage('en');
  useSettingsStore.getState().resetToDefaults();
  useSettingsStore.setState({ axisMode: 'zero', xMin: -10, yMin: -20 });
  render(<ScatterViewControls dataBounds={{ xMin: 0, xMax: 2000, yMin: 0, yMax: 3000 }}
    labels={{ fam: 'FAM', allele2: 'VIC' }} ntcCorner={null} effectiveNtcCorner={{ fam: 1000, allele2: 2000 }}
    onNtcCornerChange={vi.fn()} normalizationApplied={false} />);

  const xOffset = screen.getByTestId('ntc-axis-x-offset');
  const yOffset = screen.getByTestId('ntc-axis-y-offset');
  expect(xOffset).toHaveValue(100);
  expect(yOffset).toHaveValue(100);
  expect(screen.getByTestId('ntc-axis-offset-reset')).toBeDisabled();
  fireEvent.change(xOffset, { target: { value: '250' } });
  fireEvent.change(yOffset, { target: { value: '175' } });
  expect(useSettingsStore.getState().xNtcOffsetRaw).toBe(250);
  expect(useSettingsStore.getState().yNtcOffsetRaw).toBe(175);
  expect(screen.getByTestId('ntc-axis-offset-reset')).not.toBeDisabled();
  expect(useSettingsStore.getState().xMin).toBe(-10);
  fireEvent.click(screen.getByTestId('ntc-axis-offset-reset'));
  expect(useSettingsStore.getState().xNtcOffsetRaw).toBe(100);
  expect(useSettingsStore.getState().yNtcOffsetRaw).toBe(100);
});

it('uses the normalized margin pair when normalized display is applied', () => {
  useSettingsStore.getState().resetToDefaults();
  render(<ScatterViewControls dataBounds={{ xMin: 0, xMax: 2, yMin: 0, yMax: 3 }}
    labels={{ fam: 'FAM', allele2: 'VIC' }} ntcCorner={null} effectiveNtcCorner={{ fam: 1, allele2: 2 }}
    onNtcCornerChange={vi.fn()} normalizationApplied />);
  expect(screen.getByTestId('ntc-axis-x-offset')).toHaveValue(0.1);
  fireEvent.change(screen.getByTestId('ntc-axis-x-offset'), { target: { value: '0.25' } });
  expect(useSettingsStore.getState().xNtcOffsetNormalized).toBe(0.25);
  expect(useSettingsStore.getState().xNtcOffsetRaw).toBe(100);
});
