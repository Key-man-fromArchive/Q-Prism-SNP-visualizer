from __future__ import annotations

from dataclasses import dataclass
from enum import IntEnum
from pathlib import Path
from typing import Protocol

from app.import_models import ImportPreview, ImportRun, MappingConfig
from app.models import UnifiedData


class ParserTier(IntEnum):
    VENDOR = 0
    STANDARD = 1
    GENERIC = 2


class ParserContract(Protocol):
    parser_id: str

    def sniff(self, file_path: Path, original_filename: str) -> bool:
        ...

    def preview(self, file_path: Path, original_filename: str) -> ImportPreview:
        ...

    def parse(
        self,
        file_path: Path,
        original_filename: str,
        mapping_config: MappingConfig | None = None,
    ) -> ImportRun:
        ...

    def to_unified(self, import_run: ImportRun) -> UnifiedData:
        ...


@dataclass(frozen=True)
class ParserSpec:
    parser_id: str
    tier: ParserTier
    extensions: tuple[str, ...]
    parser: ParserContract

    def matches_extension(self, file_path: Path, original_filename: str = "") -> bool:
        suffix = Path(original_filename or file_path.name).suffix.lower()
        return suffix in self.extensions


class ParserRegistry:
    def __init__(self) -> None:
        self._specs: list[ParserSpec] = []

    def register(self, spec: ParserSpec) -> None:
        self._specs.append(spec)
        self._specs.sort(key=lambda item: (item.tier, item.parser_id))

    def match(self, file_path: Path, original_filename: str = "") -> ParserContract | None:
        for spec in self._specs:
            if not spec.matches_extension(file_path, original_filename):
                continue
            if spec.parser.sniff(file_path, original_filename):
                return spec.parser
        return None

    def specs(self) -> tuple[ParserSpec, ...]:
        return tuple(self._specs)


PREVIEW_REQUIRED_EXTENSIONS = {".csv", ".tsv", ".txt", ".rdml", ".rdm"}


def requires_preview_for_extension(filename: str) -> bool:
    return Path(filename).suffix.lower() in PREVIEW_REQUIRED_EXTENSIONS


def build_default_parser_registry() -> ParserRegistry:
    from app.parsers.generic_table import GenericLongParser, GenericTableParser, GenericWideParser
    from app.parsers.rdes import QPrismRDESParser

    registry = ParserRegistry()
    registry.register(
        ParserSpec(
            "qprism-rdes",
            ParserTier.STANDARD,
            (".tsv", ".txt"),
            QPrismRDESParser(),
        )
    )
    registry.register(
        ParserSpec(
            "generic-long",
            ParserTier.GENERIC,
            (".csv", ".tsv", ".txt"),
            GenericLongParser(),
        )
    )
    registry.register(
        ParserSpec(
            "generic-wide",
            ParserTier.GENERIC,
            (".csv", ".tsv", ".txt"),
            GenericWideParser(),
        )
    )
    registry.register(
        ParserSpec(
            "generic-table",
            ParserTier.GENERIC,
            (".csv", ".tsv", ".txt", ".xlsx"),
            GenericTableParser(),
        )
    )
    return registry
