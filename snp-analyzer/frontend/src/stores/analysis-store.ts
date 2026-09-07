import { create } from 'zustand';
import type { AnalysisStatus, ClusterResponse, ClusteringResult, ClusteringRequest } from '@/types/api';
import { isRevision } from '@/lib/analysis-context';

export type AnalysisTicket = { sessionId: string; ownerId: string; generation: number; loadGeneration: number; kind: 'analysis' | 'load' };
interface AnalysisState {
  submittedRequest: ClusteringRequest | null;
  currentRequest: ClusteringRequest | null;
  setCurrentRequest: (request: ClusteringRequest) => void;
  captureRequest: (request: ClusteringRequest) => void;
  sessionId: string | null;
  ownerId: string | null;
  generation: number;
  loadGeneration: number;
  localPending: boolean;
  result: ClusteringResult | null;
  currentInputRevision: number | null;
  knownInputRevision: number | null;
  inputRevisionRefreshing: boolean;
  inputRevisionError: unknown;
  beginInputRefresh: () => void;
  failInputRefresh: (error: unknown) => void;
  status: AnalysisStatus;
  pending: boolean;
  error: unknown;
  setSession: (sessionId: string | null, ownerId: string | null) => void;
  clear: () => void;
  beginRequest: (kind: AnalysisTicket['kind']) => AnalysisTicket;
  isCurrent: (ticket: AnalysisTicket) => boolean;
  accept: (ticket: AnalysisTicket, response: ClusterResponse) => boolean;
  fail: (ticket: AnalysisTicket, error: unknown) => boolean;
  updateInputRevision: (sessionId: string, ownerId: string, revision: number) => boolean;
}
const empty = { submittedRequest: null, currentRequest: null, result: null, currentInputRevision: null, knownInputRevision: null, inputRevisionRefreshing: false, inputRevisionError: null,
  status: 'idle', pending: false, localPending: false, error: null } as const;
function current(state: AnalysisState, ticket: AnalysisTicket): boolean {
  return state.sessionId === ticket.sessionId && state.ownerId === ticket.ownerId && state.generation === ticket.generation
    && (ticket.kind === 'analysis' || ticket.loadGeneration === state.loadGeneration);
}
function obsoleteRevision(state: AnalysisState, revision: unknown): boolean {
  return isRevision(revision) && state.knownInputRevision !== null && revision < state.knownInputRevision;
}
function settled(state: AnalysisState, ticket: AnalysisTicket): Partial<AnalysisState> {
  return ticket.kind === 'analysis' ? { generation: state.generation + 1, localPending: false }
    : { loadGeneration: state.loadGeneration + 1 };
}
function responseStatus(response: ClusterResponse, kind: AnalysisTicket['kind']): AnalysisStatus {
  if (response.analysis_status) return response.analysis_status;
  if (response.analysis_pending) return 'computing';
  if (kind === 'analysis' || response.algorithm !== null) return 'completed';
  return 'idle';
}
function responseRevision(state: AnalysisState, response: ClusterResponse) {
  const revision = isRevision(response.input_revision) ? response.input_revision : null;
  return { currentInputRevision: state.inputRevisionRefreshing || state.inputRevisionError !== null ? null : revision,
    knownInputRevision: revision ?? state.knownInputRevision };
}
/** Explicit owner identity invalidates same-session responses across authentication changes. */
export function createAnalysisStore() {
  return create<AnalysisState>((set, get) => ({
    ...empty, sessionId: null, ownerId: null, generation: 0, loadGeneration: 0,
    setSession: (sessionId, ownerId) => set(state => ({ ...empty, sessionId, ownerId, generation: state.generation + 1 })),
    clear: () => get().setSession(null, null),
    setCurrentRequest: request => set({ currentRequest: structuredClone(request) }),
    captureRequest: request => set({ submittedRequest: structuredClone(request) }),
    isCurrent: ticket => current(get(), ticket),
    beginInputRefresh: () => set(state => ({ currentInputRevision: null, inputRevisionRefreshing: true,
      inputRevisionError: null, loadGeneration: state.loadGeneration + 1 })),
    failInputRefresh: error => set({ currentInputRevision: null, inputRevisionRefreshing: false, inputRevisionError: error }),
    beginRequest: kind => {
      const state = get();
      if (state.sessionId === null || state.ownerId === null) throw new Error('No active analysis session');
      if (kind === 'analysis') set({ generation: state.generation + 1, status: 'computing', pending: true, localPending: true, error: null });
      else set({ loadGeneration: state.loadGeneration + 1 });
      return { sessionId: state.sessionId, ownerId: state.ownerId, generation: get().generation, loadGeneration: get().loadGeneration, kind };
    },
    accept: (ticket, response) => {
      const state = get();
      if (!current(state, ticket)) return false;
      if (obsoleteRevision(state, response.input_revision)) {
        if (ticket.kind === 'analysis') get().fail(ticket, new Error('Analysis completed for an obsolete input revision'));
        return false;
      }
      const keepPending = ticket.kind === 'load' && state.localPending;
      const status = keepPending ? 'computing' : responseStatus(response, ticket.kind);
      set({ result: response.algorithm === null ? null : structuredClone(response), status,
        pending: keepPending || (response.analysis_pending ?? status === 'computing'), error: null,
        ...responseRevision(state, response),
        ...settled(state, ticket) });
      return true;
    },
    fail: (ticket, error) => {
      if (!current(get(), ticket)) return false;
      const keepPending = ticket.kind === 'load' && get().localPending;
      set({ status: keepPending ? 'computing' : 'failed', pending: keepPending, error, ...settled(get(), ticket) });
      return true;
    },
    updateInputRevision: (sessionId, ownerId, revision) => {
      const state = get();
      if (state.sessionId !== sessionId || state.ownerId !== ownerId || !isRevision(revision) || obsoleteRevision(state, revision)) return false;
      set({ currentInputRevision: revision, knownInputRevision: revision, inputRevisionRefreshing: false, inputRevisionError: null }); return true;
    },
  }));
}
export const useAnalysisStore = createAnalysisStore();
