// @TASK Frontend - Cycle Control Component
// @SPEC User can select data windows and navigate through cycles with play/pause
import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { useSessionStore } from '@/stores/session-store';
import { useSelectionStore } from '@/stores/selection-store';
import { useI18n } from '@/hooks/use-i18n';

export function CycleControl() {
  const { t } = useI18n();
  const sessionInfo = useSessionStore((s) => s.sessionInfo);
  const setCycle = useSelectionStore((s) => s.setCycle);
  const isPlaying = useSelectionStore((s) => s.isPlaying);
  const setPlaying = useSelectionStore((s) => s.setPlaying);
  const setDataWindow = useSelectionStore((s) => s.setDataWindow);

  const [activeWindowIdx, setActiveWindowIdx] = useState(0);
  const [relativeValue, setRelativeValue] = useState(1);
  const animRef = useRef<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const windows = sessionInfo?.data_windows ?? null;
  const activeWindow = windows?.[activeWindowIdx] ?? null;
  const windowCycles = activeWindow
    ? activeWindow.end_cycle - activeWindow.start_cycle + 1
    : sessionInfo?.num_cycles ?? 1;

  // Initialize: select Amplification window by default
  useEffect(() => {
    if (!windows || windows.length <= 1) {
      setActiveWindowIdx(0);
      return;
    }
    const ampIdx = windows.findIndex((w) => w.name === 'Amplification');
    setActiveWindowIdx(ampIdx >= 0 ? ampIdx : 0);
  }, [windows]);

  // When window changes, set initial cycle.
  useEffect(() => {
    const win = windows?.[activeWindowIdx];
    const suggestedCycle = sessionInfo?.suggested_cycle;

    // No data windows (e.g. synthetic examples / plain per-cycle imports): the
    // store's currentCycle would otherwise stay at its initial 0, and every
    // cycle-gated fetch (ScatterPlot guards `if (!currentCycle) return`) would
    // silently skip — leaving the allele-discrimination plot blank. Initialise
    // against the full cycle range so the analysis surface has data on load.
    if (!win) {
      const n = sessionInfo?.num_cycles ?? 1;
      let initial = n;
      if (suggestedCycle != null && suggestedCycle >= 1 && suggestedCycle <= n) {
        initial = suggestedCycle;
      }
      setRelativeValue(initial);
      setCycle(initial);
      setDataWindow(null);
      return;
    }

    const wCycles = win.end_cycle - win.start_cycle + 1;
    let initial = wCycles;

    if (suggestedCycle != null) {
      const rel = suggestedCycle - win.start_cycle + 1;
      if (rel >= 1 && rel <= wCycles) {
        initial = rel;
      }
    }

    setRelativeValue(initial);
    setCycle(win.start_cycle + initial - 1);
    setDataWindow(win.name);
  }, [activeWindowIdx, windows, sessionInfo?.suggested_cycle, sessionInfo?.num_cycles, setCycle, setDataWindow]);

  // Debounced slider change
  const handleSliderChange = (val: number) => {
    setRelativeValue(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const abs = activeWindow ? activeWindow.start_cycle + val - 1 : val;
      setCycle(abs);
    }, 150);
  };

  // Play/Pause animation
  useEffect(() => {
    if (!isPlaying) {
      if (animRef.current) {
        clearInterval(animRef.current);
        animRef.current = null;
      }
      return;
    }

    let current = relativeValue;
    animRef.current = window.setInterval(() => {
      current++;
      if (current > windowCycles) {
        current = 1;
      }
      setRelativeValue(current);
      const abs = activeWindow ? activeWindow.start_cycle + current - 1 : current;
      setCycle(abs);
    }, 500);

    return () => {
      if (animRef.current) {
        clearInterval(animRef.current);
        animRef.current = null;
      }
    };
  }, [isPlaying, windowCycles, activeWindow, setCycle]);

  // External "go to cycle" (e.g. the Analyze button jumping to the suggested cycle)
  useEffect(() => {
    const handler = (e: Event) => {
      const target = (e as CustomEvent<number>).detail;
      if (typeof target !== "number") return;
      let idx = activeWindowIdx;
      if (windows && windows.length > 0) {
        const found = windows.findIndex(
          (w) => target >= w.start_cycle && target <= w.end_cycle
        );
        if (found >= 0) idx = found;
      }
      const win = windows?.[idx];
      setActiveWindowIdx(idx);
      setRelativeValue(win ? target - win.start_cycle + 1 : target);
      if (win) setDataWindow(win.name);
      setCycle(target);
    };
    window.addEventListener("goto-cycle", handler);
    return () => window.removeEventListener("goto-cycle", handler);
  }, [windows, activeWindowIdx, setCycle, setDataWindow]);

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
                setActiveWindowIdx(idx);
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
          <label id="cycle-label" className="text-sm text-text">
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
              onClick={() => setPlaying(!isPlaying)}
              title={t.playPause}
              aria-label={t.playPause}
              aria-pressed={isPlaying}
            >
              {isPlaying ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
            </button>
            <input
              type="range"
              id="cycle-slider"
              min={1}
              max={windowCycles}
              value={relativeValue}
              onChange={(e) => handleSliderChange(parseInt(e.target.value, 10))}
              className="flex-1"
            />
          </div>
        </>
      )}
    </div>
  );
}
