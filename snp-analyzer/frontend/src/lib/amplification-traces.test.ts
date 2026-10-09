import { describe, expect, it } from 'vitest';
import {
  ALLELE2_COLOR, FAM_COLOR, HOVER_EMPHASIS_MAX, UNASSIGNED_COLOR, WELL_COLOUR_MAX,
  buildMultiWellTraces, emphasisRestyle, type MultiWellTraceInput,
} from './amplification-traces';
import type { AmplificationCurve } from '@/types/api';

const curve = (well: string, fam = [0.1, 0.5, 1], allele2 = [0.2, 0.3, 0.4]): AmplificationCurve => ({
  well, cycles: [10, 20, 30], norm_fam: fam, norm_allele2: allele2,
});
const CALLS: Record<string, string> = { A1: 'AA', A2: 'AA', A3: 'BB' };

function input(curves: AmplificationCurve[], over: Partial<MultiWellTraceInput> = {}): MultiWellTraceInput {
  return {
    curves,
    channels: 'both',
    colourBasis: 'channel',
    yScale: 'linear',
    channelNames: { fam: 'FAM', allele2: 'VIC' },
    callOf: (w) => CALLS[w] ?? null,
    callName: (c) => `call:${c}`,
    callColor: (c) => (c === 'AA' ? '#111111' : '#222222'),
    texts: { unassigned: 'Unassigned', cycle: 'Cycle' },
    ...over,
  };
}
type T = { name: string; x: (number | null)[]; y: (number | null)[]; text?: string[]; line: { color: string; dash?: string; width: number }; mode?: string; meta: { well: string | null }; showlegend?: boolean; marker?: { opacity: number } };
const traces = (r: ReturnType<typeof buildMultiWellTraces>) => r.traces as unknown as T[];
const many = (n: number) => Array.from({ length: n }, (_, i) => curve(`W${i}`));

