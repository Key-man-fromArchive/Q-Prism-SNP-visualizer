import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProtocolTab } from './ProtocolTab';
import { getProtocol, updateProtocol } from '@/lib/api';
import { useSessionStore } from '@/stores/session-store';
import { useLanguageStore } from '@/stores/language-store';
import en from '@/locales/en';
vi.mock('@/lib/api', () => ({ getProtocol: vi.fn(), updateProtocol: vi.fn() }));
const step = { step: 1, label: 'Synthetic step', temperature: 60, duration_sec: 30, cycles: 1, phase: '', goto_label: '', plate_read: false, temp_increment: null, read_channels: [] };
beforeEach(() => { vi.clearAllMocks(); useLanguageStore.getState().setLanguage('en'); useSessionStore.setState({ sessionId: 'protocol-a' }); });

// --- P10: read-only summary is the default view, editing is opt-in ------
it('announces lookup separately from saving and labels each editable step', async () => {
  let resolve!: (value: Awaited<ReturnType<typeof getProtocol>>) => void;
  vi.mocked(getProtocol).mockReturnValue(new Promise(done => { resolve = done; }));
  render(<ProtocolTab />);
  expect(screen.getByRole('status')).toHaveTextContent(en.loading);
  expect(screen.queryByText(en.saving)).not.toBeInTheDocument();
  await act(async () => resolve({ steps: [step] }));
  fireEvent.click(screen.getByText(en.protocolEditButton));
  expect(screen.getByLabelText(`${en.label} 1`)).toHaveValue(step.label);
});

it('shows a read-only summary by default and switches to inputs only after Edit protocol is clicked', async () => {
  vi.mocked(getProtocol).mockResolvedValue({ steps: [step] });
  render(<ProtocolTab />);
  await screen.findByText(step.label);
  expect(screen.queryByLabelText(`${en.label} 1`)).not.toBeInTheDocument();
  expect(screen.queryByText(en.addStep)).not.toBeInTheDocument();
  fireEvent.click(screen.getByText(en.protocolEditButton));
  expect(await screen.findByLabelText(`${en.label} 1`)).toHaveValue(step.label);
  expect(screen.getByText(en.addStep)).toBeInTheDocument();
});

it('returns to the read-only summary after a successful save', async () => {
  vi.mocked(getProtocol).mockResolvedValue({ steps: [step] });
  vi.mocked(updateProtocol).mockResolvedValue({ status: 'ok' });
  render(<ProtocolTab />);
  await screen.findByText(step.label);
  fireEvent.click(screen.getByText(en.protocolEditButton));
  await screen.findByDisplayValue(step.label);
  fireEvent.click(screen.getByText(en.saveProtocol));
  await screen.findByText(en.protocolSaved);
  expect(screen.queryByDisplayValue(step.label)).not.toBeInTheDocument();
  expect(screen.getByText(en.protocolEditButton)).toBeInTheDocument();
});

it('returns to the read-only summary after Cancel, discarding the draft edit', async () => {
  vi.mocked(getProtocol).mockResolvedValue({ steps: [step] });
  render(<ProtocolTab />);
  await screen.findByText(step.label);
  fireEvent.click(screen.getByText(en.protocolEditButton));
  const input = await screen.findByDisplayValue(step.label);
  fireEvent.change(input, { target: { value: 'Draft' } });
  fireEvent.click(screen.getByText(en.cancel));
  expect(screen.queryByDisplayValue('Draft')).not.toBeInTheDocument();
  expect(screen.getByText(step.label)).toBeInTheDocument();
  expect(screen.getByText(en.protocolEditButton)).toBeInTheDocument();
});

it('does not replace current session protocol with a late prior response', async () => {
  let resolve!: (value: Awaited<ReturnType<typeof getProtocol>>) => void;
  vi.mocked(getProtocol).mockReturnValueOnce(new Promise(done => { resolve = done; })).mockResolvedValue({ steps: [{ ...step, label: 'Current' }] });
  render(<ProtocolTab />);
  await act(async () => useSessionStore.setState({ sessionId: 'protocol-b' }));
  expect(await screen.findByText('Current')).toBeInTheDocument();
  await act(async () => resolve({ steps: [step] }));
  expect(screen.getByText('Current')).toBeInTheDocument();
  expect(screen.queryByText(step.label)).not.toBeInTheDocument();
});

