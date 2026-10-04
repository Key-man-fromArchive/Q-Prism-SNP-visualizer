// @TASK MULTI-CURVE-T1 - pure trace builder for the amplification curve view
// @SPEC docs/planning/multi-well-curves-2026-10-04/PLAN.md#d3-렌더링-하이브리드
// @TEST src/lib/amplification-traces.test.ts
//
// One well keeps the original two plain lines. Several wells draw the channel
// as the line shape (FAM solid, Allele2 dashed) and colour by channel, call or
// well. Up to HOVER_EMPHASIS_MAX wells get one trace each so the hovered well
// can be emphasised; more wells are merged per (channel x colour group) with
// null-separated segments so Plotly keeps a handful of traces.
import type { Data } from 'plotly.js';
import type { AmplificationCurve } from '@/types/api';

export const HOVER_EMPHASIS_MAX = 24;
export const WELL_COLOUR_MAX = 12;
export const FAM_COLOR = '#2563eb';
export const ALLELE2_COLOR = '#dc2626';
export const UNASSIGNED_COLOR = '#9ca3af';
/** Okabe-Ito based qualitative palette (12 entries) for the per-well colour basis. */
export const WELL_PALETTE = [
  '#0072b2', '#d55e00', '#009e73', '#cc79a7', '#e69f00', '#56b4e9',
  '#7a5195', '#8c6d31', '#1b9e77', '#e7298a', '#66a61e', '#a6761d',
];

export type CurveChannels = 'both' | 'fam' | 'allele2';
export type ColourBasis = 'channel' | 'call' | 'well';
export type YScale = 'linear' | 'log';
export type ChannelKey = 'fam' | 'allele2';

export type TraceMeta = { well: string | null; channel: ChannelKey; group: string };

export type MultiWellTraceInput = {
  curves: readonly AmplificationCurve[];
  channels: CurveChannels;
  colourBasis: ColourBasis;
  yScale: YScale;
  channelNames: { fam: string; allele2: string };
  /** The call a well shows, or null when it has none. */
  callOf: (well: string) => string | null;
  /** Display name of a call; the well lets marker screens use that marker's allele names. */
  callName: (call: string, well: string) => string;
  callColor: (call: string) => string;
  texts: { unassigned: string; cycle: string };
};

export type CurveGroup = { key: string; name: string; color: string; wells: number };

export type MultiWellTraces = {
  traces: Data[];
  mode: 'single' | 'per-well' | 'merged';
  /** The basis actually used (`well` falls back to `channel` above WELL_COLOUR_MAX wells). */
  colourBasis: ColourBasis;
  /** Points left out of a log axis because they were 0 or negative. */
  hiddenNonPositive: number;
  groups: CurveGroup[];
};

const UNASSIGNED_KEY = '__unassigned__';
const CHANNELS: ChannelKey[] = ['fam', 'allele2'];

function seriesOf(curve: AmplificationCurve, channel: ChannelKey): number[] {
  return channel === 'fam' ? curve.norm_fam : curve.norm_allele2;
}

function finiteOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

type Series = { x: number[]; y: (number | null)[]; hidden: number };

function prepareSeries(curve: AmplificationCurve, channel: ChannelKey, yScale: YScale): Series {
  const values = seriesOf(curve, channel);
  const y: (number | null)[] = [];
  let hidden = 0;
  for (let i = 0; i < curve.cycles.length; i += 1) {
    const v = finiteOrNull(values[i]);
    if (v !== null && yScale === 'log' && v <= 0) {
      hidden += 1;
      y.push(null);
    } else {
      y.push(v);
    }
  }
  return { x: curve.cycles, y, hidden };
}

function hoverText(
  well: string, call: string, channel: string, cycle: number, value: number | null, cycleWord: string,
): string {
  const v = value === null ? '' : ` · ${Number(value.toPrecision(5))}`;
  return `${well} · ${call} · ${channel} · ${cycleWord} ${cycle}${v}`;
}

function singleWellTraces(input: MultiWellTraceInput, curve: AmplificationCurve): MultiWellTraces {
  let hidden = 0;
  const traces: Data[] = CHANNELS.map((channel) => {
    const s = prepareSeries(curve, channel, input.yScale);
    hidden += s.hidden;
    return {
      x: s.x,
      y: s.y,
      name: input.channelNames[channel],
      line: { color: channel === 'fam' ? FAM_COLOR : ALLELE2_COLOR, width: 2 },
      meta: { well: curve.well, channel, group: channel } satisfies TraceMeta,
    } as Data;
  });
  return {
    traces,
    mode: 'single',
    colourBasis: 'channel',
    hiddenNonPositive: hidden,
    groups: [
      { key: 'fam', name: input.channelNames.fam, color: FAM_COLOR, wells: 1 },
      { key: 'allele2', name: input.channelNames.allele2, color: ALLELE2_COLOR, wells: 1 },
    ],
  };
}

type Resolved = {
  curve: AmplificationCurve;
  call: string | null;
  groupKey: string;
  groupName: string;
  color: string;
};

function resolveWell(
  input: MultiWellTraceInput, basis: ColourBasis, curve: AmplificationCurve, index: number,
): Resolved {
  const call = input.callOf(curve.well);
  const base = { curve, call };
  if (basis === 'call') {
    if (call === null) return { ...base, groupKey: UNASSIGNED_KEY, groupName: input.texts.unassigned, color: UNASSIGNED_COLOR };
    const name = input.callName(call, curve.well);
    return { ...base, groupKey: name, groupName: name, color: input.callColor(call) };
  }
  if (basis === 'well') {
    return { ...base, groupKey: curve.well, groupName: curve.well, color: WELL_PALETTE[index % WELL_PALETTE.length] };
  }
  return { ...base, groupKey: '', groupName: '', color: '' };
}

