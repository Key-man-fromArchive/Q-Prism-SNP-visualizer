import { useCallback, useEffect, useState } from 'react';
import { getSessions, getCompareScatter, getCompareStats } from '@/lib/api';
import { useOwnedOperation } from '@/hooks/use-owned-operation';
import { useSettingsStore } from '@/stores/settings-store';
import { validRecentSession } from '@/lib/recovery-payload';
import type { SessionListItem, CompareScatterResponse, CompareStatsResponse } from '@/types/api';
import { validComparison } from './comparison-payload';

export function comparisonRunLabel(session: SessionListItem): string {
  return `${session.raw_filename || session.instrument || session.session_id.slice(0, 8)} · ${session.uploaded_at || '—'} · ${session.session_id.slice(0, 8)}`;
}

function matchesRequestedRuns(scatter: CompareScatterResponse, stats: CompareStatsResponse, runA: string, runB: string): boolean {
  return [scatter.run1, stats.run1].every(run => run.session_id === runA)
    && [scatter.run2, stats.run2].every(run => run.session_id === runB);
}

export function useComparison(useRox: boolean) {
  const listOwner = useOwnedOperation(), compareOwner = useOwnedOperation();
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [listState, setListState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [reload, setReload] = useState(0);
  const [runA, setA] = useState(''), [runB, setB] = useState('');
  const [phase, setPhase] = useState<'idle' | 'loading' | 'error'>('idle');
  const [result, setResult] = useState<{ scatter: CompareScatterResponse; stats: CompareStatsResponse; names: [string, string] } | null>(null);
  useEffect(() => {
    const ticket = listOwner.begin();
    void getSessions().then(data => {
      if (!listOwner.current(ticket)) return;
      if (!Array.isArray(data) || !data.every(validRecentSession)) { setListState('error'); return; }
      setSessions(data); setListState('ready');
    }).catch(() => { if (listOwner.current(ticket)) setListState('error'); });
  }, [listOwner, reload]);
  const invalidate = useCallback(() => { compareOwner.begin(); setResult(null); setPhase('idle'); }, [compareOwner]);
  useEffect(() => useSettingsStore.subscribe((next, previous) => {
    if (next.useRox !== previous.useRox) invalidate();
  }), [invalidate]);
  const setRunA = (value: string) => { invalidate(); setA(value); };
  const setRunB = (value: string) => { invalidate(); setB(value); };
  const compare = async () => {
    const a = sessions.find(item => item.session_id === runA), b = sessions.find(item => item.session_id === runB);
    if (!a || !b || runA === runB) return;
    const ticket = compareOwner.begin(); setResult(null); setPhase('loading');
    try {
      const [scatter, stats] = await Promise.all([getCompareScatter(runA, runB, undefined, undefined, useRox), getCompareStats(runA, runB, undefined, undefined, useRox)]);
      if (!compareOwner.current(ticket) || useSettingsStore.getState().useRox !== useRox) return;
      if (!validComparison(scatter, stats)) { setPhase('error'); return; }
      if (!matchesRequestedRuns(scatter, stats, runA, runB)) { setPhase('error'); return; }
      setResult({ scatter, stats, names: [comparisonRunLabel(a), comparisonRunLabel(b)] }); setPhase('idle');
    } catch { if (compareOwner.current(ticket)) setPhase('error'); }
  };
  const retry = async () => { setListState('loading'); setReload(value => value + 1); };
  return { sessions, listState, load: retry, runA, runB, setRunA, setRunB, phase, result, compare };
}
