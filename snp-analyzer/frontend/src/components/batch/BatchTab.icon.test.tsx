// @TASK P31-ICON - file-bundle icon next to the Sessions panel title
// @SPEC 사용자 요청 "배치분석은 파일묶음 같아 보이는 파비콘이나 아이콘 등 쓰면 좋을듯" (feedback-2026-09-11)
import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { BatchTab } from './BatchTab';
import { useAuthStore } from '@/stores/auth-store';
import { useLanguageStore } from '@/stores/language-store';
import { useSessionStore } from '@/stores/session-store';
import { getSessions } from '@/lib/api';

vi.mock('@/lib/api', async original => ({
  ...await original<typeof import('@/lib/api')>(),
  getSessions: vi.fn().mockResolvedValue([]),
  getProjects: vi.fn().mockResolvedValue({ projects: [] }),
}));

beforeEach(() => {
  vi.clearAllMocks(); useSessionStore.getState().reset(); useLanguageStore.setState({ language: 'en' });
  useAuthStore.setState({ user: { id: 'u', username: 'u', role: 'admin', display_name: null } });
  vi.mocked(getSessions).mockResolvedValue([]);
});

it('marks a decorative file-bundle icon next to the Sessions title as aria-hidden', async () => {
  render(<BatchTab />);
  const heading = await screen.findByRole('heading', { name: 'Sessions' });
  const icon = heading.parentElement?.querySelector('svg');
  expect(icon).not.toBeNull();
  expect(icon).toHaveAttribute('aria-hidden', 'true');
  // The heading's accessible name stays exactly the title text: the icon adds no name of its own.
  expect(heading).toHaveAccessibleName('Sessions');
});

it('keeps the existing view toggle and session count next to the icon', async () => {
  render(<BatchTab />);
  await screen.findByRole('heading', { name: 'Sessions' });
  expect(screen.getByRole('button', { name: 'Table' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Calendar' })).toBeInTheDocument();
  expect(screen.getByText('0 session(s)')).toBeInTheDocument();
});
