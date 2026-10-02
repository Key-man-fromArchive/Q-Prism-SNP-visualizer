import { describe, expect, it } from "vitest";
import en from "@/locales/en";
import ko from "@/locales/ko";
import { channelLabels, normalizationLabel, normalizedLabel } from "./channel-labels";

describe("normalization label fallback", () => {
  const labels = channelLabels(null, null);

  it("uses the backend channel name when present", () => {
    const named = channelLabels({ channel_labels: { normalization: "ROX" } } as never, null);
    expect(normalizationLabel(named, "정규화")).toBe("ROX");
  });

  it("falls back to the supplied localized text", () => {
    expect(normalizationLabel(labels, ko.normalizationFallback)).toBe("정규화");
    expect(normalizationLabel(labels, en.normalizationFallback)).toBe("Normalization");
    expect(normalizedLabel("FAM", labels, true, ko.normalizationFallback)).toBe("FAM / 정규화");
  });

  it("keeps en and ko fallback keys defined", () => {
    expect(ko.normalizationFallback).toBeTruthy();
    expect(en.normalizationFallback).toBeTruthy();
  });
});
