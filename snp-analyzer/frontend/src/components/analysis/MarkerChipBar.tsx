// One-row marker picker shown above the scatter card for every instrument and
// marker count. Chips that do not fit move into a "More" dropdown; the row is
// re-measured whenever its width changes.
import { useCallback, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { AlertTriangle } from "lucide-react";
import { useI18n } from "@/hooks/use-i18n";
import { MARKER_PALETTE } from "@/lib/constants";
import { fitChipCount, type MarkerChipState } from "@/lib/marker-chip";
import type { MarkerRegion } from "@/types/api";

const GAP = 8;
const STATE_GLYPH: Record<MarkerChipState, string> = { called: "●", none: "○", pending: "·" };

type Props = {
  markers: MarkerRegion[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  statusOf: (marker: MarkerRegion) => MarkerChipState;
  warningsOf: (marker: MarkerRegion) => string[];
};

const chipClass = "inline-flex shrink-0 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-bg px-2.5 py-1 text-sm font-semibold text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary";

export function MarkerChipBar({ markers, selectedId, onSelect, statusOf, warningsOf }: Props) {
  const { t } = useI18n();
  const wrapRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const chipRefs = useRef(new Map<string, HTMLButtonElement>());
  const focusAfter = useRef<string | null>(null);
  const [count, setCount] = useState(markers.length);
  const statusText: Record<MarkerChipState, string> = {
    called: t.markerChipCalled, none: t.markerChipNone, pending: t.markerChipPending,
  };

  const measure = useCallback(() => {
    const wrap = wrapRef.current;
    const probe = measureRef.current;
    if (!wrap || !probe || wrap.clientWidth === 0) { setCount(markers.length); return; }
    const sizes = Array.from(probe.children).map((el) => (el as HTMLElement).offsetWidth);
    const moreWidth = sizes.pop() ?? 0;
    setCount(fitChipCount(sizes, wrap.clientWidth, moreWidth, GAP));
  }, [markers.length]);

  // Re-measure after every render: chip names and states change the natural widths.
  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    measure();
  });
  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(wrap);
    window.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  const selectedIndex = markers.findIndex((m) => m.id === selectedId);
  const shown = Math.min(count, markers.length);
  let visible = markers.slice(0, shown);
  if (selectedIndex >= shown && shown > 0) visible = [...markers.slice(0, shown - 1), markers[selectedIndex]];
  const hidden = markers.filter((m) => !visible.includes(m));

  useLayoutEffect(() => {
    const id = focusAfter.current;
    if (id) { focusAfter.current = null; chipRefs.current.get(id)?.focus(); }
  });

  const move = (e: KeyboardEvent<HTMLButtonElement>) => {
    const last = markers.length - 1;
    const from = Math.max(0, selectedIndex);
    const target = e.key === "ArrowRight" ? (from + 1) % markers.length
      : e.key === "ArrowLeft" ? (from + last) % markers.length
        : e.key === "Home" ? 0 : e.key === "End" ? last : -1;
    if (target < 0) return;
    e.preventDefault();
    focusAfter.current = markers[target].id;
    onSelect(markers[target].id);
  };

  const dot = (m: MarkerRegion) => (
    <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: m.color ?? MARKER_PALETTE[0] }} />
  );
  const mark = (m: MarkerRegion, testId?: string) => {
    const state = statusOf(m);
    return (
      <span data-testid={testId} data-state={state} title={statusText[state]} aria-hidden="true"
        className={`text-xs leading-none ${state === "pending" ? "text-text-muted" : "text-text"}`}>
        {STATE_GLYPH[state]}
      </span>
    );
  };

  return (
    <div ref={wrapRef} className="relative min-w-0" data-testid="marker-chip-row">
      <div className="flex items-center gap-2">
        <div role="tablist" aria-label={t.wsAnalysisSelectMarkerLabel} data-testid="marker-chip-bar" className="flex items-center gap-2">
          {visible.map((m) => {
            const selected = m.id === selectedId;
            const warnings = warningsOf(m);
            return (
              <button
                key={m.id}
                ref={(el) => { if (el) chipRefs.current.set(m.id, el); else chipRefs.current.delete(m.id); }}
                type="button"
                role="tab"
                data-testid="marker-chip"
                aria-selected={selected}
                aria-label={`${m.name} — ${statusText[statusOf(m)]}`}
                tabIndex={selected || (selectedIndex < 0 && m === visible[0]) ? 0 : -1}
                onClick={() => onSelect(m.id)}
                onKeyDown={move}
                className={chipClass}
                style={selected ? { boxShadow: "0 0 0 2px var(--color-primary) inset" } : undefined}
              >
                {dot(m)}
                <span>{m.name}</span>
                {mark(m, "marker-chip-state")}
                {warnings.length > 0 && (
                  <span data-testid="marker-chip-warning" title={warnings.join(", ")} className="text-warning">
                    <AlertTriangle size={13} aria-hidden="true" />
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {hidden.length > 0 && (
          <select
            data-testid="marker-chip-more"
            aria-label={t.wsAnalysisSelectMarkerLabel}
            value=""
            onChange={(e) => { if (e.target.value) onSelect(e.target.value); }}
            className="shrink-0 rounded-md border border-border bg-surface px-2 py-1 text-sm text-text"
          >
            <option value="">{t.markerChipMore} ▾</option>
            {hidden.map((m) => (
              <option key={m.id} value={m.id}>{`${STATE_GLYPH[statusOf(m)]} ${m.name}`}</option>
            ))}
          </select>
        )}
      </div>
      {/* Off-screen copy used only to measure every chip's natural width. */}
      <div ref={measureRef} aria-hidden="true" className="pointer-events-none invisible absolute left-0 top-0 flex h-0 gap-2 overflow-hidden whitespace-nowrap">
        {markers.map((m) => (
          <span key={m.id} className={chipClass} tabIndex={-1}>
            {dot(m)}<span>{m.name}</span>{mark(m)}
            {warningsOf(m).length > 0 && <AlertTriangle size={13} />}
          </span>
        ))}
        <span className="shrink-0 border px-2 py-1 text-sm">{t.markerChipMore} ▾</span>
      </div>
    </div>
  );
}
