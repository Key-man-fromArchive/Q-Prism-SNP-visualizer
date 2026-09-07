import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AddToProjectButton } from './AddToProjectButton';
import { getProjects, addProjectSession } from '@/lib/api';
import { useSessionStore } from '@/stores/session-store';
import { useAuthStore } from '@/stores/auth-store';
import { useLanguageStore } from '@/stores/language-store';
vi.mock('@/lib/api', () => ({ getProjects: vi.fn(), addProjectSession: vi.fn() }));
beforeEach(() => {
  vi.resetAllMocks();
  useLanguageStore.setState({ language: 'en' });
  useSessionStore.setState({ sessionId: 's', entryGeneration: 1 });
  useAuthStore.setState({ user: { id: 'u', username: 'u', display_name: null, role: 'user' } });
  vi.mocked(getProjects).mockResolvedValue({ projects: [{ id: 'p', name: 'Synthetic project', session_count: 0, created_at: '2026-09-07T00:00:00Z' }] });
});
it('opens an accessible project dialog and restores focus on Escape', async () => {
  render(<AddToProjectButton />);
  const trigger = screen.getByRole('button', { name: /Project/ });
  trigger.focus(); fireEvent.click(trigger);
  const dialog = await screen.findByRole('dialog');
  expect(document.body.style.overflow).toBe('hidden');
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(trigger).toHaveFocus();
  expect(document.body.style.overflow).not.toBe('hidden');
});
it('does not disclose a private server error after adding fails', async () => {
  vi.mocked(addProjectSession).mockRejectedValue(new Error('private://internal-secret'));
  render(<AddToProjectButton />);
  fireEvent.click(screen.getByRole('button', { name: /Project/ }));
  fireEvent.click(await screen.findByRole('button', { name: /Synthetic project/ }));
  await waitFor(() => expect(addProjectSession).toHaveBeenCalled());
  expect(await screen.findByRole('alert')).not.toHaveTextContent('private://');
});
it('ignores a delayed project list after a session entry changes', async () => {
  let resolve!: (value: Awaited<ReturnType<typeof getProjects>>) => void;
  vi.mocked(getProjects).mockReturnValue(new Promise(done => { resolve = done; }));
  render(<AddToProjectButton />);
  fireEvent.click(screen.getByRole('button', { name: /Project/ }));
  act(() => useSessionStore.setState({ sessionId: 'other', entryGeneration: 2 }));
  await act(async () => resolve({ projects: [{ id: 'p', name: 'Old private project', session_count: 0, created_at: '2026-09-07T00:00:00Z' }] }));
  expect(screen.queryByText('Old private project')).not.toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it('keeps confirmed addition separate from failed list refresh and retry never repeats the mutation', async () => {
  vi.mocked(addProjectSession).mockResolvedValue({ status: 'ok', session_ids: ['run-a'] });
  render(<AddToProjectButton />);
  fireEvent.click(screen.getByRole('button', { name: /Project/ }));
  const choice = await screen.findByRole('button', { name: /Synthetic project/ });
  vi.mocked(getProjects).mockRejectedValueOnce(new Error('private refresh failure'));
  fireEvent.click(choice);
  expect(await screen.findByText(/Added to/)).toBeInTheDocument();
  expect(await screen.findByRole('alert')).toHaveTextContent('Failed to load projects');
  fireEvent.click(screen.getByRole('button', { name: /Retry/ }));
  await waitFor(() => expect(getProjects).toHaveBeenCalledTimes(3));
  expect(addProjectSession).toHaveBeenCalledTimes(1);
});
