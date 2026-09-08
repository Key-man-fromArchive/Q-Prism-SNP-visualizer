import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { LoginPage } from './LoginPage';
import { login } from '@/lib/api';
import { useAuthStore } from '@/stores/auth-store';
import { useLanguageStore } from '@/stores/language-store';
import en from '@/locales/en';
vi.mock('@/lib/api', () => ({ login: vi.fn() }));
beforeEach(() => { vi.clearAllMocks(); useAuthStore.getState().clearAuth(); useLanguageStore.getState().setLanguage('en'); });
function submit(container: HTMLElement) {
  fireEvent.change(screen.getByLabelText(en.username), { target: { value: 'synthetic' } });
  fireEvent.change(screen.getByLabelText(en.password), { target: { value: 'private-test' } });
  fireEvent.submit(container.querySelector('form')!);
}
it('labels password-manager fields and sanitizes login errors', async () => {
  vi.mocked(login).mockRejectedValue(new Error('private backend stack'));
  const { container } = render(<LoginPage />);
  expect(screen.getByLabelText(en.username)).toHaveAttribute('autocomplete', 'username');
  expect(screen.getByLabelText(en.password)).toHaveAttribute('autocomplete', 'current-password');
  submit(container);
  expect(await screen.findByRole('alert')).toHaveTextContent(en.loginFailed);
  expect(container).not.toHaveTextContent('private backend');
});
it('ignores a successful login after owner generation changed and suppresses duplicate submit', async () => {
  let resolve!: (value: Awaited<ReturnType<typeof login>>) => void;
  vi.mocked(login).mockReturnValue(new Promise(done => { resolve = done; }));
  const { container } = render(<LoginPage />);
  submit(container); fireEvent.submit(container.querySelector('form')!);
  expect(login).toHaveBeenCalledTimes(1);
  useAuthStore.getState().clearAuth();
  await act(async () => resolve({ user: { id: 'old', username: 'synthetic', role: 'admin' } } as Awaited<ReturnType<typeof login>>));
  expect(useAuthStore.getState().user).toBeNull();
});
for (const change of ['unmount', 'mode', 'owner'] as const) for (const failure of [false, true]) {
  it(`ignores held login ${failure ? 'error' : 'success'} after ${change}`, async () => {
    useAuthStore.getState().setAuthMode('local');
    let resolve!: (value: Awaited<ReturnType<typeof login>>) => void;
    let reject!: (reason: Error) => void;
    vi.mocked(login).mockReturnValue(new Promise((done, fail) => { resolve = done; reject = fail; }));
    const view = render(<LoginPage />); submit(view.container);
    act(() => {
      if (change === 'unmount') view.unmount();
      if (change === 'mode') useAuthStore.getState().setAuthMode('asg_launch');
      if (change === 'owner') useAuthStore.getState().clearAuth();
    });
    await act(async () => {
      if (failure) reject(new Error('private late error'));
      else resolve({ user: { id: 'old', username: 'old', role: 'admin', display_name: null } } as Awaited<ReturnType<typeof login>>);
    });
    expect(useAuthStore.getState().user).toBeNull();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
}
