import { create } from 'zustand';
import type { AnalysisStatus, ClusterResponse, ClusteringResult } from '@/types/api';
import { isRevision } from '@/lib/analysis-context';

export type AnalysisTicket = { sessionId: string; ownerId: string; generation: number; loadGeneration: number; kind: 'analysis' | 'load' };
interface AnalysisState {
  sessionId: string | null;
  ownerId: string | null;
  generation: number;
  loadGeneration: number;
  localPending: boolean;
  result: ClusteringResult | null;
  currentInputRevision: number | null;
  status: AnalysisStatus;
  pending: boolean;
  error: unknown;
  setSession: (sessionId: string | null, ownerId: string | null) => void;
  clear: () => void;
  beginRequest: (kind: AnalysisTicket['kind']) => AnalysisTicket;
  accept: (ticket: AnalysisTicket, response: ClusterResponse) => boolean;
  fail: (ticket: AnalysisTicket, error: unknown) => boolean;
  updateInputRevision: (sessionId: string, ownerId: string, revision: number) => boolean;
}
const empty = { result: null, currentInputRevision: null, status: 'idle', pending: false, localPending: false, error: null } as const;
function current(state: AnalysisState, ticket: AnalysisTicket): boolean {
  return state.sessionId === ticket.sessionId && state.ownerId === ticket.ownerId && state.generation === ticket.generation
    && (ticket.kind === 'analysis' || ticket.loadGeneration === state.loadGeneration);
}
function obsoleteRevision(state: AnalysisState, revision: unknown): boolean {
  return isRevision(revision) && state.currentInputRevision !== null && revision < state.currentInputRevision;
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
/** Explicit owner identity invalidates same-session responses across authentication changes. */
export function createAnalysisStore() {
  return create<AnalysisState>((set, get) => ({
    ...empty, sessionId: null, ownerId: null, generation: 0, loadGeneration: 0,
    setSession: (sessionId, ownerId) => set(state => ({ ...empty, sessionId, ownerId, generation: state.generation + 1 })),
    clear: () => get().setSession(null, null),
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
        currentInputRevision: isRevision(response.input_revision) ? response.input_revision : null,
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
      set({ currentInputRevision: revision }); return true;
    },
  }));
}
export const useAnalysisStore = createAnalysisStore();
