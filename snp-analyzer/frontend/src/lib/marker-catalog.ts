// @TASK Marker catalog frontend -- shared client-side helpers
// @SPEC docs/genotyping-scientific-validity.md; app/models.py MarkerCatalogEntry.dosage_trust
//
// Mirrors the backend's derived, read-only `dosage_trust` computed field
// (`app.models.MarkerCatalogEntry.dosage_trust`) so the UI can preview the
// same "validated"/"putative" hedge (a) instantly while editing an entry's
// calibration/validation fields, before the entry is saved, and (b) as a
// safe default for a session marker that isn't linked to any catalog entry
// at all.
import type { MarkerCatalogEntry } from '@/types/api';

export type DosageTrust = 'putative' | 'validated';

/** Computes the same rule as the backend: dosage calls are only "validated"
 * once BOTH the catalog entry's ground-truth validation succeeded AND its
 * underlying amplification/ratio mapping was itself verified. */
export function computeDosageTrust(
  validationStatus: MarkerCatalogEntry['validation']['status'],
  amplificationVerified: boolean
): DosageTrust {
  return validationStatus === 'validated' && amplificationVerified ? 'validated' : 'putative';
}

/** A session marker not linked to any catalog entry (or whose linked entry
 * can't be found) is always treated as "putative" -- the honest default
 * hedge -- rather than breaking or silently assuming validated. */
export function dosageTrustForMarker(
  catalogId: string | null | undefined,
  entriesById: ReadonlyMap<string, MarkerCatalogEntry>
): DosageTrust {
  if (!catalogId) return 'putative';
  const entry = entriesById.get(catalogId);
  if (!entry) return 'putative';
  return entry.dosage_trust;
}
