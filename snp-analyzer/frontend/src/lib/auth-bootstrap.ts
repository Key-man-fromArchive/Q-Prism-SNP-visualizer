import { asgLaunch, asgLaunchCookie, getAuthConfig, getMe } from './api';
import type { AuthConfigResponse, LoginResponse } from '@/types/auth';

type BootstrapResult = { config: AuthConfigResponse; login: LoginResponse | null; launchFailed: boolean };
async function authenticate(config: AuthConfigResponse, token: string | null): Promise<LoginResponse> {
  if (config.auth_mode !== 'asg_launch') return getMe();
  if (token) return asgLaunch(token);
  try { return await asgLaunchCookie(); }
  catch { return getMe(); }
}
/** Return no error body or credential. A mounted subscriber decides whether the result is still owned. */
export async function bootstrapAuth(token: string | null): Promise<BootstrapResult> {
  let config: AuthConfigResponse = { auth_mode: 'local' };
  try {
    config = await getAuthConfig();
    return { config, login: await authenticate(config, token), launchFailed: false };
  } catch { return { config, login: null, launchFailed: token !== null }; }
}