it('retains edits on save failure and reports only a safe localized error, without leaving edit mode', async () => {
  vi.mocked(getProtocol).mockResolvedValue({ steps: [step] });
  vi.mocked(updateProtocol).mockRejectedValue(new Error('private diagnostic'));
  render(<ProtocolTab />);
  await screen.findByText(step.label);
  fireEvent.click(screen.getByText(en.protocolEditButton));
  const input = await screen.findByDisplayValue(step.label);
  fireEvent.change(input, { target: { value: 'Edited' } });
  fireEvent.click(screen.getByText(en.saveProtocol));
  expect(await screen.findByRole('alert')).toHaveTextContent(en.errSaveProtocol);
  expect(screen.getByRole('alert')).toHaveClass('border-danger', 'bg-danger/10');
  expect(screen.getByRole('alert').querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  expect(input).toHaveValue('Edited');
  // Only success/Cancel return to read-only -- a failed save must not.
  expect(screen.getByText(en.saveProtocol)).toBeInTheDocument();
});

it('does not announce an old save after session replacement and supports local Cancel', async () => {
  let resolve!: (value: Awaited<ReturnType<typeof updateProtocol>>) => void;
  vi.mocked(getProtocol).mockResolvedValue({ steps: [step] });
  vi.mocked(updateProtocol).mockReturnValue(new Promise(done => { resolve = done; }));
  const dirty = vi.fn(); window.addEventListener('asg-result-dirty', dirty);
  render(<ProtocolTab />);
  await screen.findByText(step.label);
  fireEvent.click(screen.getByText(en.protocolEditButton));
  const input = await screen.findByDisplayValue(step.label);
  fireEvent.change(input, { target: { value: 'Draft' } });
  fireEvent.click(screen.getByText(en.cancel));
  expect(screen.queryByDisplayValue('Draft')).not.toBeInTheDocument();

  fireEvent.click(screen.getByText(en.protocolEditButton));
  await screen.findByDisplayValue(step.label);
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
      await screen.findByText(step.label);
      fireEvent.click(screen.getByText(en.protocolEditButton));
      await screen.findByDisplayValue(step.label);
      fireEvent.click(screen.getByText(en.saveProtocol));
    }
    await act(async () => {
      useSessionStore.setState(state => ({ entryGeneration: state.entryGeneration + 1 }));
      reject(new Error('private stale failure'));
      await Promise.resolve();
    });
    await screen.findByText(step.label);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
}

it('styles Add step through the --color-primary token, not a hardcoded blue (P6-S2-T1)', async () => {
  vi.mocked(getProtocol).mockResolvedValue({ steps: [step] });
  render(<ProtocolTab />);
  await screen.findByText(step.label);
  fireEvent.click(screen.getByText(en.protocolEditButton));
  const addStepBtn = await screen.findByText(en.addStep);
  expect(addStepBtn).toHaveStyle({ background: 'var(--color-primary)', color: 'var(--color-on-primary)' });
});

it('distinguishes failed lookup, retry-empty and saved without losing added steps', async () => {
  vi.mocked(getProtocol).mockRejectedValueOnce(new Error('private')).mockResolvedValue({ steps: [] });
  vi.mocked(updateProtocol).mockResolvedValue({ status: 'ok' });
  render(<ProtocolTab />);
  expect(await screen.findByRole('alert')).toHaveTextContent(en.errLoadProtocol);
  fireEvent.click(screen.getByText(en.retry));
  await screen.findByText(en.protocolEmpty);
  fireEvent.click(screen.getByText(en.protocolEditButton));
  fireEvent.click(screen.getByText(en.addStep));
  fireEvent.change(screen.getByLabelText(`${en.label} 1`), { target: { value: 'New' } });
  fireEvent.click(screen.getByText(en.saveProtocol));
  await screen.findByText(en.protocolSaved);
  expect(screen.getByText('New')).toBeInTheDocument();
  fireEvent.click(screen.getByText(en.protocolEditButton));
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
  await screen.findByText('s1');
  fireEvent.click(screen.getByText(en.protocolEditButton));
  for (let i = 0; i < phases.length; i++) {
    const row = (await screen.findByDisplayValue(`s${i + 1}`)).closest('tr') as HTMLTableRowElement;
    expect(row.style.borderLeft).toBe(`3px solid ${phases[i].border}`);
    // The phase-name label now lives in the shared group-header row (one
    // band per step here, since no two consecutive steps share a phase)
    // rather than inline above the step number.
    const header = screen.getByTestId(`protocol-group-header-${phases[i].phase}-${i}`);
    const labelSpan = Array.from(header.querySelectorAll('span')).find((el) => el.textContent === phases[i].phase) as HTMLElement;
    expect(labelSpan.style.color).toBe(phases[i].label);
  }
});

// P2-S1-T1: the read marker must track the `plate_read` field, never the
// free-text `label` a user can rename at will.
it('keeps the read marker keyed to plate_read after the label is edited to text with no "read" keywords', async () => {
  vi.mocked(getProtocol).mockResolvedValue({
    steps: [
      { ...step, step: 1, label: 'Pre-Read', plate_read: true },
      { ...step, step: 2, label: 'Data Collection', plate_read: false },
    ],
  });
  render(<ProtocolTab />);
  await screen.findByText('Pre-Read');
  fireEvent.click(screen.getByText(en.protocolEditButton));
  await screen.findByDisplayValue('Pre-Read');
  // Sanity: step 2's label alone would have tripped the old label-substring
  // heuristic ("data collection"), yet plate_read is false for it.
  expect(screen.getByTestId('protocol-read-marker-1')).toBeInTheDocument();
  expect(screen.queryByTestId('protocol-read-marker-2')).not.toBeInTheDocument();

  fireEvent.change(screen.getByDisplayValue('Pre-Read'), { target: { value: 'Annealing/Extension' } });
  expect(screen.getByTestId('protocol-read-marker-1')).toBeInTheDocument();

  fireEvent.change(screen.getByDisplayValue('Data Collection'), { target: { value: 'Pre-Read' } });
  expect(screen.queryByTestId('protocol-read-marker-2')).not.toBeInTheDocument();
});

it('preserves plate_read and temp_increment through save, unmodified by editing an unrelated field', async () => {
  vi.mocked(getProtocol).mockResolvedValue({
    steps: [{ ...step, step: 1, plate_read: true, temp_increment: -0.6, cycles: 10 }],
  });
  vi.mocked(updateProtocol).mockResolvedValue({ status: 'ok' });
  render(<ProtocolTab />);
  await screen.findByText(step.label);
  fireEvent.click(screen.getByText(en.protocolEditButton));
  const input = await screen.findByDisplayValue(step.label);
  fireEvent.change(input, { target: { value: 'Renamed' } });
  fireEvent.click(screen.getByText(en.saveProtocol));
  await screen.findByText(en.protocolSaved);
  expect(updateProtocol).toHaveBeenCalledWith('protocol-a', [
    expect.objectContaining({ plate_read: true, temp_increment: -0.6 }),
  ]);
});

it('gives a newly added step explicit read/touchdown/channel defaults, not undefined', async () => {
  vi.mocked(getProtocol).mockResolvedValue({ steps: [] });
  vi.mocked(updateProtocol).mockResolvedValue({ status: 'ok' });
  render(<ProtocolTab />);
  await screen.findByText(en.protocolEmpty);
  fireEvent.click(screen.getByText(en.protocolEditButton));
  fireEvent.click(screen.getByText(en.addStep));
  fireEvent.click(screen.getByText(en.saveProtocol));
  await screen.findByText(en.protocolSaved);
  expect(updateProtocol).toHaveBeenCalledWith('protocol-a', [
    expect.objectContaining({ plate_read: false, temp_increment: null, read_channels: [] }),
  ]);
});

it('shows a read-channel chip per role reported by the protocol response contract', async () => {
  vi.mocked(getProtocol).mockResolvedValue({
    steps: [step],
    role_channels: { WT: 'FAM', MT1: 'HEX', normalization: 'ROX' },
  });
  render(<ProtocolTab />);
  await screen.findByText(step.label);
  expect(screen.getByTestId('protocol-channel-chip-WT')).toHaveTextContent('FAM');
  expect(screen.getByTestId('protocol-channel-chip-MT1')).toHaveTextContent('HEX');
  expect(screen.getByTestId('protocol-channel-chip-normalization')).toHaveTextContent('ROX');
});

it('shows no channel chips or card when the response carries no channel metadata', async () => {
  vi.mocked(getProtocol).mockResolvedValue({ steps: [step] });
  render(<ProtocolTab />);
  await screen.findByText(step.label);
  expect(screen.queryByTestId('protocol-channel-card')).not.toBeInTheDocument();
});

it('renders the thermal profile diagram with one segment per step, reactive to table edits', async () => {
  vi.mocked(getProtocol).mockResolvedValue({
    steps: [
      { ...step, step: 1, label: 'A' },
      { ...step, step: 2, label: 'B' },
      { ...step, step: 3, label: 'C' },
    ],
  });
  render(<ProtocolTab />);
  await screen.findByText('A');
  fireEvent.click(screen.getByText(en.protocolEditButton));
  await screen.findByDisplayValue('A');
  expect(screen.getByTestId('protocol-step-1')).toBeInTheDocument();
  expect(screen.getByTestId('protocol-step-2')).toBeInTheDocument();
  expect(screen.getByTestId('protocol-step-3')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: `${en.delete} 3` }));
  expect(screen.queryByTestId('protocol-step-3')).not.toBeInTheDocument();
});

