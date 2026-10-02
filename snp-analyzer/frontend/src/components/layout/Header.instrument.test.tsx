import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { Header } from './Header';
import { useSessionStore } from '@/stores/session-store';
import { useLanguageStore } from '@/stores/language-store';
import type { InstrumentDetail } from '@/types/api';

vi.mock('@/lib/api', () => ({ ApiError: class extends Error {}, logout: vi.fn(), saveAsgResult: vi.fn(), getMarkers: vi.fn().mockResolvedValue({ markers: [] }) }));
vi.mock('@/hooks/use-dark-mode', () => ({ useDarkMode: () => ({ isDark: false, toggle: vi.fn() }) }));
vi.mock('@/hooks/use-exports', () => ({ useExports: () => ({}) }));
vi.mock('@/hooks/use-undo-redo', () => ({ useUndoRedo: () => ({ canUndo: false, canRedo: false }) }));
vi.mock('@/components/shared/QcBadges', () => ({ QcBadges: () => null }));
vi.mock('@/components/analysis/AddToProjectButton', () => ({ AddToProjectButton: () => null }));

function open(detail?: InstrumentDetail | null) {
  useSessionStore.setState({ sessionId: 's', sessionInfo: { session_id: 's', instrument: 'StepOnePlus', allele2_dye: 'VIC',
    num_wells: 96, num_cycles: 7, has_rox: true, data_windows: null, suggested_cycle: 0, well_groups: null,
    instrument_detail: detail } });
}

beforeEach(() => useLanguageStore.getState().setLanguage('ko'));

it('names the analysis instrument from the file and keeps the software in the tooltip', () => {
  open({ vendor: 'Applied Biosystems', model: 'StepOnePlus', software: 'StepOne Software v2.3' });
  render(<Header />);
  const chip = document.getElementById('instrument-badge')!;
  expect(chip).toHaveTextContent('분석 장비: Applied Biosystems StepOnePlus');
  expect(chip).toHaveAttribute('title', expect.stringContaining('StepOne Software v2.3'));
});

it('says it in English too', () => {
  useLanguageStore.getState().setLanguage('en');
  open({ vendor: 'Applied Biosystems', model: 'StepOnePlus' });
  render(<Header />);
  expect(document.getElementById('instrument-badge')).toHaveTextContent('Instrument: Applied Biosystems StepOnePlus');
});

it('uses the instrument string when the file has a vendor but no model', () => {
  open({ vendor: 'Bio-Rad' });
  useSessionStore.setState((s) => ({ sessionInfo: { ...s.sessionInfo!, instrument: 'Bio-Rad CFX' } }));
  render(<Header />);
  expect(document.getElementById('instrument-badge')).toHaveTextContent(/^분석 장비: Bio-Rad CFX$/);
});

it('prefixes the vendor when the instrument string does not carry it', () => {
  open({ vendor: 'Acme' });
  render(<Header />);
  expect(document.getElementById('instrument-badge')).toHaveTextContent(/^분석 장비: Acme StepOnePlus$/);
});

it('falls back to the plain instrument string when the file declares no detail', () => {
  open(null);
  render(<Header />);
  expect(document.getElementById('instrument-badge')).toHaveTextContent(/^StepOnePlus$/);
  expect(screen.getByText(/96/)).toBeInTheDocument();
});
