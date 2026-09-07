import { useEffect, useRef } from 'react';

/** First readiness establishes a baseline; only subsequent effective input changes schedule work. */
export function useSettledAnalysis(identity: string, input: string, paused: boolean, analyze: () => void, ready = true) {
  const previous = useRef<{ identity: string; input: string } | null>(null);
  useEffect(() => {
    if (!ready) { previous.current = null; return; }
    if (previous.current?.identity !== identity) { previous.current = { identity, input }; return; }
    if (paused || previous.current.input === input) return;
    const timer = window.setTimeout(() => {
      previous.current = { identity, input };
      analyze();
    }, 220);
    return () => window.clearTimeout(timer);
  }, [identity, input, paused, analyze, ready]);
}