// --- P10: phase grouping, GOTO range preservation, honesty ---------------

it('colors each phase group header the same as its stripe in the thermal diagram', async () => {
  vi.mocked(getProtocol).mockResolvedValue({
    steps: [
      { ...step, step: 1, phase: 'Amplification 1', cycles: 10 },
      { ...step, step: 2, phase: 'Amplification 1', cycles: 10 },
    ],
  });
  render(<ProtocolTab />);
  await screen.findByText(en.protocolEditButton);
  const band = screen.getByTestId('protocol-phase-band-Amplification 1-0');
  expect(band.querySelector('rect')).toHaveAttribute('fill', '#f59e0b');
  const header = screen.getByTestId('protocol-group-header-Amplification 1-0');
  expect(header).toHaveStyle({ borderLeft: '3px solid rgb(245, 158, 11)' });
});

it('shows the preserved repeat range instead of collapsing it to just x-N', async () => {
  vi.mocked(getProtocol).mockResolvedValue({
    steps: [
      { ...step, step: 1, phase: 'Amplification 1', cycles: 10, label: 'Denaturation' },
      { ...step, step: 2, phase: 'Amplification 1', cycles: 10, label: 'Annealing', goto_label: '↩ Repeat Steps 1-2 × 10 cycles' },
    ],
  });
  render(<ProtocolTab />);
  await screen.findByText('Denaturation');
  expect(screen.getByTestId('protocol-goto-range-Amplification 1-0')).toHaveTextContent(en.protocolGotoRange(1, 2, 10));
});