describe('buildMultiWellTraces', () => {
  it('keeps the original two plain lines for one well', () => {
    const r = buildMultiWellTraces(input([curve('A1')], { colourBasis: 'call', channels: 'fam' }));
    const [fam, a2] = traces(r);
    expect(r.mode).toBe('single');
    expect(traces(r)).toHaveLength(2);
    expect([fam.name, fam.line.color, fam.line.width, fam.line.dash]).toEqual(['FAM', FAM_COLOR, 2, undefined]);
    expect([a2.name, a2.line.color, a2.line.width, a2.line.dash]).toEqual(['VIC', ALLELE2_COLOR, 2, undefined]);
    expect(fam.mode).toBeUndefined();
  });

  it('draws FAM solid and Allele2 dashed per well, coloured by channel, with counted legend entries', () => {
    const r = buildMultiWellTraces(input([curve('A1'), curve('A2'), curve('A3')]));
    const t = traces(r);
    expect(r.mode).toBe('per-well');
    expect(t).toHaveLength(6);
    expect(t.filter((x) => x.line.dash === 'dash')).toHaveLength(3);
    expect(t[0].line.color).toBe(FAM_COLOR);
    expect(t[1].line.color).toBe(ALLELE2_COLOR);
    expect(t.map((x) => x.name)).toEqual(['FAM (3)', 'VIC (3)', 'FAM (3)', 'VIC (3)', 'FAM (3)', 'VIC (3)']);
    expect(t.filter((x) => x.showlegend)).toHaveLength(2);
    expect(r.groups.map((g) => g.wells)).toEqual([3, 3]);
  });

  it('filters by channel', () => {
    const fam = traces(buildMultiWellTraces(input([curve('A1'), curve('A2')], { channels: 'fam' })));
    expect(fam).toHaveLength(2);
    expect(fam.every((x) => x.line.dash === 'solid')).toBe(true);
    const a2 = traces(buildMultiWellTraces(input([curve('A1'), curve('A2')], { channels: 'allele2' })));
    expect(a2).toHaveLength(2);
    expect(a2.every((x) => x.line.dash === 'dash')).toBe(true);
  });

  it('colours by call with a grey unassigned group and counts per call', () => {
    const r = buildMultiWellTraces(input([curve('A1'), curve('A2'), curve('A3'), curve('A4')], { colourBasis: 'call', channels: 'fam' }));
    const byName = Object.fromEntries(r.groups.map((g) => [g.name, g]));
    expect(byName['call:AA'].wells).toBe(2);
    expect(byName['call:AA'].color).toBe('#111111');
    expect(byName['Unassigned'].color).toBe(UNASSIGNED_COLOR);
    expect(byName['Unassigned'].wells).toBe(1);
    expect(traces(r).map((x) => x.name)).toContain('call:BB (1)');
  });

  it('prefixes the channel in call-basis legend entries when both channels are shown', () => {
    const r = buildMultiWellTraces(input([curve('A1'), curve('A2')], { colourBasis: 'call' }));
    expect(new Set(traces(r).map((x) => x.name))).toEqual(new Set(['FAM · call:AA (2)', 'VIC · call:AA (2)']));
  });

  it('colours by well with the well id as legend entry, up to 12 wells', () => {
    const r = buildMultiWellTraces(input([curve('A1'), curve('A2')], { colourBasis: 'well' }));
    const t = traces(r);
    expect(r.colourBasis).toBe('well');
    expect(t.filter((x) => x.showlegend).map((x) => x.name)).toEqual(['A1', 'A2']);
    expect(t[0].line.color).toBe(t[1].line.color);
    expect(t[0].line.color).not.toBe(t[2].line.color);
    expect(r.groups.map((g) => g.wells)).toEqual([1, 1]);
  });

  it('falls back to channel colours when the well basis is asked for above 12 wells', () => {
    const r = buildMultiWellTraces(input(many(WELL_COLOUR_MAX + 1), { colourBasis: 'well' }));
    expect(r.colourBasis).toBe('channel');
  });

  it('writes hover text as well, call, channel, cycle, value', () => {
    const r = buildMultiWellTraces(input([curve('A1'), curve('A3')]));
    expect(traces(r)[0].text![1]).toBe('A1 · call:AA · FAM · Cycle 20 · 0.5');
    expect(traces(r)[0].marker!.opacity).toBe(0);
    expect(traces(r)[0].mode).toBe('lines+markers');
  });

  it('switches from per-well to merged traces above 24 wells, with null separators', () => {
    const atLimit = buildMultiWellTraces(input(many(HOVER_EMPHASIS_MAX)));
    expect(atLimit.mode).toBe('per-well');
    expect(atLimit.traces).toHaveLength(HOVER_EMPHASIS_MAX * 2);

    const r = buildMultiWellTraces(input(many(HOVER_EMPHASIS_MAX + 1)));
    const t = traces(r);
    expect(r.mode).toBe('merged');
    expect(t).toHaveLength(2);
    expect(t.map((x) => x.name)).toEqual(['FAM (25)', 'VIC (25)']);
    expect(t[0].line.dash).toBe('solid');
    expect(t[1].line.dash).toBe('dash');
    expect(t[0].x).toHaveLength(25 * 3 + 24);
    expect(t[0].x.filter((v) => v === null)).toHaveLength(24);
    expect(t[0].y[3]).toBeNull();
    expect(t[0].meta.well).toBeNull();
  });

  it('merges per channel and call group', () => {
    const wells = many(30).map((c, i) => ({ ...c, well: i < 10 ? `A${i}` : `W${i}` }));
    const r = buildMultiWellTraces(input(wells, { colourBasis: 'call', callOf: (w) => (w.startsWith('A') ? 'AA' : null) }));
    expect(traces(r).map((x) => x.name).sort()).toEqual(['FAM · Unassigned (20)', 'FAM · call:AA (10)', 'VIC · Unassigned (20)', 'VIC · call:AA (10)']);
  });

  it('hides values at or below zero on a log axis and counts them', () => {
    const r = buildMultiWellTraces(input([curve('A1', [0, 0.5, -1], [0.2, 0.3, 0.4]), curve('A2')], { yScale: 'log' }));
    expect(r.hiddenNonPositive).toBe(2);
    expect(traces(r)[0].y).toEqual([null, 0.5, null]);
    expect(buildMultiWellTraces(input([curve('A1', [0, 1, 1]), curve('A2')])).hiddenNonPositive).toBe(0);
    const single = buildMultiWellTraces(input([curve('A1', [0, 0.5, -1])], { yScale: 'log' }));
    expect(single.hiddenNonPositive).toBe(2);
    expect(traces(single)[0].y).toEqual([null, 0.5, null]);
  });

  it('keeps mid-series nulls as gaps and never turns them into zero', () => {
    const r = buildMultiWellTraces(input([curve('A1', [0.1, null as unknown as number, 0.3]), curve('A2')], { channels: 'fam' }));
    expect(traces(r)[0].y).toEqual([0.1, null, 0.3]);
    expect(traces(r)[0].text![1]).toBe('A1 · call:AA · FAM · Cycle 20');
  });

  it('emphasises one well and restores on null', () => {
    const r = buildMultiWellTraces(input([curve('A1'), curve('A2')]));
    expect(emphasisRestyle(r.traces, 'A2')).toEqual({ 'line.width': [1.5, 1.5, 3.5, 3.5], opacity: [0.2, 0.2, 1, 1] });
    expect(emphasisRestyle(r.traces, null)).toEqual({ 'line.width': [1.5, 1.5, 1.5, 1.5], opacity: [1, 1, 1, 1] });
  });
});

