import { create } from 'zustand';

export type ManualMap = Readonly<Record<string, string>>;
type ManualCommand = Readonly<{ before: ManualMap; after: ManualMap }>;
export type UndoError = 'failed' | 'conflict' | 'unavailable' | null;
export type UndoTicket = Readonly<{ generation: number; request: number }>;
interface UndoState {
  commands: readonly ManualCommand[];
  cursor: number;
  revision: number | null;
  generation: number;
  request: number;
  pending: boolean;
  error: UndoError;
  begin: () => UndoTicket | null;
  isCurrent: (ticket: UndoTicket) => boolean;
  commitEdit: (ticket: UndoTicket, before: ManualMap, after: ManualMap, revision: number) => void;
  commitMove: (ticket: UndoTicket, direction: -1 | 1, revision: number) => void;
  finish: (ticket: UndoTicket) => void;
  fail: (ticket: UndoTicket, error: UndoError) => void;
  reset: (error?: UndoError) => void;
}
const empty = { commands: [], cursor: 0, revision: null, pending: false, error: null } as const;
function immutable(map: ManualMap): ManualMap { return Object.freeze({ ...map }); }

/** In-memory only; session invalidation resets it synchronously, never persisted. */
export function createUndoStore() {
  return create<UndoState>((set, get) => ({
    ...empty, generation: 0, request: 0,
    begin: () => {
      if (get().pending) return null;
      const request = get().request + 1;
      set({ pending: true, error: null, request });
      return { generation: get().generation, request };
    },
    isCurrent: ticket => get().pending && get().generation === ticket.generation && get().request === ticket.request,
    commitEdit: (ticket, before, after, revision) => {
      if (!get().isCurrent(ticket)) return;
      const command = Object.freeze({ before: immutable(before), after: immutable(after) });
      const commands = Object.freeze([...get().commands.slice(0, get().cursor), command].slice(-50));
      set({ commands, cursor: commands.length, revision, pending: false, error: null });
    },
    commitMove: (ticket, direction, revision) => {
      if (!get().isCurrent(ticket)) return;
      set({ cursor: get().cursor + direction, revision, pending: false, error: null });
    },
    finish: ticket => { if (get().isCurrent(ticket)) set({ pending: false }); },
    fail: (ticket, error) => { if (get().isCurrent(ticket)) set({ pending: false, error }); },
    reset: (error = null) => set({ ...empty, error, generation: get().generation + 1 }),
  }));
}
export const useUndoStore = createUndoStore();
