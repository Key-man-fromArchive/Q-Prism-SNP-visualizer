from pathlib import Path
from unittest.mock import patch

from app.import_models import ImportPreview, ImportRun
from app.models import UnifiedData
from app.parsers.registry import ParserRegistry, ParserSpec, ParserTier


class RecordingParser:
    def __init__(self, parser_id: str, sniff_result: bool):
        self.parser_id = parser_id
        self.sniff_result = sniff_result

    def sniff(self, file_path: Path, original_filename: str) -> bool:
        return self.sniff_result

    def preview(self, file_path: Path, original_filename: str) -> ImportPreview:
        return ImportPreview(preview_id="preview", parser_id=self.parser_id, filename=original_filename)

    def parse(self, file_path: Path, original_filename: str, mapping_config=None) -> ImportRun:
        raise NotImplementedError

    def to_unified(self, import_run: ImportRun) -> UnifiedData:
        raise NotImplementedError


def test_parser_registry_orders_vendor_before_standard_before_generic():
    registry = ParserRegistry()
    registry.register(ParserSpec("generic", ParserTier.GENERIC, (".csv",), RecordingParser("generic", True)))
    registry.register(ParserSpec("standard", ParserTier.STANDARD, (".csv",), RecordingParser("standard", True)))
    registry.register(ParserSpec("vendor", ParserTier.VENDOR, (".csv",), RecordingParser("vendor", True)))

    parser = registry.match(Path("plate.csv"), original_filename="plate.csv")

    assert parser is not None
    assert parser.parser_id == "vendor"


def test_parser_registry_skips_extension_mismatches_before_sniffing():
    registry = ParserRegistry()
    registry.register(ParserSpec("generic", ParserTier.GENERIC, (".tsv",), RecordingParser("generic", True)))

    assert registry.match(Path("plate.csv"), original_filename="plate.csv") is None


def test_detector_keeps_existing_extension_dispatch_order():
    from app.parsers import detector

    with patch.object(detector, "_handle_eds") as eds:
        detector.detect_and_parse("/tmp/plate.eds", original_filename="plate.eds")
        eds.assert_called_once_with("/tmp/plate.eds")

    with patch.object(detector, "_handle_quantstudio") as quantstudio:
        detector.detect_and_parse("/tmp/plate.xls", original_filename="plate.xls")
        quantstudio.assert_called_once_with("/tmp/plate.xls", "plate.xls")

    with patch.object(detector, "_handle_pcrd") as pcrd:
        detector.detect_and_parse("/tmp/plate.pcrd", original_filename="plate.pcrd")
        pcrd.assert_called_once_with("/tmp/plate.pcrd")

    with patch.object(detector, "_handle_cfx_opus") as cfx:
        detector.detect_and_parse("/tmp/plate.xlsx", original_filename="plate.xlsx")
        cfx.assert_called_once_with("/tmp/plate.xlsx", "plate.xlsx")

    with patch.object(detector, "_handle_zip") as zip_handler:
        detector.detect_and_parse("/tmp/plate.zip", original_filename="plate.zip")
        zip_handler.assert_called_once_with("/tmp/plate.zip", "plate.zip")


def test_default_registry_discovers_p2_template_parsers():
    from app.parsers.registry import build_default_parser_registry

    fixtures = Path(__file__).parent / "fixtures" / "import"
    registry = build_default_parser_registry()

    assert registry.match(fixtures / "rdml" / "wt_mt.rdml", "wt_mt.rdml").parser_id == "rdml"
    assert registry.match(fixtures / "rdml" / "wt_mt.rdml", "wt_mt.rdm").parser_id == "rdml"
    assert registry.match(fixtures / "rdes_extension" / "wt_mt.tsv", "wt_mt.tsv").parser_id == "qprism-rdes"
    assert registry.match(fixtures / "generic_long" / "wt_mt.csv", "wt_mt.csv").parser_id == "generic-long"
    assert registry.match(fixtures / "generic_wide" / "wt_mt.csv", "wt_mt.csv").parser_id == "generic-wide"
