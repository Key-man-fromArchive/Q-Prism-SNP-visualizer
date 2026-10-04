/**
 * Plotly layout colors for light/dark mode.
 *
 * Colors are read from CSS custom properties on `document.body` (P0-T0.2)
 * instead of being hardcoded per branch here, so index.css is the single
 * place to change them. `paper_bgcolor`/`plot_bgcolor` and `fontColor` reuse
 * the app's existing `--color-surface`/`--color-text` tokens; the plot-only
 * shades (grid/line, legend background, marker outline, selected-point
 * outline) had no matching token and get dedicated `--color-plot-*` ones in
 * index.css, added with the same per-mode values they replace.
 *
 * Fallbacks: every value in FALLBACK is the exact hex this function
 * returned before the refactor. They're used whenever getComputedStyle
 * can't see a token -- notably this project's own test environment, which
 * runs vitest with `css: false` (vitest.config.ts), so index.css's rules
 * never apply and every custom property reads as "". See
 * docs/planning/feedback-2026-09-11/evidence/P0-T0.2.md.
 *
 * Race note: every read below is a *custom property*, never the
 * `background-color`/`color` shorthand that index.css transitions on theme
 * toggle (`body { transition: background-color .3s, color .3s }`). Custom
 * properties aren't in that transition list, so they flip synchronously
 * with the `body.dark` class -- there's no interpolated intermediate value
 * for a chart re-render to land on.
 */

const FALLBACK = {
  light: {
    paper_bgcolor: "#ffffff",
    plot_bgcolor: "#ffffff",
    fontColor: "#1a1a2e",
    gridColor: "#e5e7eb",
    lineColor: "#e5e7eb",
    legendBg: "rgba(255,255,255,0.8)",
    markerLineColor: "#fff",
    selectedLineColor: "#000",
  },
  dark: {
    paper_bgcolor: "#1a1d27",
    plot_bgcolor: "#1a1d27",
    fontColor: "#e4e4e7",
    gridColor: "#2d3040",
    lineColor: "#2d3040",
    legendBg: "rgba(26,29,39,0.8)",
    markerLineColor: "#2d3040",
    selectedLineColor: "#fff",
  },
} as const;

export function isDarkMode(): boolean {
  return document.body.classList.contains("dark");
}

/** Read a CSS custom property off `document.body`; an empty/whitespace
 *  value (token not defined in this environment) falls back. */
function readToken(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.body).getPropertyValue(name).trim();
  return value || fallback;
}

/** Legend as a small translucent box inside the top-right of the plot area, so
 *  it never takes canvas height from the scatter. */
export function compactLegend(colors: { legendBg: string; fontColor: string }) {
  return {
    orientation: "h" as const,
    // Own rows above the plot area; the modebar is hover-only and sits above them.
    x: 0.99, xanchor: "right" as const, y: 1, yanchor: "bottom" as const,
    bgcolor: colors.legendBg,
    font: { size: 9, color: colors.fontColor },
    itemsizing: "constant" as const,
    tracegroupgap: 0,
    entrywidth: 0,
  };
}

/** Top margin reserving room for the legend's (at most two) rows so it never
 *  overlaps the data; the modebar only appears on hover (see PLOTLY_MODEBAR). */
export const LEGEND_MARGIN_TOP = 58;
export const PLOTLY_MODEBAR = "hover" as const;

export function plotlyColors() {
  const dark = isDarkMode();
  const fallback = dark ? FALLBACK.dark : FALLBACK.light;
  return {
    paper_bgcolor: readToken("--color-surface", fallback.paper_bgcolor),
    plot_bgcolor: readToken("--color-surface", fallback.plot_bgcolor),
    fontColor: readToken("--color-text", fallback.fontColor),
    gridColor: readToken("--color-plot-grid", fallback.gridColor),
    lineColor: readToken("--color-plot-grid", fallback.lineColor),
    legendBg: readToken("--color-plot-legend-bg", fallback.legendBg),
    markerLineColor: readToken("--color-plot-marker-line", fallback.markerLineColor),
    selectedLineColor: readToken("--color-plot-selected-line", fallback.selectedLineColor),
  };
}

/**
 * Fixed light set for the results screen's large plot "sheet", which stays
 * white in dark mode too. Never reads body tokens (they are dark when
 * body.dark is set). Keep in sync with the LIGHT values in index.css
 * (`:root`: --color-surface, --color-text, --color-plot-*); note
 * fontColor is the index.css --color-text (#16211f), not the jsdom
 * FALLBACK above (#1a1a2e).
 */
const LIGHT_PLOT = {
  paper_bgcolor: "#ffffff",
  plot_bgcolor: "#ffffff",
  fontColor: "#16211f",
  gridColor: "#e5e7eb",
  lineColor: "#e5e7eb",
  legendBg: "rgba(255,255,255,0.8)",
  markerLineColor: "#ffffff",
  selectedLineColor: "#000000",
} as const;

export function lightPlotColors(): { -readonly [K in keyof typeof LIGHT_PLOT]: string } {
  return { ...LIGHT_PLOT };
}
