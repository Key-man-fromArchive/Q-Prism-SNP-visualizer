import { describe, expect, it } from "vitest";
import { fitScatterHeight } from "./scatter-fit";

describe("fitScatterHeight", () => {
  it("fills the space below the canvas top, minus the bottom gap", () => {
    expect(fitScatterHeight(535, 1000)).toBe(449);
    expect(fitScatterHeight(295, 1080)).toBe(769);
  });
  it("never goes under the minimum", () => {
    expect(fitScatterHeight(900, 1000)).toBe(320);
  });
  it("floors fractional tops", () => {
    expect(fitScatterHeight(300.6, 1000)).toBe(683);
  });
});
