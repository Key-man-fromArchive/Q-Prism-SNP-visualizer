import { useEffect, useState } from 'react';
import { getAxisBounds } from '@/lib/api';
import type { AxisBounds } from '@/lib/scatter-axes';
import { useSettingsStore } from '@/stores/settings-store';

/** The plate-wide extent (every read, every well) in allele space, or null
 *  while it is loading, failed, or the axis scope is `marker`. Callers fall
 *  back to their own per-marker / per-read range on null. */
export function usePlateAxisBounds(sessionId: string | null): AxisBounds | null {
  const axisScope = useSettingsStore((s) => s.axisScope);
  const useRox = useSettingsStore((s) => s.useRox);
  const backgroundMode = useSettingsStore((s) => s.backgroundMode);
  const [loaded, setLoaded] = useState<{ key: string; bounds: AxisBounds } | null>(null);
  const key = JSON.stringify([sessionId, useRox, backgroundMode]);
  const wanted = axisScope === 'plate' && !!sessionId;

  useEffect(() => {
    if (!wanted || !sessionId) return;
    let live = true;
    // Any failure (including a synchronous one) falls back to the caller's own range.
    Promise.resolve()
      .then(() => getAxisBounds(sessionId, useRox, backgroundMode))
      .then((res) => {
        if (!live) return;
        setLoaded({
          key,
          bounds: { xMin: res.fam.min, xMax: res.fam.max, yMin: res.allele2.min, yMax: res.allele2.max },
        });
      })
      .catch(() => {
        if (live) setLoaded(null);
      });
    return () => {
      live = false;
    };
  }, [wanted, sessionId, useRox, backgroundMode, key]);

  return wanted && loaded?.key === key ? loaded.bounds : null;
}
