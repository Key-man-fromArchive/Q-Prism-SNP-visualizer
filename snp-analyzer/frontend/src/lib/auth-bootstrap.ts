import { asgLaunchCookie, getAuthConfig, getMe } from './api';
import type { AuthConfigResponse, LoginResponse } from '@/types/auth';

type BootstrapResult = { config: AuthConfigResponse; login: LoginResponse | null; launchFailed: boolean };
type Attempt = { login: LoginResponse | null; launchFailed: boolean };

function statusOf(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null && 'status' in error ? Number((error as { status: unknown }).status) : undefined;
}
// A 401 from the launch cookie route only means no launch is pending (a direct
// visit); any other failure is a launch that ASG started and SNP could not finish.
async function authenticate(config: AuthConfigResponse): Promise<Attempt> {
  if (config.auth_mode !== 'asg_launch') return { login: await getMe(), launchFailed: false };
  let launchFailed = false;
  try { return { login: await asgLaunchCookie(), launchFailed }; }
  catch (error) { launchFailed = statusOf(error) !== 401; }
  try { return { login: await getMe(), launchFailed: false }; }
  catch { return { login: null, launchFailed }; }
}
/** Return no error body or credential. A mounted subscriber decides whether the result is still owned. */
export async function bootstrapAuth(): Promise<BootstrapResult> {
  let config: AuthConfigResponse = { auth_mode: 'local' };
  try {
    config = await getAuthConfig();
    return { config, ...(await authenticate(config)) };
  } catch { return { config, login: null, launchFailed: false }; }
}
