"""Fix broken CFX Opus xlsx packaging.

Bio-Rad CFX Opus/Maestro generates xlsx files with three defects:
1. Backslash path separators (e.g., xl\\workbook.xml)
2. Lowercase [content_types].xml (should be [Content_Types].xml)
3. Lowercase xl/sharedstrings.xml (should be xl/sharedStrings.xml)
"""

import os
import tempfile
import zipfile

FILENAME_FIXES = {
    "xl/sharedstrings.xml": "xl/sharedStrings.xml",
}


def fix_cfx_xlsx(input_path: str) -> str:
    """Fix broken CFX Opus xlsx and return path to fixed temp file."""
    fd, fixed_path = tempfile.mkstemp(suffix=".xlsx", prefix="cfx_fixed_")
    os.close(fd)

    with zipfile.ZipFile(input_path, "r") as zin:
        with zipfile.ZipFile(fixed_path, "w", zipfile.ZIP_DEFLATED) as zout:
            for info in zin.infolist():
                data = zin.read(info.filename)
                new_name = info.filename.replace("\\", "/")
                if new_name.lower() == "[content_types].xml":
                    new_name = "[Content_Types].xml"
                if new_name in FILENAME_FIXES:
                    new_name = FILENAME_FIXES[new_name]
                zout.writestr(new_name, data)

    return fixed_path


def needs_fixing(path: str) -> bool:
    """Check if an xlsx file has the CFX Opus broken packaging."""
    try:
        with zipfile.ZipFile(path, "r") as z:
            names = z.namelist()
            return any("\\" in n for n in names) or any(
                n.lower() == "[content_types].xml" and n != "[Content_Types].xml"
                for n in names
            )
    except zipfile.BadZipFile:
        return False
