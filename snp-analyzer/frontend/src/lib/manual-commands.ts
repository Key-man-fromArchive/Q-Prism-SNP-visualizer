import { ApiError, bulkSetWellTypes, getWellTypes } from './api';
import { isRevision } from './analysis-context';
import { parseWellType } from './well-type-input';
import { useAnalysisStore } from '@/stores/analysis-store';
import { useAuthStore } from '@/stores/auth-store';
import { useDataStore } from '@/stores/data-store';
import { useNavigationStore } from '@/stores/navigation-store';
import { useSessionStore } from '@/stores/session-store';
import { useUndoStore, type ManualMap, type UndoTicket } from '@/stores/undo-store';
import type { WellType, WellTypesResponse } from '@/types/api';

type Context = { owner: string; sid: string; entry: number; revision: number; ticket: UndoTicket };
function identity() {
  const session = useSessionStore.getState();
  return { owner: useAuthStore.getState().user?.id, sid: session.sessionId, entry: session.entryGeneration };
}
function owned(context: Context): boolean {
  const live = identity();
  return live.owner === context.owner && live.sid === context.sid && live.entry === context.entry;
}
function current(context: Context): boolean { return owned(context) && useUndoStore.getState().isCurrent(context.ticket); }
export function manualCommandsReady(): boolean {
  const nav = useNavigationStore.getState(), analysis = useAnalysisStore.getState(), live = identity();
  return Boolean(live.owner && live.sid) && nav.session === live.sid && nav.status === 'ready'
    && !nav.exportRestoring && analysis.sessionId === live.sid && analysis.ownerId === live.owner
    && !analysis.pending && !analysis.inputRevisionRefreshing && isRevision(analysis.currentInputRevision);
}
function begin(): Context | null {
  if (!manualCommandsReady()) return null;
  const { owner, sid, entry } = identity();
  const revision = useAnalysisStore.getState().currentInputRevision;
  if (!owner || !sid || revision === null) return null;
  const ticket = useUndoStore.getState().begin();
  return ticket ? { owner, sid, entry, revision, ticket } : null;
}
function exactSnapshot(response: WellTypesResponse): boolean {
  const map = response.manual_assignments;
  return isRevision(response.input_revision) && map !== null && typeof map === 'object'
    && !Array.isArray(map) && Object.values(map).every(value => parseWellType(value) !== undefined);
}
function publish(context: Context, response: WellTypesResponse): void {
  useAnalysisStore.getState().updateInputRevision(context.sid, context.owner, response.input_revision);
  useDataStore.getState().setWellTypeAssignments({ ...response.assignments });
  window.dispatchEvent(new CustomEvent('welltypes-changed'));
}
async function conflict(context: Context): Promise<void> {
  if (!current(context)) return;
  // Keep the global lock during refresh, so no caller can retry implicitly.
  try {
    const response = await getWellTypes(context.sid);
    if (!current(context)) return;
    if (!exactSnapshot(response)) throw new Error('Manual snapshot unavailable');
    publish(context, response);
  } catch {
    if (!current(context)) return;
    useAnalysisStore.getState().beginInputRefresh();
    useAnalysisStore.getState().failInputRefresh(new Error('Manual revision refresh failed'));
  }
  if (current(context)) useUndoStore.getState().reset('conflict');
}
async function failure(context: Context, error: unknown): Promise<void> {
  if (!current(context)) return;
  if (error instanceof ApiError && error.status === 409) await conflict(context);
  else useUndoStore.getState().fail(context.ticket, 'failed');
}
function equal(left: ManualMap, right: ManualMap): boolean {
  return Object.keys(left).length === Object.keys(right).length && Object.entries(left).every(([key, value]) => right[key] === value);
}
async function readBefore(context: Context): Promise<ManualMap | null> {
  const historyRevision = useUndoStore.getState().revision;
  if (historyRevision !== null && historyRevision !== context.revision) { await conflict(context); return null; }
  const response = await getWellTypes(context.sid);
  if (!current(context)) return null;
  if (!exactSnapshot(response)) { useUndoStore.getState().fail(context.ticket, 'unavailable'); return null; }
  if (response.input_revision !== context.revision) { await conflict(context); return null; }
  return { ...response.manual_assignments };
}
async function write(context: Context, after: ManualMap): Promise<WellTypesResponse | null> {
  if (!current(context)) return null;
  const response = await bulkSetWellTypes(context.sid, { ...after }, context.revision);
  if (!current(context)) return null;
  if (!exactSnapshot(response)) { await conflict(context); return null; }
  return response;
}
export async function assignManualWells(wells: readonly string[], type: WellType): Promise<boolean> {
  if (!wells.length || !parseWellType(type)) return false;
  const context = begin();
  if (!context) return false;
  try {
    const before = await readBefore(context);
    if (!before) return false;
    const after = { ...before, ...Object.fromEntries(wells.map(well => [well, type])) };
    if (equal(before, after)) return false;
    const response = await write(context, after);
    if (!response) return false;
    useUndoStore.getState().commitEdit(context.ticket, before, response.manual_assignments, response.input_revision);
    publish(context, response);
    return true;
  } catch (error) { await failure(context, error); return false; }
  finally { useUndoStore.getState().finish(context.ticket); }
}
export function canMoveManual(direction: -1 | 1): boolean {
  const history = useUndoStore.getState();
  if (history.pending || !manualCommandsReady()) return false;
  return direction === -1 ? history.cursor > 0 : history.cursor < history.commands.length;
}
async function move(direction: -1 | 1): Promise<boolean> {
  if (!canMoveManual(direction)) return false;
  const history = useUndoStore.getState();
  const command = history.commands[direction === -1 ? history.cursor - 1 : history.cursor];
  const context = begin();
  if (!context) return false;
  try {
    if (history.revision !== context.revision) { await conflict(context); return false; }
    const response = await write(context, direction === -1 ? command.before : command.after);
    if (!response) return false;
    useUndoStore.getState().commitMove(context.ticket, direction, response.input_revision);
    publish(context, response);
    return true;
  } catch (error) { await failure(context, error); return false; }
  finally { useUndoStore.getState().finish(context.ticket); }
}
export const undoManual = () => move(-1);
export const redoManual = () => move(1);
