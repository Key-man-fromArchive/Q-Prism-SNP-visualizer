import { useEffect, type RefObject } from "react";

export const SCATTER_MIN_HEIGHT = 320;
const BOTTOM_GAP = 8;

/**
 * Largest scatter height that fits below `top` in a viewport of
 * `innerHeight`, never under the minimum. The aspect ratio then bounds the
 * width (CSS derives max-width from this height), so a ratio narrower than
 * the card shrinks the plot and centres it instead of overflowing.
 */
export function fitScatterHeight(top: number, innerHeight: number, below = 0): number {
  return Math.max(SCATTER_MIN_HEIGHT, Math.floor(innerHeight - top - below - BOTTOM_GAP));
}

/** Sum of the padding-bottom of every ancestor: space the card keeps under the plot. */
export function trailingPadding(el: HTMLElement): number {
  let sum = 0;
  for (let node = el.parentElement; node; node = node.parentElement) {
    sum += parseFloat(getComputedStyle(node).paddingBottom) || 0;
  }
  return sum;
}

/** Height changes at or under this many pixels are layout noise (scrollbar, rounding). */
const FIT_TOLERANCE = 2;
/** Writes allowed per window resize; a relayout that keeps flipping the height stops here. */
const FIT_BUDGET = 4;

/**
 * Keeps `--scatter-max-h` on the canvas equal to the real remaining
 * viewport height. The plot top is measured in document coordinates (a
 * scroll must not change it) and a hidden or zero-size container is skipped.
 * `onResize` fires only when the value changed by more than the tolerance
 * and the per-resize budget is left, so a relayout it triggers cannot loop
 * through the observer.
 */
export function useScatterFit(ref: RefObject<HTMLElement | null>, onResize?: () => void) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let last = 0;
    let budget = FIT_BUDGET;
    const apply = () => {
      const plot = el.querySelector<HTMLElement>("#scatter-plot") ?? el;
      const rect = plot.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      const height = fitScatterHeight(rect.top + window.scrollY, window.innerHeight, trailingPadding(plot));
      if (last !== 0 && Math.abs(height - last) <= FIT_TOLERANCE) return;
      if (budget <= 0) return;
      budget -= 1;
      last = height;
      el.style.setProperty("--scatter-max-h", `${height}px`);
      onResize?.();
    };
    const onWindowResize = () => {
      budget = FIT_BUDGET;
      apply();
    };
    apply();
    window.addEventListener("resize", onWindowResize);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(apply);
    if (observer && el.parentElement) observer.observe(el.parentElement);
    return () => {
      window.removeEventListener("resize", onWindowResize);
      observer?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref]);
}
