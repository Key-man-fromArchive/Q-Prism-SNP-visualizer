import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useScatterFit } from "./scatter-fit";

let roCallbacks: Array<() => void> = [];

class FakeRO {
  constructor(cb: () => void) {
    roCallbacks.push(cb);
  }
  observe() {}
  disconnect() {}
}

function setScrollY(value: number) {
  Object.defineProperty(window, "scrollY", { value, configurable: true });
}

function setup(rectOf: () => { top: number; w: number; h: number }) {
  const parent = document.createElement("div");
  const canvas = document.createElement("div");
  const plot = document.createElement("div");
  plot.id = "scatter-plot";
  canvas.appendChild(plot);
  parent.appendChild(canvas);
  document.body.appendChild(parent);
  plot.getBoundingClientRect = () => {
    const r = rectOf();
    return { top: r.top, bottom: r.top + r.h, left: 0, right: r.w, width: r.w, height: r.h, x: 0, y: r.top, toJSON: () => ({}) };
  };
  return canvas;
}

/** Runs `onSet` every time the hook writes the height variable, like a relayout would. */
function onHeightWrite(canvas: HTMLElement, onSet: () => void) {
  const orig = canvas.style.setProperty.bind(canvas.style);
  canvas.style.setProperty = (k: string, v: string | null) => {
    onSet();
    orig(k, v);
  };
}

function fire(times: number) {
  for (let i = 0; i < times; i++) roCallbacks.forEach((cb) => cb());
}

describe("useScatterFit feedback safety", () => {
  beforeEach(() => {
    roCallbacks = [];
    vi.stubGlobal("ResizeObserver", FakeRO);
    Object.defineProperty(window, "innerHeight", { value: 1000, configurable: true });
    setScrollY(0);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  it("keeps the height when only the scroll position changed", () => {
    const canvas = setup(() => ({ top: 500 - window.scrollY, w: 800, h: 400 }));
    renderHook(() => useScatterFit({ current: canvas }, vi.fn()));
    const first = canvas.style.getPropertyValue("--scatter-max-h");
    expect(first).not.toBe("");
    setScrollY(200);
    fire(1);
    expect(canvas.style.getPropertyValue("--scatter-max-h")).toBe(first);
  });

  it("skips measuring a hidden (zero-size) container", () => {
    const canvas = setup(() => ({ top: 0, w: 0, h: 0 }));
    const onResize = vi.fn();
    renderHook(() => useScatterFit({ current: canvas }, onResize));
    expect(canvas.style.getPropertyValue("--scatter-max-h")).toBe("");
    expect(onResize).not.toHaveBeenCalled();
  });

  it("ignores a one-pixel nudge of the plot top", () => {
    let writes = 0;
    const canvas = setup(() => ({ top: 500 + (writes % 2), w: 800, h: 400 }));
    onHeightWrite(canvas, () => writes++);
    const onResize = vi.fn();
    renderHook(() => useScatterFit({ current: canvas }, onResize));
    fire(50);
    expect(onResize.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it("stays finite when each height change shifts the layout by a row", () => {
    let extra = 0;
    const canvas = setup(() => ({ top: 500 + extra, w: 800, h: 400 }));
    onHeightWrite(canvas, () => {
      extra = extra === 0 ? 30 : 0;
    });
    const onResize = vi.fn();
    renderHook(() => useScatterFit({ current: canvas }, onResize));
    fire(50);
    expect(onResize.mock.calls.length).toBeLessThanOrEqual(4);
  });
});
