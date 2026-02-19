/** Well type definitions mirroring welltypes.js */
export const WELL_TYPE_INFO = {
  NTC: { label: "NTC", color: "#000000", symbol: "circle" },
  Unknown: { label: "Unknown", color: "#9ca3af", symbol: "circle" },
  "Positive Control": { label: "Positive Control", color: "#f59e0b", symbol: "diamond" },
  "Allele 1 Homo": { label: "Allele 1 Homo", color: "#2563eb", symbol: "circle" },
  "Allele 2 Homo": { label: "Allele 2 Homo", color: "#dc2626", symbol: "circle" },
  Heterozygous: { label: "Heterozygous", color: "#10b981", symbol: "circle" },
  Undetermined: { label: "Undetermined", color: "#d1d5db", symbol: "circle" },
} as const;

export const UNASSIGNED_TYPE = {
  label: "Unassigned",
  color: "#6366f1",
  symbol: "circle",
} as const;

/** Chart colors */
export const COLORS = {
  fam: "#2563eb",
  allele2: "#dc2626",
  rox: "#f59e0b",
  bg: "#f5f7fa",
  surface: "#ffffff",
  border: "#e0e4e8",
  text: "#1a1a2e",
  textMuted: "#6b7280",
  primary: "#2563eb",
  accent: "#10b981",
  danger: "#ef4444",
} as const;

/** Well rows and columns for 96-well plate */
export const PLATE_ROWS = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;
export const PLATE_COLS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;