it('does not confidently show a wrong repeat range after step numbers shift from a delete', async () => {
  vi.mocked(getProtocol).mockResolvedValue({
    steps: [
      { ...step, step: 1, phase: '', label: 'Pre-read' },
      { ...step, step: 2, phase: 'Amplification 1', cycles: 10, label: 'Denaturation' },
      { ...step, step: 3, phase: 'Amplification 1', cycles: 10, label: 'Annealing', goto_label: '↩ Repeat Steps 2-3 × 10 cycles' },
    ],
  });
  render(<ProtocolTab />);
  await screen.findByText('Pre-read');
  // Before the delete: the range is trustworthy and shown specifically.
  expect(screen.getByTestId('protocol-goto-range-Amplification 1-1')).toHaveTextContent(en.protocolGotoRange(2, 3, 10));

  fireEvent.click(screen.getByText(en.protocolEditButton));
  await screen.findByDisplayValue('Pre-read');
  fireEvent.click(screen.getByRole('button', { name: `${en.delete} 1` }));
  // After deleting step 1, Denaturation/Annealing renumber to 1/2, but the
  // stored goto_label text still says "2-3" -- must not be shown as if
  // still correct.
  expect(screen.getByTestId('protocol-goto-stale')).toHaveTextContent(en.protocolGotoStale);
  expect(screen.queryByText(en.protocolGotoRange(2, 3, 10))).not.toBeInTheDocument();
});