function colourFor(basis: ColourBasis, channel: ChannelKey, resolved: Resolved): string {
  if (basis === 'channel') return channel === 'fam' ? FAM_COLOR : ALLELE2_COLOR;
  return resolved.color;
}

/** Legend/group identity for a (channel, well) line under the given basis. */
function groupFor(basis: ColourBasis, channel: ChannelKey, resolved: Resolved, names: MultiWellTraceInput['channelNames']) {
  if (basis === 'channel') return { key: channel, name: names[channel] };
  if (basis === 'well') return { key: resolved.groupKey, name: resolved.groupName };
  return { key: `${channel}|${resolved.groupKey}`, name: resolved.groupName };
}

export function buildMultiWellTraces(input: MultiWellTraceInput): MultiWellTraces {
  const { curves } = input;
  if (curves.length === 1) return singleWellTraces(input, curves[0]);

  const basis: ColourBasis = input.colourBasis === 'well' && curves.length > WELL_COLOUR_MAX ? 'channel' : input.colourBasis;
  const channels = CHANNELS.filter((c) => input.channels === 'both' || input.channels === c);
  const perWell = curves.length <= HOVER_EMPHASIS_MAX;
  const resolved = curves.map((curve, i) => resolveWell(input, basis, curve, i));
  const twoChannelsInLegend = basis === 'call' && channels.length > 1;

  const groups = new Map<string, CurveGroup & { trace?: { x: (number | null)[]; y: (number | null)[]; text: string[] } }>();
  const perWellTraces: Data[] = [];
  let hidden = 0;

  for (const r of resolved) {
    for (const channel of channels) {
      const s = prepareSeries(r.curve, channel, input.yScale);
      hidden += s.hidden;
      const g = groupFor(basis, channel, r, input.channelNames);
      const color = colourFor(basis, channel, r);
      const name = twoChannelsInLegend ? `${input.channelNames[channel]} · ${g.name}` : g.name;
      let group = groups.get(g.key);
      if (!group) {
        group = { key: g.key, name, color, wells: 0 };
        groups.set(g.key, group);
      }
      const firstOfGroup = group.wells === 0;
      // The well colour basis keys one group per well, shared by both channels.
      if (basis !== 'well' || firstOfGroup) group.wells += 1;
      const callName = r.call === null ? input.texts.unassigned : input.callName(r.call, r.curve.well);
      const text = s.x.map((cycle, i) => hoverText(r.curve.well, callName, input.channelNames[channel], cycle, s.y[i], input.texts.cycle));
      const dash = channel === 'allele2' ? 'dash' : 'solid';
      const common = {
        mode: 'lines+markers',
        marker: { size: 8, opacity: 0, color },
        hovertemplate: '%{text}<extra></extra>',
        legendgroup: g.key,
      };
      if (perWell) {
        perWellTraces.push({
          ...common,
          x: s.x, y: s.y, text,
          line: { color, width: 1.5, dash },
          showlegend: firstOfGroup,
          name: group.name,
          meta: { well: r.curve.well, channel, group: g.key } satisfies TraceMeta,
        } as Data);
      } else {
        const acc = group.trace ?? { x: [], y: [], text: [] };
        group.trace = acc;
        if (acc.x.length > 0) { acc.x.push(null); acc.y.push(null); acc.text.push(''); }
        acc.x.push(...s.x); acc.y.push(...s.y); acc.text.push(...text);
      }
    }
  }

  const orderedGroups = [...groups.values()];
  const traces: Data[] = perWell
    ? perWellTraces.map((tr) => {
        const meta = (tr as { meta: TraceMeta }).meta;
        const g = groups.get(meta.group)!;
        return { ...tr, name: `${g.name}${basis === 'well' ? '' : ` (${g.wells})`}` } as Data;
      })
    : orderedGroups.map((g) => {
        const channel: ChannelKey = basis === 'well' ? 'fam' : g.key.startsWith('allele2') ? 'allele2' : 'fam';
        return {
          mode: 'lines+markers',
          x: g.trace!.x, y: g.trace!.y, text: g.trace!.text,
          marker: { size: 8, opacity: 0, color: g.color },
          hovertemplate: '%{text}<extra></extra>',
          line: { color: g.color, width: 1, dash: channel === 'allele2' ? 'dash' : 'solid' },
          name: `${g.name} (${g.wells})`,
          legendgroup: g.key,
          connectgaps: false,
          meta: { well: null, channel, group: g.key } satisfies TraceMeta,
        } as Data;
      });

  return {
    traces,
    mode: perWell ? 'per-well' : 'merged',
    colourBasis: basis,
    hiddenNonPositive: hidden,
    groups: orderedGroups.map(({ key, name, color, wells }) => ({ key, name, color, wells })),
  };
}

/** Plotly.restyle payload that emphasises one well's lines (null restores all). Per-well mode only. */
export function emphasisRestyle(traces: readonly Data[], well: string | null) {
  const metas = traces.map((tr) => (tr as { meta?: TraceMeta }).meta);
  return {
    'line.width': metas.map((m) => (well !== null && m?.well === well ? 3.5 : 1.5)),
    opacity: metas.map((m) => (well === null || m?.well === well ? 1 : 0.2)),
  };
}
