import { beforeEach, expect, it, vi } from 'vitest';

vi.mock('./api', () => ({ getAuthConfig: vi.fn(), getMe: vi.fn(), asgLaunchCookie: vi.fn() }));

import { asgLaunchCookie, getAuthConfig, getMe } from './api';
import { bootstrapAuth } from './auth-bootstrap';

const user = { user: { id: 'u', username: 'u', role: 'user', display_name: null } };
const failure = (status: number) => Object.assign(new Error(String(status)), { status });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getAuthConfig).mockResolvedValue({ auth_mode: 'asg_launch' });
});

it('signs in through the launch cookie in asg_launch mode', async () => {
  vi.mocked(asgLaunchCookie).mockResolvedValue(user as never);
  const result = await bootstrapAuth();
  expect(asgLaunchCookie).toHaveBeenCalledWith();
  expect(result).toMatchObject({ login: user, launchFailed: false });
});

it('a direct visit without a pending launch falls back to the current session', async () => {
  vi.mocked(asgLaunchCookie).mockRejectedValue(failure(401));
  vi.mocked(getMe).mockRejectedValue(failure(401));
  expect(await bootstrapAuth()).toMatchObject({ login: null, launchFailed: false });
});

it('reports a launch ASG started but SNP could not finish', async () => {
  vi.mocked(asgLaunchCookie).mockRejectedValue(failure(403));
  vi.mocked(getMe).mockRejectedValue(failure(401));
  expect(await bootstrapAuth()).toMatchObject({ login: null, launchFailed: true });
});

it('local mode only asks for the current user', async () => {
  vi.mocked(getAuthConfig).mockResolvedValue({ auth_mode: 'local' });
  vi.mocked(getMe).mockResolvedValue(user as never);
  expect(await bootstrapAuth()).toMatchObject({ login: user, launchFailed: false });
  expect(asgLaunchCookie).not.toHaveBeenCalled();
});
