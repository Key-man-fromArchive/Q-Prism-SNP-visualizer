// @TASK Frontend - Cycle Control Component
// @SPEC User can select data windows and navigate through cycles with play/pause
import { useEffect, useRef, useState } from 'react';
import { useSessionStore } from '@/stores/session-store';
import { useSelectionStore } from '@/stores/selection-store';

export function CycleControl() {
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

  // When window changes, set initial cycle
  useEffect(() => {
    const win = windows?.[activeWindowIdx];
    if (!win) return;

    const wCycles = win.end_cycle - win.start_cycle + 1;
    let initial = wCycles;
    const suggestedCycle = sessionInfo?.suggested_cycle;

    if (suggestedCycle != null) {
      const rel = suggestedCycle - win.start_cycle + 1;
      if (rel >= 1 && rel <= wCycles) {
        initial = rel;
      }
    }

    setRelativeValue(initial);
    setCycle(win.start_cycle + initial - 1);
    setDataWindow(win.name);
  }, [activeWindowIdx, windows, sessionInfo?.suggested_cycle, setCycle, setDataWindow]);

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
            Cycle:{' '}
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
              title="Play/Pause"
            >
              {isPlaying ? '\u23F8' : '\u25B6'}
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
