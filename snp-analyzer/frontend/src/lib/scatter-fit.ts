import { useEffect, type RefObject } from "react";

export const SCATTER_MIN_HEIGHT = 320;
const BOTTOM_GAP = 16;

/**
 * Largest scatter height that fits below `top` in a viewport of
 * `innerHeight`, never under the minimum. The aspect ratio then bounds the
 * width (CSS derives max-width from this height), so a ratio narrower than
 * the card shrinks the plot and centres it instead of overflowing.
 */
export function fitScatterHeight(top: number, innerHeight: number): number {
  return Math.max(SCATTER_MIN_HEIGHT, Math.floor(innerHeight - top - BOTTOM_GAP));
}

/**
 * Keeps `--scatter-max-h` on the canvas equal to the real remaining
 * viewport height. `onResize` fires only when the value actually changed,
 * so a relayout it triggers cannot loop through the observer.
 */
export function useScatterFit(ref: RefObject<HTMLElement | null>, onResize?: () => void) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let last = 0;
    const apply = () => {
      const height = fitScatterHeight(el.getBoundingClientRect().top, window.innerHeight);
      if (height === last) return;
      last = height;
      el.style.setProperty("--scatter-max-h", `${height}px`);
      onResize?.();
    };
    apply();
    window.addEventListener("resize", apply);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(apply);
    if (observer && el.parentElement) observer.observe(el.parentElement);
    return () => {
      window.removeEventListener("resize", apply);
      observer?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref]);
}
