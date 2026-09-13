// @TASK P19-CYCLE-ALIGN - well x cycle alignment utilities
// @SPEC docs/planning/feedback-2026-09-11/evidence/P19-CYCLE-ALIGN.md
import { describe, expect, it } from "vitest";
import { cycleSetsDiffer, cycleValueMap, unionCycles } from "./well-cycle-alignment";

describe("unionCycles", () => {
  it("returns the union of every well's cycle numbers, sorted ascending", () => {
    const curves = [
      { well: "A1", cycles: [1, 2, 3], values: [10, 20, 30] },
      { well: "A2", cycles: [1, 3], values: [40, 60] },
    ];
    expect(unionCycles(curves)).toEqual([1, 2, 3]);
  });

  it("returns an empty array when there are no curves", () => {
    expect(unionCycles([])).toEqual([]);
  });

  it("is unaffected by well order or duplicate cycle numbers across wells", () => {
    const curves = [
      { well: "B1", cycles: [5, 2] },
      { well: "A1", cycles: [2, 1] },
    ];
    expect(unionCycles(curves)).toEqual([1, 2, 5]);
  });
});

describe("cycleSetsDiffer", () => {
  it("is false when every well shares the same cycle set", () => {
    const curves = [
      { well: "A1", cycles: [1, 2, 3] },
      { well: "A2", cycles: [1, 2, 3] },
    ];
    expect(cycleSetsDiffer(curves)).toBe(false);
  });

  it("is true when a well's cycle count is narrower than the union", () => {
    const curves = [
      { well: "A1", cycles: [1, 2, 3] },
      { well: "A2", cycles: [1, 3] },
    ];
    expect(cycleSetsDiffer(curves)).toBe(true);
  });

  it("is false when there are no curves", () => {
    expect(cycleSetsDiffer([])).toBe(false);
  });
});

describe("cycleValueMap", () => {
  it("maps each of a well's own cycle numbers to its value by CYCLE NUMBER, not array index", () => {
    // A2 skips cycle 2 entirely -- its cycle 3 reading must map to key 3,
    // not to index 1 (which would misalign it under column "2").
    const map = cycleValueMap({ well: "A2", cycles: [1, 3], values: [40, 60] });
    expect(map.get(1)).toBe(40);
    expect(map.get(2)).toBeUndefined();
    expect(map.get(3)).toBe(60);
  });

  it("returns an empty map for a well with no cycles", () => {
    expect(cycleValueMap({ well: "A1", cycles: [], values: [] }).size).toBe(0);
  });
});
