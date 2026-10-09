import os
import sys
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

# The periodic housekeeping task is off in tests; tests that exercise it call
# app.services.maintenance.run_maintenance() directly.
os.environ["SNP_MAINTENANCE_INTERVAL_SECONDS"] = "0"
