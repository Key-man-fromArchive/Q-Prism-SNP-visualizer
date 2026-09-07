// @TASK Frontend - Cycle Control Component
// @SPEC User can select data windows and navigate through cycles with play/pause
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { useSessionStore } from '@/stores/session-store';
import { useSelectionStore } from '@/stores/selection-store';
import { useNavigationStore } from '@/stores/navigation-store';
import { useI18n } from '@/hooks/use-i18n';

export function CycleControl() {
  const { t } = useI18n();
  const sessionInfo = useSessionStore((s) => s.sessionInfo);
  const setCycle = useSelectionStore((s) => s.setCycle);
  const isPlaying = useSelectionStore((s) => s.isPlaying);
  const setPlaying = useSelectionStore((s) => s.setPlaying);
  const setDataWindow = useSelectionStore((s) => s.setDataWindow);

  const currentCycle = useNavigationStore(state => state.cycle);
  const availableCycles = useNavigationStore(state => state.availableCycles);
  const ready = useNavigationStore(state => state.status === 'ready');
  const entry = useSessionStore(state => state.entryGeneration);
  const [draft, setDraft] = useState<{ entry: number; cycle: number | null; value: number } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const windows = sessionInfo?.data_windows ?? null;
  const activeWindowIdx = windows?.findIndex(window => currentCycle !== null && currentCycle >= window.start_cycle && currentCycle <= window.end_cycle) ?? -1;
  const activeWindow = windows?.[activeWindowIdx] ?? null;
  const cycles = useMemo(() => availableCycles.filter(cycle => !activeWindow || (cycle >= activeWindow.start_cycle && cycle <= activeWindow.end_cycle)), [availableCycles, activeWindow]);
  const windowCycles = cycles.length;
  const selectedIndex = currentCycle === null ? -1 : cycles.indexOf(currentCycle);
  const relativeValue = draft?.entry === entry && draft.cycle === currentCycle ? draft.value : selectedIndex + 1;
  useEffect(() => {
    return () => { if (debounceRef.current !== null) clearTimeout(debounceRef.current); };
  }, [entry, ready, activeWindow, isPlaying]);
  const chooseCycle = (cycle: number) => {
    if (!ready || !availableCycles.includes(cycle)) return;
    setCycle(cycle);
    setDataWindow(windows?.find(window => cycle >= window.start_cycle && cycle <= window.end_cycle)?.name ?? null);
  };
  const handleSliderChange = (value: number) => {
    setDraft({ entry, cycle: currentCycle, value });
    if (debounceRef.current !== null) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (useSessionStore.getState().entryGeneration !== entry || useNavigationStore.getState().status !== 'ready') return;
      const cycle = cycles[value - 1];
      if (cycle !== undefined) chooseCycle(cycle);
    }, 150);
  };
  useEffect(() => {
    if (!isPlaying || !ready || cycles.length < 2) return;
    const timer = window.setInterval(() => {
      const index = cycles.indexOf(useNavigationStore.getState().cycle ?? NaN);
      setCycle(cycles[(index + 1) % cycles.length]);
    }, 500);
    return () => window.clearInterval(timer);
  }, [isPlaying, ready, cycles, setCycle]);
  useEffect(() => {
    const handler = (event: Event) => {
      const target: unknown = (event as CustomEvent<unknown>).detail;
      if (!ready || typeof target !== 'number' || !availableCycles.includes(target)) return;
      if (debounceRef.current !== null) clearTimeout(debounceRef.current);
      setCycle(target);
    };
    window.addEventListener('goto-cycle', handler);
    return () => window.removeEventListener('goto-cycle', handler);
  }, [ready, availableCycles, setCycle]);

  // Hide if single cycle and no multiple windows
  const shouldHide =
    sessionInfo &&
    sessionInfo.num_cycles <= 1 &&
    (!windows || windows.length <= 1);

  return (
    <div
      id="cycle-control"
      className={shouldHide ? 'hidden' : ''}
      style={shouldHide ? undefined : {
        padding: '8px 24px',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '12px',
      }}
    >
      {/* Window selector - only shown if multiple windows */}
      {windows && windows.length > 1 && (
        <div id="window-selector" style={{ display: 'flex', gap: '4px' }}>
          {windows.map((w, idx) => (
            <button
              key={w.name}
              className={`window-btn px-3 py-1 text-xs rounded border ${
                idx === activeWindowIdx
                  ? 'active bg-primary text-white border-primary'
                  : 'bg-surface text-text-muted border-border hover:border-primary'
              }`}
              onClick={() => {
                setPlaying(false);
                const candidates = availableCycles.filter(cycle => cycle >= w.start_cycle && cycle <= w.end_cycle);
                const cycle = candidates.at(-1);
                if (cycle !== undefined) chooseCycle(cycle);
              }}
            >
              {w.name}
            </button>
          ))}
        </div>
      )}

      {/* Cycle label + slider (hidden if windowCycles <= 1) */}
      {windowCycles > 1 && (
        <>
          <label id="cycle-label" htmlFor="cycle-slider" className="text-sm text-text">
            {t.cycle}{' '}
            <span id="cycle-value" className="font-medium">
              {relativeValue}
            </span>{' '}
            / <span id="cycle-max">{windowCycles}</span>
          </label>
          <div className="slider-row flex items-center gap-2 flex-1 min-w-[200px]">
            <button
              id="play-btn"
              className="w-8 h-8 flex items-center justify-center border border-border rounded bg-surface cursor-pointer text-text hover:bg-bg"
              disabled={!ready}
              onClick={() => setPlaying(!isPlaying)}
              title={t.playPause}
              aria-label={t.playPause}
              aria-pressed={isPlaying}
            >
              {isPlaying ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
            </button>
            <input
              disabled={!ready}
              type="range"
              id="cycle-slider"
              min={1}
              max={windowCycles}
              value={relativeValue}
              aria-valuetext={String(cycles[relativeValue - 1] ?? currentCycle ?? '')}
              onChange={(e) => handleSliderChange(parseInt(e.target.value, 10))}
              className="flex-1"
            />
          </div>
        </>
      )}
    </div>
  );
}
