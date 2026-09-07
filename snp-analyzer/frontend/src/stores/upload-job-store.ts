import { create } from 'zustand';

export type UploadStage = 'queued' | 'packaging' | 'uploading' | 'success' | 'failed' | 'unknown';
export type RecoveryReason = 'unauthorized' | 'forbidden' | 'not_found' | 'network' | 'server' | 'invalid' | 'response_lost';
export type UploadJob = Readonly<{
  id: string; batch: number; filename: string; stage: UploadStage;
  reason: RecoveryReason | null; sessionId: string | null;
}>;
export type UploadTicket = Readonly<{ ownerId: string; generation: number; batch: number }>;
type JobUpdate = { stage: UploadStage; reason?: RecoveryReason; sessionId?: string };
interface UploadJobState {
  ownerId: string | null;
  generation: number;
  batch: number;
  pending: boolean;
  jobs: readonly UploadJob[];
  begin: (ownerId: string, filenames: readonly string[]) => UploadTicket | null;
  current: (ticket: UploadTicket) => boolean;
  update: (ticket: UploadTicket, index: number, update: JobUpdate) => void;
  finish: (ticket: UploadTicket) => void;
  reset: () => void;
}
/** Metadata only. File objects and credentials never enter this non-persisted store. */
export function createUploadJobStore() {
  return create<UploadJobState>((set, get) => ({
    ownerId: null, generation: 0, batch: 0, pending: false, jobs: [],
    begin: (ownerId, filenames) => {
      if (get().ownerId !== ownerId) get().reset();
      if (get().pending || filenames.length === 0) return null;
      const batch = get().batch + 1;
      const jobs = filenames.map((filename, index): UploadJob => Object.freeze({
        id: `${batch}:${index}`, batch, filename, stage: 'queued', reason: null, sessionId: null,
      }));
      set({ ownerId, batch, pending: true, jobs: Object.freeze([...get().jobs, ...jobs]) });
      return Object.freeze({ ownerId, generation: get().generation, batch });
    },
    current: ticket => get().ownerId === ticket.ownerId && get().generation === ticket.generation && get().batch === ticket.batch && get().pending,
    update: (ticket, index, update) => {
      if (!get().current(ticket)) return;
      const id = `${ticket.batch}:${index}`;
      set({ jobs: Object.freeze(get().jobs.map(job => job.id === id ? Object.freeze({
        id: job.id, batch: job.batch, filename: job.filename, stage: update.stage,
        reason: update.reason ?? null, sessionId: update.sessionId ?? null,
      }) : job)) });
    },
    finish: ticket => { if (get().current(ticket)) set({ pending: false }); },
    reset: () => set({ ownerId: null, generation: get().generation + 1, batch: 0, pending: false, jobs: [] }),
  }));
}
export const useUploadJobStore = createUploadJobStore();
