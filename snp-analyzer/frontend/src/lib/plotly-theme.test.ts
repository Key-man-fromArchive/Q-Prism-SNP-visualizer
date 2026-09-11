import { afterEach, describe, expect, it } from 'vitest';
import { plotlyColors } from './plotly-theme';

// P0-T0.2: plotly-theme.ts must derive its colors from CSS custom
// properties on document.body instead of hardcoding hex per branch, and
// must fall back to the pre-refactor hex when a token isn't available
// (e.g. this test environment: vitest.config.ts runs with `css: false`,
// so index.css's `@theme`/`body.dark` rules never apply and
// getComputedStyle sees no custom properties at all).

const ORIGINAL_LIGHT = {
  paper_bgcolor: '#ffffff',
  plot_bgcolor: '#ffffff',
  fontColor: '#1a1a2e',
  gridColor: '#e5e7eb',
  lineColor: '#e5e7eb',
  legendBg: 'rgba(255,255,255,0.8)',
  markerLineColor: '#fff',
  selectedLineColor: '#000',
};

const ORIGINAL_DARK = {
  paper_bgcolor: '#1a1d27',
  plot_bgcolor: '#1a1d27',
  fontColor: '#e4e4e7',
  gridColor: '#2d3040',
  lineColor: '#2d3040',
  legendBg: 'rgba(26,29,39,0.8)',
  markerLineColor: '#2d3040',
  selectedLineColor: '#fff',
};

function resetBody() {
  document.body.classList.remove('dark');
  document.body.removeAttribute('style');
}

afterEach(resetBody);

describe('plotlyColors', () => {
  it('falls back to the exact pre-refactor light hex when no CSS token is present', () => {
    resetBody();
    expect(plotlyColors()).toEqual(ORIGINAL_LIGHT);
  });

  it('falls back to the exact pre-refactor dark hex when no CSS token is present', () => {
    document.body.classList.add('dark');
    expect(plotlyColors()).toEqual(ORIGINAL_DARK);
  });

  it('reads --color-surface for paper_bgcolor and plot_bgcolor', () => {
    document.body.style.setProperty('--color-surface', '#123456');
    const colors = plotlyColors();
    expect(colors.paper_bgcolor).toBe('#123456');
    expect(colors.plot_bgcolor).toBe('#123456');
  });

  it('reads --color-text for fontColor', () => {
    document.body.style.setProperty('--color-text', '#abcdef');
    expect(plotlyColors().fontColor).toBe('#abcdef');
  });

  it('reads dedicated plot tokens for grid/line, legend, marker-line and selected-line', () => {
    document.body.style.setProperty('--color-plot-grid', '#111111');
    document.body.style.setProperty('--color-plot-legend-bg', 'rgba(1,2,3,0.5)');
    document.body.style.setProperty('--color-plot-marker-line', '#222222');
    document.body.style.setProperty('--color-plot-selected-line', '#333333');
    const colors = plotlyColors();
    expect(colors.gridColor).toBe('#111111');
    expect(colors.lineColor).toBe('#111111');
    expect(colors.legendBg).toBe('rgba(1,2,3,0.5)');
    expect(colors.markerLineColor).toBe('#222222');
    expect(colors.selectedLineColor).toBe('#333333');
  });

  it('never reads the transitioned background-color/color shorthand, only custom properties', () => {
    const seen: string[] = [];
    const proto = CSSStyleDeclaration.prototype as unknown as {
      getPropertyValue(this: CSSStyleDeclaration, name: string): string;
    };
    const original = proto.getPropertyValue;
    proto.getPropertyValue = function (this: CSSStyleDeclaration, name: string) {
      seen.push(name);
      return original.call(this, name);
    };
    try {
      plotlyColors();
    } finally {
      proto.getPropertyValue = original;
    }
    expect(seen.length).toBeGreaterThan(0);
    for (const name of seen) {
      expect(name.startsWith('--')).toBe(true);
    }
  });

  it('returns different values for light and dark when tokens differ per mode', () => {
    document.body.style.setProperty('--color-surface', '#ffffff');
    const light = plotlyColors();
    resetBody();
    document.body.classList.add('dark');
    document.body.style.setProperty('--color-surface', '#1a1d27');
    const dark = plotlyColors();
    expect(light.paper_bgcolor).not.toBe(dark.paper_bgcolor);
  });
});
