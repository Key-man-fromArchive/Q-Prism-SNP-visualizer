import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { SettingsTab } from './SettingsTab';
import { ApiError, createPreset, getPresets } from '@/lib/api';
import { useLanguageStore } from '@/stores/language-store';
vi.mock('@/lib/api', async original => ({ ...await original<typeof import('@/lib/api')>(),
  getPresets: vi.fn(), createPreset: vi.fn(), deletePreset: vi.fn() }));
beforeEach(() => { vi.resetAllMocks(); useLanguageStore.getState().setLanguage('en'); });
it('shows save success and independently retryable failed list refresh, preserving failed form input', async () => {
  vi.mocked(getPresets).mockResolvedValueOnce({ presets: [] }).mockRejectedValueOnce(new ApiError('private details', 500, {})).mockResolvedValue({ presets: [] });
  vi.mocked(createPreset).mockRejectedValueOnce(new ApiError('private details', 500, {}))
    .mockResolvedValue({ id: 'p', name: 'Keep this', builtin: false, settings: {} });
  const view = render(<SettingsTab />);
  await waitFor(() => expect(getPresets).toHaveBeenCalledOnce());
  const input = view.container.querySelector('#preset-name-input')!;
  fireEvent.change(input, { target: { value: 'Keep this' } });
  fireEvent.click(view.container.querySelector('#save-preset-btn')!);
  await screen.findByText('The server could not complete this request.');
  expect(input).toHaveValue('Keep this');
  expect(screen.queryByText('private details')).not.toBeInTheDocument();
  fireEvent.click(view.container.querySelector('#save-preset-btn')!);
  await screen.findByText('Preset saved.');
  fireEvent.click(await screen.findByRole('button', { name: 'Retry list refresh' }));
  await waitFor(() => expect(getPresets).toHaveBeenCalledTimes(3));
  expect(createPreset).toHaveBeenCalledTimes(2);
});