describe('384 wells x 45 cycles', () => {
  it('builds merged traces well within a second', () => {
    const cycles = Array.from({ length: 45 }, (_, i) => i + 1);
    const wells: AmplificationCurve[] = Array.from({ length: 384 }, (_, i) => ({
      well: `W${i}`, cycles, norm_fam: cycles.map((c) => c / 45), norm_allele2: cycles.map((c) => c / 90),
    }));
    const start = performance.now();
    const r = buildMultiWellTraces(input(wells, { colourBasis: 'call' }));
    const ms = performance.now() - start;
    expect(r.mode).toBe('merged');
    expect(ms).toBeLessThan(1000);
  });
});

describe('chart text shows names literally', () => {
  const NAME = '<b>x</b> %{y}';
  const ESCAPED = '&lt;b&gt;x&lt;/b&gt; &#37;{y}';

  it('escapes well, call and channel names in hover text and legend names', () => {
    const r = buildMultiWellTraces(input(
      [curve('A<1'), curve('A2')],
      { channelNames: { fam: 'F<AM', allele2: 'V&IC' }, callOf: () => 'AA', callName: () => NAME, colourBasis: 'call' },
    ));
    const t = traces(r);
    expect(t[0].text?.[0]).toBe(`A&lt;1 · ${ESCAPED} · F&lt;AM · Cycle 10 · 0.1`);
    expect(t.map((x) => x.name)).toContain(`F&lt;AM · ${ESCAPED} (2)`);
    expect(t.map((x) => x.name)).toContain(`V&amp;IC · ${ESCAPED} (2)`);
    // The group list that React renders keeps the name as written.
    expect(r.groups[0].name).toContain(NAME);
  });

  it('escapes names in single-well and merged traces', () => {
    const single = traces(buildMultiWellTraces(input([curve('A1')], { channelNames: { fam: '<i>F</i>', allele2: '%{x}' } })));
    expect(single.map((x) => x.name)).toEqual(['&lt;i&gt;F&lt;/i&gt;', '&#37;{x}']);
    const merged = traces(buildMultiWellTraces(input(many(HOVER_EMPHASIS_MAX + 1), { colourBasis: 'call', callOf: () => 'AA', callName: () => NAME })));
    expect(merged.every((x) => x.name.startsWith('FAM · ' + ESCAPED) || x.name.startsWith('VIC · ' + ESCAPED))).toBe(true);
    expect(merged[0].text?.[0]).toContain(ESCAPED);
  });

  it('leaves ordinary names unchanged', () => {
    const r = buildMultiWellTraces(input([curve('A1'), curve('A2')], { callName: () => 'Allele 1 (≤ 3) / 표본', colourBasis: 'call', callOf: () => 'AA' }));
    expect(traces(r)[0].text?.[0]).toBe('A1 · Allele 1 (≤ 3) / 표본 · FAM · Cycle 10 · 0.1');
  });
});
