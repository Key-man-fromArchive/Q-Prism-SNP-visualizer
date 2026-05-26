import os


def _int_env(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, str(default)))
    except ValueError:
        return default


AUTH_MODE_LOCAL = "local"
AUTH_MODE_ASG_LAUNCH = "asg_launch"
SUPPORTED_AUTH_MODES = {AUTH_MODE_LOCAL, AUTH_MODE_ASG_LAUNCH}

SESSION_EXPIRY_MINUTES = _int_env("SESSION_EXPIRY_MINUTES", 60)
ASG_SESSION_EXPIRY_MINUTES = _int_env("ASG_SESSION_EXPIRY_MINUTES", 60)
SESSION_RETENTION_DAYS = _int_env("SESSION_RETENTION_DAYS", 30)
MAX_UPLOAD_SIZE_MB = _int_env("MAX_UPLOAD_SIZE_MB", 50)
MAX_UPLOAD_SIZE_BYTES = MAX_UPLOAD_SIZE_MB * 1024 * 1024
UPLOAD_CHUNK_SIZE = _int_env("UPLOAD_CHUNK_SIZE", 1024 * 1024)
SUPPORTED_EXTENSIONS = {".xls", ".xlsx", ".eds", ".pcrd", ".zip", ".csv", ".tsv", ".rdml", ".rdm"}
SUPPORTED_UPLOAD_CONTENT_TYPES = {
    ".eds": {"application/octet-stream", "application/zip", "application/x-zip", "application/x-zip-compressed"},
    ".pcrd": {"application/octet-stream", "application/zip", "application/x-zip", "application/x-zip-compressed"},
    ".xls": {"application/octet-stream", "application/vnd.ms-excel"},
    ".xlsx": {"application/octet-stream", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
    ".zip": {"application/octet-stream", "application/zip", "application/x-zip", "application/x-zip-compressed"},
    ".csv": {"application/octet-stream", "text/csv", "application/csv", "text/plain"},
    ".tsv": {"application/octet-stream", "text/tab-separated-values", "text/plain"},
    ".rdml": {"application/octet-stream", "application/zip", "application/xml", "text/xml"},
    ".rdm": {"application/octet-stream", "application/zip", "application/xml", "text/xml"},
}
WELL_ROWS = "ABCDEFGH"
WELL_COLS = 12

MAX_ZIP_ENTRIES = _int_env("MAX_ZIP_ENTRIES", 500)
MAX_ZIP_UNCOMPRESSED_MB = _int_env("MAX_ZIP_UNCOMPRESSED_MB", 100)
MAX_ZIP_UNCOMPRESSED_BYTES = MAX_ZIP_UNCOMPRESSED_MB * 1024 * 1024
MAX_ZIP_COMPRESSION_RATIO = _int_env("MAX_ZIP_COMPRESSION_RATIO", 100)

ASG_BASE_URL = os.environ.get("ASG_BASE_URL", "http://asg-saas-v2-web:8000").rstrip("/")
ASG_SNP_SERVICE_SECRET = os.environ.get("ASG_SNP_SERVICE_SECRET", "")
ASG_CLIENT_TIMEOUT_SECONDS = _int_env("ASG_CLIENT_TIMEOUT_SECONDS", 5)
SNP_ROOT_PATH = os.environ.get("SNP_ROOT_PATH", "").rstrip("/")
SNP_COOKIE_PATH = os.environ.get("SNP_COOKIE_PATH", "/") or "/"
ASG_LAUNCH_COOKIE_NAME = os.environ.get("ASG_LAUNCH_COOKIE_NAME", "snp_launch_token")
ASG_LAUNCH_COOKIE_PATH = os.environ.get(
    "ASG_LAUNCH_COOKIE_PATH",
    f"{SNP_ROOT_PATH}/api/auth" if SNP_ROOT_PATH else "/api/auth",
)


def get_auth_mode() -> str:
    mode = os.environ.get("SNP_AUTH_MODE", AUTH_MODE_LOCAL).strip().lower()
    if mode not in SUPPORTED_AUTH_MODES:
        supported = ", ".join(sorted(SUPPORTED_AUTH_MODES))
        raise RuntimeError(f"SNP_AUTH_MODE must be one of: {supported}")
    return mode


def is_asg_launch_mode() -> bool:
    return get_auth_mode() == AUTH_MODE_ASG_LAUNCH
