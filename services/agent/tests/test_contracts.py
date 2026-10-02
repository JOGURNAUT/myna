"""The generated Pydantic models must match packages/shared's JSON Schema."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

AGENT = Path(__file__).resolve().parents[1]
COMMITTED = AGENT / "src" / "myna_agent" / "contracts.py"


def _load_generator():
    spec = importlib.util.spec_from_file_location(
        "gen_contracts", AGENT / "scripts" / "gen_contracts.py"
    )
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules["gen_contracts"] = module
    spec.loader.exec_module(module)
    return module


def _text(path: Path) -> str:
    # Line endings depend on the OS and git settings, not on the contract.
    return path.read_text(encoding="utf-8").replace("\r\n", "\n")


def test_generated_models_are_up_to_date() -> None:
    gen = _load_generator()
    # Generate inside the project so the formatter picks up the same ruff settings.
    fresh = AGENT / "src" / "myna_agent" / "_contracts_check.py"
    try:
        gen.generate(fresh)
        regenerated = _text(fresh)
    finally:
        fresh.unlink(missing_ok=True)
    assert regenerated == _text(COMMITTED), (
        "contracts.py is stale: run `uv run python scripts/gen_contracts.py`"
    )
