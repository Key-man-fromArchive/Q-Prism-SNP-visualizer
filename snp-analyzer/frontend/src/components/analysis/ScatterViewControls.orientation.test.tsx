import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ScatterViewControls } from './ScatterViewControls';
import { useSettingsStore } from '@/stores/settings-store';

beforeEach(() => useSettingsStore.getState().resetToDefaults());

const props = {
  dataBounds: { xMin: 0, xMax: 100, yMin: 0, yMax: 50 },
  labels: { fam: 'FAM', allele2: 'VIC', normalization: 'ROX' },
  ntcCorner: null,
  effectiveNtcCorner: { fam: 1, allele2: 1 },
  onNtcCornerChange: vi.fn(),
  normalizationApplied: false,
};

it('offers a swap-axes toggle next to the aspect ratio that flips the stored orientation', () => {
  render(<ScatterViewControls {...props} />);
  const toggle = screen.getByTestId('scatter-swap-axes');
  expect(toggle.getAttribute('aria-pressed')).toBe('false');
  fireEvent.click(toggle);
  expect(useSettingsStore.getState().scatterOrientation).toBe('allele2_x');
  expect(screen.getByTestId('scatter-swap-axes').getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(screen.getByTestId('scatter-swap-axes'));
  expect(useSettingsStore.getState().scatterOrientation).toBe('fam_x');
});

it('fits to data in the displayed axes when swapped', () => {
  useSettingsStore.getState().setScatterOrientation('allele2_x');
  render(<ScatterViewControls {...props} />);
  fireEvent.click(screen.getByTestId('axis-fit-to-data'));
  const s = useSettingsStore.getState();
  expect([s.xMax, s.yMax]).toEqual([50, 100]);
});
