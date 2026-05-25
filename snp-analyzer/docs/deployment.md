# Deployment Notes

## Runtime persistence

The default Docker deployment stores SQLite data in the named volume mounted at
`/app/data`. Set `DB_PATH=/app/data/snp_analyzer.db` so the runtime database is
created in that persistent volume, not inside `/app/app`.

If an existing development database exists at `app/data/snp_analyzer.db`, treat
it as development residue unless staging explicitly needs those rows. To keep
it, stop the service and copy it into the named volume before the first
production start.

## Authentication mode

`SNP_AUTH_MODE` currently supports:

- `local`: SNP Analyze manages local users and JWT cookies.
- `asg_launch`: accepts one-time launch tokens from ASG Designer and creates
  local shadow users with SNP `user` privileges.

All modes require a non-default `JWT_SECRET_KEY` of at least 32 characters at
startup. Do not map ASG administrators to SNP Analyze administrators without an
explicit authorization decision.

In `asg_launch` mode, configure:

```bash
ASG_BASE_URL=http://asg-saas-v2-web:8000
ASG_SNP_SERVICE_SECRET=<same secret as ASG SNP_ANALYZE_SERVICE_SECRET>
ASG_SESSION_EXPIRY_MINUTES=60
SNP_COOKIE_PATH=/
```

Local login, password changes, local user management, admin dashboards, and
startup admin creation are disabled in `asg_launch` mode. Existing local-mode
JWT cookies are rejected after switching to `asg_launch`.

## Upload limits

Uploads are streamed to a temporary file and rejected after `MAX_UPLOAD_SIZE_MB`.
ZIP-like instrument archives are also checked for entry count, unsafe member
paths, total uncompressed size, and extreme compression ratios before parsing.
Sessions should be retained for `SESSION_RETENTION_DAYS` days in standalone
mode. The cleanup helper deletes SQLite rows only; because the running app also
keeps process-local session caches, stop the service before cleanup and start it
again afterward:

```bash
docker compose stop snp-analyzer
docker compose run --rm --no-deps snp-analyzer python - <<'PY'
from app.db import cleanup_sessions_older_than
print(cleanup_sessions_older_than())
PY
docker compose up -d snp-analyzer
```

## Worker model

The current session cache is process-local: single worker only until session
state is refactored. Run one application worker until session state is moved
fully into SQLite or another shared store.
