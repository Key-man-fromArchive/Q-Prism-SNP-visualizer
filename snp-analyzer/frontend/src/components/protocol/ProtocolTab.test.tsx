import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ProtocolTab } from './ProtocolTab';
import { getProtocol, updateProtocol } from '@/lib/api';
import { useSessionStore } from '@/stores/session-store';
import { useLanguageStore } from '@/stores/language-store';
import en from '@/locales/en';
vi.mock('@/lib/api', () => ({ getProtocol: vi.fn(), updateProtocol: vi.fn() }));
const step = { step: 1, label: 'Synthetic step', temperature: 60, duration_sec: 30, cycles: 1, phase: '', goto_label: '' };
beforeEach(() => { vi.clearAllMocks(); useLanguageStore.getState().setLanguage('en'); useSessionStore.setState({ sessionId: 'protocol-a' }); });
it('announces lookup separately from saving and labels each editable step', async () => {
  let resolve!: (value: Awaited<ReturnType<typeof getProtocol>>) => void;
  vi.mocked(getProtocol).mockReturnValue(new Promise(done => { resolve = done; }));
  render(<ProtocolTab />);
  expect(screen.getByRole('status')).toHaveTextContent(en.loading);
  expect(screen.queryByText(en.saving)).not.toBeInTheDocument();
  await act(async () => resolve({ steps: [step] }));
  expect(screen.getByLabelText(`${en.label} 1`)).toHaveValue(step.label);
});
it('does not replace current session protocol with a late prior response', async () => {
  let resolve!: (value: Awaited<ReturnType<typeof getProtocol>>) => void;
  vi.mocked(getProtocol).mockReturnValueOnce(new Promise(done => { resolve = done; })).mockResolvedValue({ steps: [{ ...step, label: 'Current' }] });
  render(<ProtocolTab />);
  await act(async () => useSessionStore.setState({ sessionId: 'protocol-b' }));
  expect(await screen.findByDisplayValue('Current')).toBeInTheDocument();
  await act(async () => resolve({ steps: [step] }));
  expect(screen.getByDisplayValue('Current')).toBeInTheDocument();
  expect(screen.queryByDisplayValue(step.label)).not.toBeInTheDocument();
});
it('retains edits on save failure and reports only a safe localized error', async () => {
  vi.mocked(getProtocol).mockResolvedValue({ steps: [step] });
  vi.mocked(updateProtocol).mockRejectedValue(new Error('private diagnostic'));
  render(<ProtocolTab />);
  const input = await screen.findByDisplayValue(step.label);
  fireEvent.change(input, { target: { value: 'Edited' } });
  fireEvent.click(screen.getByText(en.saveProtocol));
  expect(await screen.findByRole('alert')).toHaveTextContent(en.errSaveProtocol);
  expect(screen.getByRole('alert')).toHaveClass('border-danger', 'bg-danger/10');
  expect(screen.getByRole('alert').querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  expect(input).toHaveValue('Edited');
});
it('does not announce an old save after session replacement and supports local Cancel', async () => {
  let resolve!: (value: Awaited<ReturnType<typeof updateProtocol>>) => void;
  vi.mocked(getProtocol).mockResolvedValue({ steps: [step] });
  vi.mocked(updateProtocol).mockReturnValue(new Promise(done => { resolve = done; }));
  const dirty = vi.fn(); window.addEventListener('asg-result-dirty', dirty);
  render(<ProtocolTab />);
  const input = await screen.findByDisplayValue(step.label);
  fireEvent.change(input, { target: { value: 'Draft' } });
  fireEvent.click(screen.getByText(en.cancel));
  expect(input).toHaveValue(step.label);
  fireEvent.click(screen.getByText(en.saveProtocol));
  await act(async () => {
    useSessionStore.setState({ sessionId: 'replacement' });
    resolve({ status: 'ok' });
    await Promise.resolve();
    expect(dirty).not.toHaveBeenCalled();
  });
  expect(dirty).not.toHaveBeenCalled();
  window.removeEventListener('asg-result-dirty', dirty);
});
for (const operation of ['load', 'save'] as const) {
  it(`ignores late ${operation} failure after same-session new entry`, async () => {
    let reject!: (reason: Error) => void;
    const held = new Promise<never>((_, fail) => { reject = fail; });
    vi.mocked(getProtocol).mockResolvedValue({ steps: [step] });
    if (operation === 'load') vi.mocked(getProtocol).mockReturnValueOnce(held);
    else vi.mocked(updateProtocol).mockReturnValueOnce(held);
    render(<ProtocolTab />);
    if (operation === 'save') {
      await screen.findByDisplayValue(step.label);
      fireEvent.click(screen.getByText(en.saveProtocol));
    }
    await act(async () => {
      useSessionStore.setState(state => ({ entryGeneration: state.entryGeneration + 1 }));
      reject(new Error('private stale failure'));
      await Promise.resolve();
    });
    await screen.findByDisplayValue(step.label);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
}
it('distinguishes failed lookup, retry-empty and saved without losing added steps', async () => {
  vi.mocked(getProtocol).mockRejectedValueOnce(new Error('private')).mockResolvedValue({ steps: [] });
  vi.mocked(updateProtocol).mockResolvedValue({ status: 'ok' });
  render(<ProtocolTab />);
  expect(await screen.findByRole('alert')).toHaveTextContent(en.errLoadProtocol);
  fireEvent.click(screen.getByText(en.retry));
  await screen.findByText(en.protocolEmpty);
  fireEvent.click(screen.getByText(en.addStep));
  fireEvent.change(screen.getByLabelText(`${en.label} 1`), { target: { value: 'New' } });
  fireEvent.click(screen.getByText(en.saveProtocol));
  await screen.findByText(en.protocolSaved);
  expect(screen.getByDisplayValue('New')).toBeInTheDocument();
  fireEvent.change(screen.getByDisplayValue('New'), { target: { value: 'New draft' } });
  expect(screen.queryByText(en.protocolSaved)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: `${en.delete} 1` }));
  expect(screen.queryByDisplayValue('New draft')).not.toBeInTheDocument();
});

// P0-T0.2 characterization test: getPhaseColor's border/label colors move
// into src/lib/chart-colors.ts, but must keep rendering the exact
// pre-refactor hex for every named phase, every amplification-cycle index
// and the unmatched fallback.
it('renders the pre-refactor phase colors unchanged (P0-T0.2 value lock)', async () => {
  const phases = [
    { phase: 'Pre-read', border: 'rgb(59, 130, 246)', label: 'rgb(37, 99, 235)' },
    { phase: 'Initial Denaturation', border: 'rgb(239, 68, 68)', label: 'rgb(220, 38, 38)' },
    { phase: 'Post-read', border: 'rgb(16, 185, 129)', label: 'rgb(5, 150, 105)' },
    { phase: 'Amplification 1', border: 'rgb(245, 158, 11)', label: 'rgb(217, 119, 6)' },
    { phase: 'Amplification 2', border: 'rgb(249, 115, 22)', label: 'rgb(234, 88, 12)' },
    { phase: 'Amplification 3', border: 'rgb(234, 88, 12)', label: 'rgb(194, 65, 12)' },
    { phase: 'Amplification 4', border: 'rgb(220, 38, 38)', label: 'rgb(185, 28, 28)' },
    { phase: 'Amplification 5', border: 'rgb(245, 158, 11)', label: 'rgb(217, 119, 6)' }, // wraps mod 4
    { phase: 'Unrecognized Phase', border: 'rgb(148, 163, 184)', label: 'rgb(100, 116, 139)' },
  ];
  vi.mocked(getProtocol).mockResolvedValue({
    steps: phases.map((p, i) => ({ ...step, step: i + 1, label: `s${i + 1}`, phase: p.phase, cycles: 2 })),
  });
  render(<ProtocolTab />);
  for (let i = 0; i < phases.length; i++) {
    const row = (await screen.findByDisplayValue(`s${i + 1}`)).closest('tr') as HTMLTableRowElement;
    expect(row.style.borderLeft).toBe(`3px solid ${phases[i].border}`);
    const labelDiv = row.querySelector('td div');
    expect(labelDiv).not.toBeNull();
    expect((labelDiv as HTMLElement).style.color).toBe(phases[i].label);
  }
});
