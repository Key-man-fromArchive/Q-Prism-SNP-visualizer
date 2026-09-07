import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, createPreset, deletePreset, getPresets } from '@/lib/api';
import { recoveryReason } from '@/lib/recovery-reason';
import { validPreset } from '@/lib/recovery-payload';
import { useAuthStore } from '@/stores/auth-store';
import type { RecoveryReason } from '@/stores/upload-job-store';
import type { PresetResponse, PresetSettings } from '@/types/api';

type State = {
  owner: string | undefined; name: string; selected: string; presets: PresetResponse[];
  listStatus: 'loading' | 'ready' | 'error'; listError: RecoveryReason | null;
  operation: 'idle' | 'saving' | 'deleting' | 'saved' | 'deleted' | 'error'; operationError: RecoveryReason | null;
};
function initial(owner: string | undefined): State {
  return { owner, name: '', selected: '', presets: [], listStatus: 'loading', listError: null, operation: 'idle', operationError: null };
}
export function usePresetOperations() {
  const owner = useAuthStore(state => state.user?.id);
  const authGeneration = useAuthStore(state => state.generation);
  const [state, setState] = useState(() => initial(owner));
  const generation = useRef(0), listRequest = useRef(0), locked = useRef(false);
  if (state.owner !== owner) setState(initial(owner));
  const owns = useCallback((ticket: number) => generation.current === ticket
    && useAuthStore.getState().user?.id === owner && useAuthStore.getState().generation === authGeneration, [owner, authGeneration]);
  const reload = useCallback(async () => {
    const ticket = generation.current, request = ++listRequest.current;
    setState(value => ({ ...value, listStatus: 'loading', listError: null }));
    try {
      const result = await getPresets();
      if (!result || !Array.isArray(result.presets) || !result.presets.every(validPreset)) throw new ApiError('Invalid preset list', 422, {});
      if (owns(ticket) && request === listRequest.current) setState(value => ({ ...value, presets: result.presets, listStatus: 'ready' }));
    } catch (error) {
      if (owns(ticket) && request === listRequest.current) setState(value => ({ ...value, listStatus: 'error', listError: recoveryReason(error) }));
    }
  }, [owns]);
  useEffect(() => {
    const ticket = generation.current;
    void reload();
    return () => { generation.current = ticket + 1; locked.current = false; };
  }, [reload]);
  const operate = async (kind: 'saving' | 'deleting', action: () => Promise<void>) => {
    if (locked.current) return;
    const ticket = generation.current;
    locked.current = true;
    setState(value => ({ ...value, operation: kind, operationError: null }));
    try {
      await action();
      if (!owns(ticket)) return;
      setState(value => ({ ...value, operation: kind === 'saving' ? 'saved' : 'deleted' }));
      await reload();
    } catch (error) {
      if (owns(ticket)) setState(value => ({ ...value, operation: 'error', operationError: recoveryReason(error) }));
    } finally { if (owns(ticket)) locked.current = false; }
  };
  const save = async (settings: PresetSettings) => {
    const name = state.name;
    if (!name.trim()) return;
    const ticket = generation.current;
    await operate('saving', async () => {
      await createPreset(name.trim(), structuredClone(settings));
      if (owns(ticket)) setState(value => ({ ...value, name: value.name === name ? '' : value.name }));
    });
  };
  const remove = async () => {
    const selected = state.selected;
    if (!selected) return;
    const ticket = generation.current;
    await operate('deleting', async () => {
      await deletePreset(selected);
      if (owns(ticket)) setState(value => ({ ...value, selected: value.selected === selected ? '' : value.selected }));
    });
  };
  const busy = state.operation === 'saving' || state.operation === 'deleting';
  return { ...state, reload, save, remove, busy,
    saveDisabled: presetButtonDisabled(state.name.trim(), busy),
    deleteDisabled: presetButtonDisabled(state.selected, busy),
    setName: (name: string) => setState(value => ({ ...value, name })),
    setSelected: (selected: string) => setState(value => ({ ...value, selected })),
  };
}

function presetButtonDisabled(value: string, busy: boolean): boolean {
  return !value || busy;
}
