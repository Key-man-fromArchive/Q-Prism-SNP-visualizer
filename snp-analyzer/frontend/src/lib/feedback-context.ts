// @TASK feat/user-feedback — automatic reproduction context for a feedback item.
// @SPEC The report must be reproducible without asking the operator to
//       describe their screen, WITHOUT exposing their sample identities.

import type { FeedbackContext } from '@/types/api';

/**
 * Builds the context attached to a submitted feedback item.
 *
 * This app is a single-page, tab-based workspace — there are no routes to read
 * a page key off (see `TabId` in components/layout/TabNavigation.tsx), so the
 * caller passes the active tab and, where one exists, the sub-surface within
 * it. Everything else is read from the stores at submit time.
 *
 * What is deliberately NOT collected: sample names, well ids, genotype calls,
 * fluorescence values or the uploaded filename. An admin triaging feedback can
 * read every item in the system, and AGENTS.md treats sample identifiers as
 * private. A parser or clustering bug is reproducible from the run's SHAPE —
 * instrument, well/cycle counts, ploidy, the analysed cycle — which is what
 * this carries instead.
 */
export type FeedbackContextInput = {
  pageKey: string;
  surface?: string | null;
  sessionId?: string | null;
  instrument?: string | null;
  numWells?: number | null;
  numCycles?: number | null;
  ploidy?: number | null;
  cycle?: number | null;
  language?: string | null;
};

/** Kept short enough to stay readable in the admin panel; the tail of a UA
 *  string is boilerplate and the leading part carries the browser/OS. */
const MAX_USER_AGENT_LENGTH = 300;

export function buildFeedbackContext(input: FeedbackContextInput): FeedbackContext {
  const context: FeedbackContext = { page_key: input.pageKey };

  if (input.surface) context.surface = input.surface;
  if (input.sessionId) context.session_id = input.sessionId;
  if (input.instrument) context.instrument = input.instrument;
  if (typeof input.numWells === 'number') context.num_wells = input.numWells;
  if (typeof input.numCycles === 'number') context.num_cycles = input.numCycles;
  if (typeof input.ploidy === 'number') context.ploidy = input.ploidy;
  // Cycle 0 means "nothing analysed yet" and is not worth reporting.
  if (typeof input.cycle === 'number' && input.cycle > 0) context.cycle = input.cycle;
  if (input.language) context.language = input.language;

  // Browser facts. Guarded because the widget is also rendered in tests and
  // in non-DOM environments where these are absent.
  if (typeof window !== 'undefined') {
    const { innerWidth, innerHeight } = window;
    if (innerWidth && innerHeight) context.viewport = `${innerWidth}x${innerHeight}`;
    const ua = window.navigator?.userAgent;
    if (ua) context.user_agent = ua.slice(0, MAX_USER_AGENT_LENGTH);
  }

  return context;
}

/** One-line summary of a context for the admin list, e.g.
 *  "analysis · CFX Opus · 96 wells / 40 cycles · cycle 40". */
export function describeFeedbackContext(context: FeedbackContext | null | undefined): string {
  if (!context) return '';
  const parts: string[] = [];
  if (context.page_key) {
    parts.push(context.surface ? `${context.page_key} / ${context.surface}` : context.page_key);
  }
  if (context.instrument) parts.push(context.instrument);
  if (context.num_wells && context.num_cycles) {
    parts.push(`${context.num_wells}w / ${context.num_cycles}c`);
  }
  if (context.ploidy) parts.push(`${context.ploidy}n`);
  if (context.cycle) parts.push(`cycle ${context.cycle}`);
  if (context.viewport) parts.push(context.viewport);
  return parts.join(' · ');
}