it('drops the single x-N cycle badge once an edit makes a group disagree on cycles', async () => {
  vi.mocked(getProtocol).mockResolvedValue({
    steps: [
      { ...step, step: 1, phase: 'Amplification 1', cycles: 10, label: 'Denaturation' },
      { ...step, step: 2, phase: 'Amplification 1', cycles: 10, label: 'Annealing' },
    ],
  });
  render(<ProtocolTab />);
  await screen.findByText('Denaturation');
  fireEvent.click(screen.getByText(en.protocolEditButton));
  await screen.findByDisplayValue('Denaturation');
  expect(screen.getByTestId('protocol-group-header-Amplification 1-0')).toHaveTextContent('×10');
  fireEvent.change(screen.getByLabelText(`${en.cycles} 2`), { target: { value: '12' } });
  expect(screen.getByTestId('protocol-group-header-Amplification 1-0')).not.toHaveTextContent('×10');
  expect(screen.getByTestId('protocol-group-header-Amplification 1-0')).not.toHaveTextContent('×12');
});

it('shows a per-step read-channel chip only when read_channels is actually non-empty', async () => {
  vi.mocked(getProtocol).mockResolvedValue({
    steps: [
      { ...step, step: 1, read_channels: [] },
      { ...step, step: 2, label: 'Data Collection', plate_read: true, read_channels: ['FAM', 'HEX'] },
    ],
  });
  render(<ProtocolTab />);
  await screen.findByText(step.label);
  const row1 = screen.getByText(step.label).closest('tr');
  expect(row1).not.toHaveTextContent('FAM');
  expect(screen.getByText('Data Collection').closest('tr')).toHaveTextContent('FAM, HEX');
});

it('does not break for an empty protocol', async () => {
  vi.mocked(getProtocol).mockResolvedValue({ steps: [] });
  render(<ProtocolTab />);
  await screen.findByText(en.protocolEmpty);
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
});

it('does not break for a single step with no phase/group', async () => {
  vi.mocked(getProtocol).mockResolvedValue({ steps: [{ ...step, step: 1 }] });
  render(<ProtocolTab />);
  expect(await screen.findByText(step.label)).toBeInTheDocument();
});

it('does not break for a single phase group spanning the whole protocol', async () => {
  vi.mocked(getProtocol).mockResolvedValue({ steps: [{ ...step, step: 1, phase: 'Post-read', cycles: 1 }] });
  render(<ProtocolTab />);
  expect(await screen.findByTestId('protocol-group-header-Post-read-0')).toBeInTheDocument();
});

