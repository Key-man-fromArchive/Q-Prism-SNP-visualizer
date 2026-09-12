# P9-THERMAL-LABELS — thermal-cycling profile: narrow phase-band label overlap

## 1. Problem (RED evidence)

`ProtocolThermalProfile.tsx` drew each phase band's label dead-centered on
the band with no width limit, no truncation, and no collision avoidance.
A one-step-wide band (e.g. `Pre-read`, `Initial Denaturation`) whose phase
name is longer than that single step's pixel width (`STEP_WIDTH = 72px`)
spilled into its neighbors' labels.

Reproduced with the real fixture used elsewhere in this feedback round
(`/mnt/ivt-ngs1/5.work-AI/SNP-dsicrimination/RAW-data/260126-QS3.eds`, 32
wells, 25 cycles, 8-phase touchdown protocol — same file `test-windows.spec.ts`
and `P7-VALUES.md` use), at 1440px:

```
Pre-realInitial DenatAmplification 1 (Touchdown) ×1(Amplification 2 ×13
```

`Pre-read` cuts off into `Pre-rea`, `Initial Denaturation` cuts off into
`Initial Denat`, and the trailing `0` of `×10` is eaten by `Amplification 2`.
Four labels overlapping into an unreadable run. Screenshot:
`P9-THERMAL-LABELS-before-wide-light.png` (and `-dark.png`, and at 768px —
`-before-narrow-*.png`; the diagram is a fixed-pixel-width SVG in a
horizontally-scrolling container, so viewport width does not change band
pixel widths, only how much of the diagram is visible without scrolling).

A harsher synthetic fixture (8 phases, every phase exactly one step wide,
long names, posted through the same `POST /api/data/{sid}/protocol` the
real "Save Protocol" button calls) is completely unreadable in the old
code — every single label overlaps its neighbor:
`P9-THERMAL-LABELS-before-harsh-wide-light.png`.

Automated RED evidence: `ProtocolThermalProfile.test.tsx` gained 10 new
tests before any fix code existed (`fitPhaseLabel`/`estimateTextWidth` did
not exist yet); all 7 of the ones that referenced the new exports failed
with `TypeError: ... is not a function` (10 passed — the unrelated,
already-passing baseline tests).

## 2. Chosen fix, and why the other candidates were rejected

**Chosen: shrink each band's label to fit its own band's pixel width**
(full text → word-abbreviation → ellipsis-truncation → hide), always
paired with a full-text fallback (per-band `<title>` tooltip + an
always-present screen-reader-only legend list). Implemented in the new
`protocol-thermal-label-fit.ts` module (`fitPhaseLabel`,
`estimateTextWidth`), consumed by `ProtocolThermalProfile.tsx`.

The key invariant that makes "no overlap" trivially true: bands are laid
out edge-to-edge with no gap (`xStart(next.startIndex) === xEnd(this.endIndex)`),
and each label is centered *inside* its own `[x0, x1]` span. So as long as
a label's rendered width does not exceed its own band's width, it
geometrically cannot reach past its band's edge into a neighbor's — "fits
its own band" and "does not collide with the neighbor" are the same
guarantee. This is why the fix only needs to reason about one band at a
time, not about pairs of neighbors.

Candidates considered and rejected:

- **Zigzag / two-row vertical stacking of narrow labels.** Rejected: the
  chart is already vertically dense (temperature axis, touchdown
  increment labels, read markers, duration labels all share the same
  60px-tall header/plot area). Adding a second label row would either
  collide with the existing touchdown-increment text
  (`protocol-touchdown-{step}`, drawn *inside* the plot near the ramp) or
  require enlarging `MARGIN_TOP`, which pushes every other diagram
  element down and was a bigger, riskier change for the same outcome.
- **Collision detection between actual neighbor pairs (measure both,
  compare, hide the loser).** Rejected: strictly more code for the same
  result, because bands are contiguous — the per-band-width check above
  already implies no cross-band collision. Pairwise collision detection
  would only be *necessary* if labels could be positioned independently
  of their own band (e.g. free-floating callouts), which they are not.
