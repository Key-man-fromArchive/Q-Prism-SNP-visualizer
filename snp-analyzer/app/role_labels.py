from __future__ import annotations

from app.models import UnifiedData


def _role_channel(unified: UnifiedData, role: str, fallback: str) -> str:
    channel = (unified.role_channels or {}).get(role)
    if isinstance(channel, str) and channel.strip():
        return channel.strip()
    return fallback


def _role_label(role: str, channel: str) -> str:
    return f"{role} ({channel})" if channel else role


def build_role_label_metadata(unified: UnifiedData) -> dict[str, object]:
    """Build display labels for the legacy duplex data fields.

    Phase P5 keeps triplex/quad imports preview-only. Runtime analysis still exposes
    the legacy FAM/allele2 numeric fields, with role-aware labels layered on top.
    """
    wt_channel = _role_channel(unified, "WT", "FAM")
    mt1_channel = _role_channel(unified, "MT1", unified.allele2_dye or "Allele2")

    role_channels = {
        "WT": wt_channel,
        "MT1": mt1_channel,
    }
    for role, channel in (unified.role_channels or {}).items():
        if isinstance(role, str) and isinstance(channel, str) and channel.strip():
            role_channels[role] = channel.strip()

    role_channel_labels = {
        role: _role_label(role, channel)
        for role, channel in role_channels.items()
    }

    normalization_channel = (
        role_channels.get("normalization")
        or unified.normalization_dye
        or unified.normalization_channel
    )
    if normalization_channel:
        role_channel_labels["normalization"] = _role_label(
            "Normalization",
            normalization_channel,
        )

    channel_labels = {
        "fam": role_channel_labels["WT"],
        "allele2": role_channel_labels["MT1"],
        "normalization": role_channel_labels.get("normalization"),
    }

    return {
        "channel_labels": channel_labels,
        "role_channel_labels": role_channel_labels,
        "role_channels": role_channels,
        "normalization_mode": unified.normalization_mode,
        "normalization_channel": unified.normalization_channel,
        "normalization_dye": unified.normalization_dye,
    }