// Task 5: below 768px, each step becomes a 2-column field card instead of
// a table row (index.css's .protocol-edit-table media query). jsdom does
// not evaluate media queries, so this only asserts the CSS hooks that
// query relies on are actually present, plus the 44px minimum touch
// target on every actionable button in the edit form.
it('marks the edit table/rows with the responsive-card CSS hooks and gives every button a 44px touch target', async () => {
  vi.mocked(getProtocol).mockResolvedValue({ steps: [step] });
  render(<ProtocolTab />);
  await screen.findByText(step.label);
  fireEvent.click(screen.getByText(en.protocolEditButton));
  await screen.findByDisplayValue(step.label);
  expect(document.getElementById('protocol-table')).toHaveClass('protocol-edit-table');
  expect(screen.getByRole('button', { name: `${en.delete} 1` }).closest('tr')).toHaveClass('protocol-edit-row');
  for (const label of [en.addStep, en.saveProtocol, en.cancel, `${en.delete} 1`]) {
    const button = screen.getByRole('button', { name: label });
    expect(button.className).toMatch(/min-h-11/);
  }
});

// Regression: the read-only region reused the editable table's 500px
// scroll-clamp style. That box is an inner `overflow:auto` container, not
// page-level scroll, so a fullPage screenshot does not expand it -- every
// step row/group past ~500px worth of content (the last group, in a
// realistic 10-step/8-phase protocol) was silently clipped out of view
// even though it was present in the DOM the whole time (884 unit tests
// passed regardless, since none of them checked for this style). The
// read-only summary must never impose that clamp.
it('does not impose the editable table\'s 500px scroll clamp on the read-only summary (regression: trailing groups clipped out of view)', async () => {
  vi.mocked(getProtocol).mockResolvedValue({
    steps: [
      { ...step, step: 1, label: 'Pre-read', phase: 'Pre-read' },
      { ...step, step: 2, label: 'Initial Denaturation', phase: 'Initial Denaturation' },
      { ...step, step: 3, label: 'Denaturation', phase: 'Amplification 1 (Touchdown)', cycles: 12 },
      { ...step, step: 4, label: 'Annealing/Extension', phase: 'Amplification 1 (Touchdown)', cycles: 12, goto_label: '↩ Repeat Steps 3-4 × 12 cycles' },
      { ...step, step: 5, label: 'Denaturation 2', phase: 'Amplification 2', cycles: 12 },
      { ...step, step: 6, label: 'Annealing/Extension 2', phase: 'Amplification 2', cycles: 12, goto_label: '↩ Repeat Steps 5-6 × 12 cycles' },
      { ...step, step: 7, label: 'Secondary Denaturation Hold', phase: 'Secondary Denaturation Hold' },
      { ...step, step: 8, label: 'Extension (Touchdown)', phase: 'Extension (Touchdown)', cycles: 12, goto_label: '↩ Repeat Step 8 × 12 cycles' },
      { ...step, step: 9, label: 'Final Extension Hold', phase: 'Final Extension Hold' },
      { ...step, step: 10, label: 'Post-read', phase: 'Post-read' },
    ],
  });
  render(<ProtocolTab />);
  // "Post-read" is ambiguous by plain text (diagram <title> + sr-only
  // legend + the row itself); wait on the last step's own table cell
  // (unique: no other row shares this step number).
  await screen.findAllByText('Post-read');
  const region = screen.getByRole('region', { name: en.pcrProtocolSteps });
  expect(region.style.maxHeight).toBe('');
  // Vertical clamp gone, but horizontal overflow containment is kept
  // (the read-only table's columns don't fit a narrow viewport -- see
  // ProtocolStepsTable.tsx's comment) so it never leaks into
  // document-level horizontal scroll.
  expect(region.style.overflow).toBe('');
  expect(region.style.overflowX).toBe('auto');
  // Every step row must actually be in the document, not merely
  // reachable by scrolling an inner clamp box. 6 of the 8 phase bands
  // here are single-step bands whose phase name repeats their own
  // step's label (Pre-read, Initial Denaturation, Secondary
  // Denaturation Hold, Extension (Touchdown), Final Extension Hold,
  // Post-read) and so get no separate header row (P10 follow-up) --
  // only the 2 real multi-step bands (Amplification 1/2) do.
  expect(document.querySelectorAll('#protocol-table tbody tr')).toHaveLength(10 + 2);
  for (const label of ['Pre-read', 'Final Extension Hold', 'Post-read']) {
    expect(screen.getAllByText(label).length).toBeGreaterThan(0);
  }
});

