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
