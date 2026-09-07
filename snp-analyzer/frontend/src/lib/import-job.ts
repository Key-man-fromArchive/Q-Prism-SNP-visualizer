import { useAuthStore } from '@/stores/auth-store';
import { useSessionStore } from '@/stores/session-store';
import { useUploadJobStore, type RecoveryReason, type UploadTicket } from '@/stores/upload-job-store';
import type { ImportParseResponse } from '@/types/api';
import { recoveryReason } from './recovery-reason';
import { validUploadResponse } from './upload-response';

type Outcome = { response: ImportParseResponse } | { reason: RecoveryReason };
function accepted(ticket: UploadTicket, entry: number): boolean {
  return useAuthStore.getState().user?.id === ticket.ownerId
    && useSessionStore.getState().entryGeneration === entry && useUploadJobStore.getState().current(ticket);
}
function publish(ticket: UploadTicket, response: ImportParseResponse): Outcome {
  const store = useUploadJobStore.getState();
  if (validUploadResponse(response)) {
    store.update(ticket, 0, { stage: 'success', sessionId: response.session_id });
    return { response };
  }
  if (response && typeof response === 'object' && 'status' in response) {
    store.update(ticket, 0, { stage: 'failed', reason: 'invalid' });
    return { response };
  }
  store.update(ticket, 0, { stage: 'unknown', reason: 'response_lost' });
  return { reason: 'response_lost' };
}
/** The callback/mapping is request-local; only filename and outcome enter the store. */
export async function runImportJob(filename: string, request: () => Promise<ImportParseResponse>): Promise<Outcome | null> {
  const owner = useAuthStore.getState().user?.id;
  if (!owner) return null;
  const entry = useSessionStore.getState().entryGeneration;
  const store = useUploadJobStore.getState();
  const ticket = store.begin(owner, [filename]);
  if (!ticket) return null;
  store.update(ticket, 0, { stage: 'uploading' });
  try {
    const response = await request();
    return accepted(ticket, entry) ? publish(ticket, response) : null;
  } catch (error) {
    if (!accepted(ticket, entry)) return null;
    const classified = recoveryReason(error);
    const reason = classified === 'network' ? 'response_lost' : classified;
    store.update(ticket, 0, { stage: reason === 'response_lost' ? 'unknown' : 'failed', reason });
    return { reason };
  } finally { store.finish(ticket); }
}