it('inlines a redundant singleton band\'s GOTO/cycles badge onto its own step row instead of dropping it', async () => {
  // "Extension (Touchdown)" is both: (a) a single-step band whose phase
  // name repeats its own label (no separate header row, per the above),
  // and (b) a genuine repeat (12 cycles, a goto_label) -- the badge that
  // information carries must not be lost just because the header went
  // away.
  vi.mocked(getProtocol).mockResolvedValue({
    steps: [
      { ...step, step: 1, label: 'Extension (Touchdown)', phase: 'Extension (Touchdown)', cycles: 12, goto_label: '↩ Repeat Step 1 × 12 cycles' },
    ],
  });
  render(<ProtocolTab />);
  await screen.findByText('Extension (Touchdown)');
  expect(screen.queryByTestId('protocol-group-header-Extension (Touchdown)-0')).not.toBeInTheDocument();
  expect(screen.getByText('Extension (Touchdown)').closest('tr')).toHaveTextContent(en.protocolGotoRange(1, 1, 12));
});

// P10 follow-up (independent review): a single-step band whose phase
// name only repeats its own step's label produced a header row saying
// the exact same word the step row already says, right above it.
describe('redundant singleton phase-band header folding', () => {
  it('does not render a separate header row for a single step whose phase name equals its own label', async () => {
    vi.mocked(getProtocol).mockResolvedValue({
      steps: [{ ...step, step: 1, label: 'Initial Denaturation', phase: 'Initial Denaturation' }],
    });
    render(<ProtocolTab />);
    // "Initial Denaturation" also appears in the diagram's <title> tooltip
    // and its sr-only phase legend, so it's ambiguous for a plain text
    // query -- wait on the always-unique Edit button instead, then scope
    // to the step's own table row.
    await screen.findByText(en.protocolEditButton);
    expect(screen.queryByTestId('protocol-group-header-Initial Denaturation-0')).not.toBeInTheDocument();
    const row = document.querySelector('#protocol-table tbody tr') as HTMLTableRowElement;
    expect(row).toHaveTextContent('Initial Denaturation');
    // The information isn't lost -- it's just not duplicated: the phase
    // color still marks the row (left border), it's simply not repeated
    // as a second line of identical text above it.
    expect(row).toHaveStyle({ borderLeft: '3px solid rgb(239, 68, 68)' });
  });

  // Case-only difference, matching real parser output (both eds_raw.py
  // and pcrd_raw.py emit phase "Pre-read"/"Post-read" but label
  // "Pre-Read"/"Post-Read" for that same step).
  it('folds a header even when the phase/label match only case-insensitively', async () => {
    vi.mocked(getProtocol).mockResolvedValue({
      steps: [{ ...step, step: 1, label: 'Pre-Read', phase: 'Pre-read', plate_read: true }],
    });
    render(<ProtocolTab />);
    await screen.findByText('Pre-Read');
    expect(screen.queryByTestId('protocol-group-header-Pre-read-0')).not.toBeInTheDocument();
  });

  it('keeps the header row when the phase name adds information beyond the step\'s own label', async () => {
    vi.mocked(getProtocol).mockResolvedValue({
      steps: [{ ...step, step: 1, label: 'Denaturation', phase: 'Amplification 1', cycles: 1 }],
    });
    render(<ProtocolTab />);
    await screen.findByText('Denaturation');
    expect(screen.getByTestId('protocol-group-header-Amplification 1-0')).toBeInTheDocument();
  });

  it('keeps the header row for a real multi-step band even if every step happens to share the phase name as its label', async () => {
    vi.mocked(getProtocol).mockResolvedValue({
      steps: [
        { ...step, step: 1, label: 'Hold', phase: 'Hold' },
        { ...step, step: 2, label: 'Hold', phase: 'Hold' },
      ],
    });
    render(<ProtocolTab />);
    await screen.findByText(en.protocolEditButton);
    expect(screen.getByTestId('protocol-group-header-Hold-0')).toBeInTheDocument();
  });
});
