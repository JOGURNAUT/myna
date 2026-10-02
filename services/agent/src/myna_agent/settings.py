"""Environment settings (repo-root .env is loaded by the server entrypoint)."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]


def load_dotenv(path: Path = REPO_ROOT / ".env") -> None:
    """Minimal .env loader; real environment variables win."""
    if not path.exists():
        return
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip("'\""))


@dataclass(frozen=True)
class Settings:
    api_base_url: str
    agent_api_token: str
    llm_provider: str  # "sarvam" | "rules"
    sarvam_api_key: str | None
    sarvam_model: str
    port: int
    #: Pinned clock for tests and Hawk (UTC ISO). Refused when APP_ENV=production.
    fake_now: str | None = None

    @classmethod
    def from_env(cls) -> Settings:
        token = os.environ.get("AGENT_API_TOKEN", "")
        if len(token) < 12:
            raise RuntimeError("set AGENT_API_TOKEN (12+ characters) in .env")
        return cls(
            api_base_url=os.environ.get("API_BASE_URL", "http://127.0.0.1:4000"),
            agent_api_token=token,
            llm_provider=os.environ.get("LLM_PROVIDER", "sarvam"),
            sarvam_api_key=os.environ.get("SARVAM_API_KEY") or None,
            sarvam_model=os.environ.get("SARVAM_MODEL", "sarvam-105b"),
            port=int(os.environ.get("AGENT_PORT", "8000")),
            fake_now=_fake_now(),
        )


def _fake_now() -> str | None:
    value = os.environ.get("MYNA_FAKE_NOW") or None
    if value and os.environ.get("APP_ENV") == "production":
        raise RuntimeError("MYNA_FAKE_NOW is not allowed in production")
    return value
