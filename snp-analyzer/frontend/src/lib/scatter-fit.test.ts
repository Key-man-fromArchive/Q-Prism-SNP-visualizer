import { describe, expect, it } from "vitest";
import { fitScatterHeight, trailingPadding } from "./scatter-fit";

describe("fitScatterHeight", () => {
  it("fills the space below the plot top, minus the bottom gap", () => {
    expect(fitScatterHeight(535, 1000)).toBe(457);
    expect(fitScatterHeight(295, 1080)).toBe(777);
  });
  it("also leaves room for the padding under the plot", () => {
    expect(fitScatterHeight(535, 1000, 24)).toBe(433);
  });
  it("keeps the plot bottom plus padding at or above innerHeight - 8", () => {
    const top = 535;
    const below = 24;
    expect(top + fitScatterHeight(top, 1000, below) + below).toBeLessThanOrEqual(1000 - 8);
  });
  it("never goes under the minimum", () => {
    expect(fitScatterHeight(900, 1000)).toBe(320);
  });
  it("floors fractional tops", () => {
    expect(fitScatterHeight(300.6, 1000)).toBe(691);
  });
});

describe("trailingPadding", () => {
  it("sums padding-bottom of the element's ancestors", () => {
    const outer = document.createElement("div");
    outer.style.paddingBottom = "16px";
    const inner = document.createElement("div");
    inner.style.paddingBottom = "8px";
    const plot = document.createElement("div");
    inner.appendChild(plot);
    outer.appendChild(inner);
    document.body.appendChild(outer);
    expect(trailingPadding(plot)).toBe(24);
    outer.remove();
  });
});
