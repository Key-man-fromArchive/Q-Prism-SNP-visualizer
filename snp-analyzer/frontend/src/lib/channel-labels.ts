import type { ChannelLabels, RoleLabelMetadata } from "@/types/api";

export function channelLabels(
  metadata: RoleLabelMetadata | null | undefined,
  allele2Dye: string | null | undefined
): ChannelLabels {
  return {
    fam: metadata?.channel_labels?.fam || "FAM",
    allele2: metadata?.channel_labels?.allele2 || allele2Dye || "Allele2",
    normalization: metadata?.channel_labels?.normalization ?? null,
  };
}

export function normalizationLabel(labels: ChannelLabels): string {
  return labels.normalization || "Normalization";
}

export function normalizedLabel(label: string, labels: ChannelLabels, useNormalization: boolean): string {
  return useNormalization ? `${label} / ${normalizationLabel(labels)}` : label;
}