- **Numbered/dot markers with an external legend for every band.**
  Rejected as the default because it throws away readable words even when
  they'd fit — e.g. `Post-read` (72px band, fits with zero abbreviation)
  would needlessly become `⑥` for consistency. Reserved as the *last*
  fallback tier only (this fix's `null`/hidden case), not the primary
  strategy.
- **Hide on hover/focus only.** Rejected as the *sole* mechanism: it fails
  for touch-only devices and for anyone scanning the printed/exported
  view of this diagram (this component's docstring already commits to
  "stable output for print/PDF" as a design constraint — see file header).
  Hover *is* still provided (per-band `<title>`, native tooltip) as one of
  two accessible fallback paths, not the only one.

## 3. Character-width estimate: the constant and its evidence

`getComputedTextLength()` (the only way to ask a browser "how wide is
this exact SVG `<text>`, at this font, at this stroke halo") returns `0`
in jsdom, the project's test environment (`npm test` never runs inside a
real browser). So `fitPhaseLabel`/`estimateTextWidth` use a
character-count estimate instead of true measurement:

```ts
export const CHAR_WIDTH_PX = 10 * 0.55; // 5.5px per glyph at fontSize 10
```

0.55em is the commonly cited average glyph advance width for bold Latin
sans-serif text (Helvetica/Arial Bold AFM metrics average ~550/1000 em
across printable ASCII), and matches this diagram's actual label style
(`fontSize={10} fontWeight={600}`).

This was then checked against real Chromium screenshots (see §4/§5
below) at 1440px and 768px, for both the real EDS fixture and the harsher
synthetic one. In every screenshot the rendered labels stay inside their
band's colored rectangle with visible clearance on each side — the
estimate slightly *underestimates* available width (it doesn't know about
kerning or that most of this vocabulary's characters are narrower than
"W"/"M"), so it only truncates a little earlier than strictly necessary;
it never lets a real overflow through. No case in either fixture set
produced a visually clipped/overlapping label after the fix.

## 4. What's preserved when a label is shortened/hidden

Per `fitPhaseLabel`'s three-tier fallback:

1. Full text, if it fits (`Post-read`, `Amplification 2 ×13` when the band
   is wide enough).
2. A recognizable word abbreviation (`PHASE_ABBREVIATIONS` in
   `protocol-thermal-label-fit.ts`): `Initial Denaturation` → `Init. Denat.`,
   `Amplification` → `Ampl.`, `(Touchdown)` → `(TD)`.
3. Ellipsis truncation of the abbreviated form (`Ampl. 1 (TD…`), and, only
   if not even one character plus an ellipsis fits, `null` (no on-diagram
   text at all for that band).

Regardless of which tier applied, the full un-abbreviated phase name and
cycle count remain available two ways, both added by this fix:

- **Per-band `<title>`** (first child of each band's `<g>`, per the
  SVG-spec convention for an element's accessible name): produces a
  native tooltip on hover, always the full text.
- **A screen-reader-only `<ul aria-label={t.protocolThermalProfilePhaseLegend}>`**
  rendered right after the `<svg>`, always listing every band's full
  `${phase}${cyclesSuffix}` regardless of what the diagram had room to
  draw. This is the primary, always-present fallback — it does not
  depend on hover/pointer capability, so it also covers touch-only and
  keyboard-only use.

New locale key `protocolThermalProfilePhaseLegend` added to both
`en.ts`/`ko.ts` (the `Translations` type in `en.ts` forces `ko.ts` to stay
in sync — a missing key there is a `tsc` error, not a silent gap).

## 5. Visual verification — before/after, light/dark, wide/narrow

Backend: scratch DB (`/tmp/p9.db`, `/tmp/p9-e2e.db`), port 8170 (not
8002/production, not 8160/8161/8165 used by other agents), local
auth (`ADMIN_USER=admin`), started/stopped by PID, never by port `pkill`.
Fixture: the same real `260126-QS3.eds` file `test-windows.spec.ts` uses.

| Fixture | Viewport | Light — before | Light — after | Dark — before | Dark — after |
|---|---|---|---|---|---|
| Real EDS (8-phase touchdown) | 1440px | `P9-THERMAL-LABELS-before-wide-light.png` | `P9-THERMAL-LABELS-after-wide-light.png` | `P9-THERMAL-LABELS-before-wide-dark.png` | `P9-THERMAL-LABELS-after-wide-dark.png` |
| Real EDS (8-phase touchdown) | 768px | `P9-THERMAL-LABELS-before-narrow-light.png` | `P9-THERMAL-LABELS-after-narrow-light.png` | `P9-THERMAL-LABELS-before-narrow-dark.png` | `P9-THERMAL-LABELS-after-narrow-dark.png` |
| Harsher synthetic (8 phases, every one 1-step wide) | 1440px | `P9-THERMAL-LABELS-before-harsh-wide-light.png` | `P9-THERMAL-LABELS-after-harsh-wide-light.png` | `P9-THERMAL-LABELS-before-harsh-wide-dark.png` | `P9-THERMAL-LABELS-after-harsh-wide-dark.png` |
| Harsher synthetic (8 phases, every one 1-step wide) | 768px | `P9-THERMAL-LABELS-before-harsh-narrow-light.png` | `P9-THERMAL-LABELS-after-harsh-narrow-light.png` | `P9-THERMAL-LABELS-before-harsh-narrow-dark.png` | `P9-THERMAL-LABELS-after-harsh-narrow-dark.png` |

The harsher synthetic fixture was built by uploading the real EDS file
(for a valid session/plate), then `POST`ing a synthetic 8-step protocol
(one step per phase — `Pre-read`, `Initial Denaturation`,
`Amplification 1 (Touchdown)` ×12, `Amplification 2` ×12, `Secondary
Denaturation Hold`, `Extension (Touchdown)` ×12, `Final Extension Hold`,
`Post-read`) to `/api/data/{sid}/protocol` — the same endpoint the UI's
"Save Protocol" button calls, so this is a supported code path, not an
internal hack. It's "harsher" because every phase is exactly one step
(72px) wide, maximizing the number of adjacent narrow-band collision
points; per-band pixel width itself does not shrink with the *number* of
steps elsewhere (`STEP_WIDTH` is a fixed 72px constant), only with how
few steps a given phase has.

**Before**: every screenshot in the "before" column shows the reported
garbled/overlapping text, confirmed by reading each image.

**After**: every screenshot in the "after" column shows non-overlapping,
readable labels — full text where it fits (`Pre-read`, `Post-read`,
`Amplification 2 ×13`), word-abbreviated where needed (`Init. Denat.`,
`Ampl. 1 (TD) ×10`), and ellipsis-truncated only for the harsher fixture's
longest names (`Ampl. 2 ×1…`, `Secondary D.`, `Extension (…`, `Final
Exten…`). Viewport width (1440px vs 768px) did not change which tier
applied, confirming the fix is driven by band pixel width, not screen
width — as expected, since the diagram is a fixed-width SVG in a
horizontally-scrolling container.

## 6. Verification — 4 gates + E2E

```
cd snp-analyzer/frontend
npx tsc --noEmit   # 0 errors
npm run lint       # 0 errors, 0 warnings
npm run test -- --run   # 120 files, 849 tests passed (baseline 839 + 10 new)
npm run build      # tsc -b + vite build succeeded
```

Baseline was 120 files / 839 tests / 0 failed, tsc 0, eslint 0, build
success — unchanged except for the 10 new tests, all passing.

E2E, protocol/raw-data-relevant specs first (against port 8170):

- `tests/test-windows.spec.ts` — 4/5 passed. The 1 failure
  (`well click shows amplification curve with all 25 points`, expecting
  `#amplification-plot` visible) is about the Plotly amplification chart,
  not the thermal-profile diagram or any file this fix touches; it
  reproduces the same way with the pre-fix code checked out, so it
  predates this change.
- `tests/05-interactions.spec.ts` (includes the "Raw Data Tab" suite:
  default protocol steps load, add step, delete step) — all passed.
- `tests/25-secondary-flows.spec.ts`, `tests/04-error-files.spec.ts`,
  `tests/26-asg-compatibility.spec.ts` — all passed on this run (one
  transient tooltip-timing failure in `25-secondary-flows.spec.ts` on an
  earlier partial run did not reproduce on re-run).

Full suite, once (against port 8170): **131 passed / 6 failed** (root
baseline given was 133/4). Re-running the 6 individually: `20-keyboard`
and `24-responsive` both **passed** on retry (confirms transient,
load-related flakiness in this shared multi-agent environment — several
other specialist agents' backend/frontend dev servers were running
concurrently on this machine during this run). The remaining 3 —
`06-import-mapping.spec.ts` (CSV import mapping wizard),
`17-manual-group-and-plate-drag.spec.ts` ×2 (plate whitespace/NTC-corner
drag-select) — reproduced consistently on retry, but neither spec
exercises `ProtocolThermalProfile.tsx`, `protocol-thermal-label-fit.ts`,
`ProtocolTab.tsx`, or the locale files this change touched; they predate
this fix and are out of this task's scope (owned by other agents per the
task assignment).

## 7. Preserved per instructions

- `data-testid`s unchanged: `protocol-phase-band-{phase}-{index}`,
  `protocol-step-{step}`, `protocol-read-marker-{step}`,
  `protocol-touchdown-{step}`.
- 📷 (U+1F4F7) read marker untouched.
- Light/dark contrast: labels still use `color.label` (existing
  phase/amp color maps), halo still `var(--color-bg)`; verified in both
  modes in every screenshot above.
- No information silently dropped: full phase name + cycle count remains
  in the per-band `<title>` and the always-present sr-only legend list,
  regardless of what the diagram had room to draw.

## 8. Commit

Local commit on `feedback/p9-thermal-labels` (no merge, no push).
