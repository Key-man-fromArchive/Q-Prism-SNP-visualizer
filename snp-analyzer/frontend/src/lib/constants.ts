/**
 * Single source for the brand hex values that were duplicated, byte for
 * byte, across this file, genotype.ts and ProtocolTab.tsx before P0-T0.2
 * (value-invariant refactor). Every value below is unchanged from its
 * prior call site -- see
 * docs/planning/feedback-2026-09-11/evidence/P0-T0.2.md for the full
 * before/after map and the hardcoded hex that intentionally still lives
 * elsewhere (single-occurrence shades, and index.css's own tokens).
 *
 * These are fixed hex, not CSS custom properties: none of them varied by
 * theme before this change (unlike plotly-theme.ts's tokens), so routing
 * them through a `--color-*` variable would make them theme-reactive where
 * they previously weren't -- a behavior change, not a refactor. Brand
 * palette replacement (if any of these become theme-aware) is P6-S2-T1,
 * gated on decision D-2.
 */
export const BRAND_HEX = {
  /** Allele-1 / FAM channel blue. Used below (COLORS.fam, COLORS.primary,
   *  WELL_TYPE_INFO['Allele 1 Homo']), by genotype.ts's diploid allele-1
   *  pole and by ProtocolTab's 'Pre-read' label. */
  blue600: "#2563eb",
  /** Fixed (non-theme-reactive) accent blue used only by ProtocolTab's
   *  'Pre-read' border; happens to equal index.css's dark-mode --color-primary. */
  blue500: "#3b82f6",
  /** Allele-2 / HEX channel red. Used below (COLORS.allele2,
   *  WELL_TYPE_INFO['Allele 2 Homo']), by genotype.ts's diploid allele-2
   *  pole and by ProtocolTab's 'Initial Denaturation' label / Amplification-4
   *  border. */
  red600: "#dc2626",
  /** Danger red. Used below (COLORS.danger) and by ProtocolTab's
   *  'Initial Denaturation' border. */
  red500: "#ef4444",
  /** ROX channel amber. Used below (COLORS.rox,
   *  WELL_TYPE_INFO['Positive Control']) and by ProtocolTab's
   *  Amplification-1 border. */
  amber500: "#f59e0b",
  /** Balanced dosage / accent / success green, light mode. Used below
   *  (COLORS.accent, WELL_TYPE_INFO.Heterozygous), by genotype.ts's
   *  diploid + even-ploidy balanced class and by ProtocolTab's 'Post-read'
   *  border. */
  green500: "#10b981",
  /** Balanced dosage / success green, dark mode. Used by genotype.ts's
   *  dark-mode balanced class. */
  green400: "#34d399",
  /** Muted text / undetermined gray. Used below (COLORS.textMuted,
   *  WELL_TYPE_INFO.Undetermined). */
  gray500: "#6b7280",
} as const;

/** ProtocolTab named-phase border/label colors, gathered here so the
 *  component has one map to import instead of inline literals. */
export const PROTOCOL_PHASE_COLORS: Record<string, { border: string; label: string }> = {
  "Pre-read": { border: BRAND_HEX.blue500, label: BRAND_HEX.blue600 },
  "Initial Denaturation": { border: BRAND_HEX.red500, label: BRAND_HEX.red600 },
  "Post-read": { border: BRAND_HEX.green500, label: "#059669" },
};

/** ProtocolTab amplification-cycle phase colors, indexed by
 *  `(cycle number - 1) % length`. */
export const PROTOCOL_AMP_COLORS = [
  { border: BRAND_HEX.amber500, label: "#d97706" },
  { border: "#f97316", label: "#ea580c" },
  { border: "#ea580c", label: "#c2410c" },
  { border: BRAND_HEX.red600, label: "#b91c1c" },
] as const;

/** ProtocolTab fallback for a step phase matching neither map above. */
export const PROTOCOL_PHASE_FALLBACK = { border: "#94a3b8", label: "#64748b" } as const;

/** Well type definitions mirroring welltypes.js */
export const WELL_TYPE_INFO = {
  NTC: { label: "NTC", color: "#000000", symbol: "circle" },
  Unknown: { label: "Unknown", color: "#9ca3af", symbol: "circle" },
  "Positive Control": { label: "Positive Control", color: BRAND_HEX.amber500, symbol: "diamond" },
  "Allele 1 Homo": { label: "Allele 1 Homo", color: BRAND_HEX.blue600, symbol: "circle" },
  "Allele 2 Homo": { label: "Allele 2 Homo", color: BRAND_HEX.red600, symbol: "circle" },
  Heterozygous: { label: "Heterozygous", color: BRAND_HEX.green500, symbol: "circle" },
  Undetermined: { label: "Undetermined", color: BRAND_HEX.gray500, symbol: "x" },
  Empty: { label: "Empty", color: "#374151", symbol: "x" },
  Omit: { label: "Omit (exclude)", color: "#a16207", symbol: "x" },
} as const;

export const UNASSIGNED_TYPE = {
  label: "Unassigned",
  color: "#6366f1",
  symbol: "circle",
} as const;

/** Chart colors */
export const COLORS = {
  fam: BRAND_HEX.blue600,
  allele2: BRAND_HEX.red600,
  rox: BRAND_HEX.amber500,
  bg: "#f5f7fa",
  surface: "#ffffff",
  border: "#e0e4e8",
  text: "#1a1a2e",
  textMuted: BRAND_HEX.gray500,
  primary: BRAND_HEX.blue600,
  accent: BRAND_HEX.green500,
  danger: BRAND_HEX.red500,
} as const;

/** Well rows and columns for 96-well plate */
export const PLATE_ROWS = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;
export const PLATE_COLS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

/**
 * User-picked marker (assay) color palette for the multi-marker Plate Setup
 * surface (P4-S1). Fixed hex values so a marker's color stays stable across
 * light/dark theme (mirrors docs/mockups/multimarker-mockup.html PALETTE).
 */
export const MARKER_PALETTE = [
  "#7c5cd6",
  "#d98a1e",
  "#2f9e5a",
  "#d5504e",
  "#3f86c4",
  "#12a3ad",
  "#b7519f",
  "#7a8794",
] as const;
