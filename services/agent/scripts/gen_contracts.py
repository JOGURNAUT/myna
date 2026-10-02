"""Generate Pydantic models from packages/shared/json-schema/contracts.json.

Run:  uv run python scripts/gen_contracts.py
The drift test (tests/test_contracts.py) runs the same generation and compares.
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

AGENT_DIR = Path(__file__).resolve().parents[1]
SCHEMA = AGENT_DIR.parents[1] / "packages" / "shared" / "json-schema" / "contracts.json"
OUTPUT = AGENT_DIR / "src" / "myna_agent" / "contracts.py"


def generate(output: Path) -> None:
    subprocess.run(
        [
            sys.executable,
            "-m",
            "datamodel_code_generator",
            "--input",
            str(SCHEMA),
            "--input-file-type",
            "jsonschema",
            "--output",
            str(output),
            "--output-model-type",
            "pydantic_v2.BaseModel",
            "--snake-case-field",
            "--use-annotated",
            "--field-constraints",
            "--target-python-version",
            "3.12",
            "--disable-timestamp",
            "--use-standard-collections",
            "--use-union-operator",
            "--use-title-as-name",
            "--allow-population-by-field-name",
            "--formatters",
            "ruff-format",
            "--custom-file-header",
            "# Generated from packages/shared/json-schema/contracts.json. Do not edit.\n"
            "# Regenerate: uv run python scripts/gen_contracts.py",
        ],
        check=True,
        cwd=AGENT_DIR,
    )


if __name__ == "__main__":
    generate(OUTPUT)
    print(f"wrote {OUTPUT}")
