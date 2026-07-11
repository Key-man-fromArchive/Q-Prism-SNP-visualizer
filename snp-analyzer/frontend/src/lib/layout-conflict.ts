// @TASK feat/library-hub - Shared layout-apply error parsing
// @SPEC docs/multi-marker-ux-decision.md §3 (L2 ploidy conflict, L3 missing wells)
//
// Extracted from PlateSetupTab so both the Plate Setup surface's contextual
// "레이아웃 적용" action AND the Library tab's "레이아웃" sub-tab "load onto
// current" action share the exact same 409 (ploidy conflict) / 400 (missing
// wells) parsing -- there is only ONE `/api/layouts/{id}/apply` response
// shape to interpret (app/routers/layouts.py), regardless of which surface
// triggered the call.
import type { ApiError } from '@/lib/api';
import type { LayoutApplyConflict } from '@/types/api';

export function extractLayoutConflict(err: ApiError): LayoutApplyConflict | null {
  const detail = (err.payload as { detail?: unknown } | null)?.detail;
  if (detail && typeof detail === 'object' && 'conflicting_marker_ids' in detail) {
    return detail as LayoutApplyConflict;
  }
  return null;
}

export function extractLayoutMissingWellsMessage(err: ApiError): string {
  const detail = (err.payload as { detail?: unknown } | null)?.detail;
  return typeof detail === 'string' ? detail : err.message;
}
