// @TASK P20-STALE-DATA - shared loading/ready/error request status.
// @SPEC docs/planning/feedback-2026-09-11/evidence/P20-STALE-DATA.md
//
// AmplificationCurvePanel and WellDetailPanel each fetch a per-well curve
// independently of ScatterPlot (see AmplificationCurvePanel.tsx's doc
// comment on why). Both used to leave a previous well/condition's data on
// screen -- with no visible indication -- while a new request was in flight
// or after it failed; only a console.error marked the failure. This hook
// gives both the same "reset to loading whenever the request identity
// changes" behavior ScatterPlot already has (its internal useScatterStatus),
// so a stale response is never mistaken for the current one.
import { useState } from 'react';

export type RequestStatus = 'loading' | 'ready' | 'error' | 'empty';

export function useRequestStatus(key: string) {
  const [status, setStatus] = useState<RequestStatus>('loading');
  const [error, setError] = useState<string | null>(null);
  const [lastKey, setLastKey] = useState(key);
  // Derived-state-during-render reset (same idiom as ScatterPlot's
  // useScatterStatus/useBoundaryDraft): the moment the identity this status
  // describes changes, the OLD identity's status/error must not be shown
  // against the NEW identity, even for the one render before the fetch
  // effect has a chance to run.
  if (lastKey !== key) {
    setLastKey(key);
    setStatus('loading');
    setError(null);
  }
  return { status, setStatus, error, setError };
}
