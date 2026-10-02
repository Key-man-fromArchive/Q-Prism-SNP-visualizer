"""Safe download file names and RFC 5987 Content-Disposition."""
import pytest

from app.reporting.filenames import content_disposition, safe_filename, unique_filename


@pytest.mark.parametrize("raw,expected", [
    ("../../etc/passwd", "passwd"),
    ("..\\..\\win\\system.ini", "system.ini"),
    ("a/b/report.pdf", "report.pdf"),
    ("..", "download"),
    ("", "download"),
    ("   ", "download"),
    ("re\x00port.pdf", "report.pdf"),
    ("re\r\nport\t.pdf", "report.pdf"),
    ("rep\x7fort.pdf", "report.pdf"),
    ("...hidden.txt", "hidden.txt"),
    ("name: with*bad?chars|.csv", "name_ with_bad_chars_.csv"),
    ("결과 파일.pdf", "결과 파일.pdf"),
])
def test_safe_filename_table(raw, expected):
    assert safe_filename(raw) == expected


def test_length_cap_keeps_extension():
    name = safe_filename("a" * 500 + ".xlsx", max_length=100)
    assert len(name) <= 100 and name.endswith(".xlsx")


def test_length_cap_counts_utf8_bytes():
    name = safe_filename("가" * 200 + ".pdf", max_length=100)
    assert len(name.encode("utf-8")) <= 100 and name.endswith(".pdf")


def test_unique_filename_numbers_duplicates():
    used: set[str] = set()
    names = [unique_filename("m.png", used) for _ in range(3)]
    assert names == ["m.png", "m (2).png", "m (3).png"]
    assert unique_filename("../m.png", used) == "m (4).png"


def test_content_disposition_ascii_and_utf8():
    header = content_disposition("결과 \"a\".pdf")
    assert header.startswith("attachment; filename=\"")
    assert "filename*=UTF-8''%EA%B2%B0%EA%B3%BC%20" in header
    assert header.isascii()
    assert "\r" not in header and "\n" not in header
    assert header.count('"') == 2


def test_content_disposition_sanitises_attack():
    header = content_disposition("../x\r\nSet-Cookie: a=b.pdf")
    assert "\r" not in header and "\n" not in header and ".." not in header
