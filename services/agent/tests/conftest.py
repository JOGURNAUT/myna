"""Fixtures: a real API process (Node) on a temp SQLite DB, seeded, with a pinned clock."""

from __future__ import annotations

import os
import shutil
import socket
import subprocess
import tempfile
import time
from collections.abc import AsyncIterator, Iterator
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

import httpx
import pytest

from myna_agent import contracts as c
from myna_agent.conversation import Conversation, Reply
from myna_agent.nlu import NLU, RuleBasedNLU
from myna_agent.safety import FORBIDDEN_IN_REPLIES
from myna_agent.tools import ApiClient

REPO = Path(__file__).resolve().parents[3]
API_DIR = REPO / "services" / "api"
TOKEN = "pytest-agent-token-0123456789"
CLINIC = "smile-dental"
# Monday 12 Oct 2026, 09:00 IST — same instant the TS tests use.
NOW_UTC = "2026-10-12T03:30:00Z"
NOW_LOCAL = datetime(2026, 10, 12, 9, 0)


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


@dataclass(frozen=True)
class ApiServer:
    base_url: str
    token: str


@pytest.fixture(scope="module")
def api_server() -> Iterator[ApiServer]:
    node = shutil.which("node")
    if node is None:
        pytest.skip("node is not installed; skipping API-backed tests")
    port = _free_port()
    tmp = tempfile.mkdtemp(prefix="myna-agent-test-")
    env = {
        **os.environ,
        "API_HOST": "127.0.0.1",
        "API_PORT": str(port),
        "DATABASE_PATH": str(Path(tmp) / "test.db"),
        "AGENT_API_TOKEN": TOKEN,
        "SEED_DEMO": "1",
        "MYNA_FAKE_NOW": NOW_UTC,
        "NODE_ENV": "test",
    }
    log_path = Path(tmp) / "api.log"
    with log_path.open("w", encoding="utf-8") as log_file:
        proc = subprocess.Popen(
            [node, "--import", "tsx", "src/main.ts"],
            cwd=API_DIR,
            env=env,
            stdout=log_file,
            stderr=subprocess.STDOUT,
        )
        base = f"http://127.0.0.1:{port}"
        try:
            deadline = time.monotonic() + 40
            while True:
                try:
                    if httpx.get(f"{base}/health", timeout=1).status_code == 200:
                        break
                except httpx.HTTPError:
                    pass
                if proc.poll() is not None or time.monotonic() > deadline:
                    raise RuntimeError(
                        f"API did not start:\n{log_path.read_text(encoding='utf-8')}"
                    )
                time.sleep(0.2)
            yield ApiServer(base, TOKEN)
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
    shutil.rmtree(tmp, ignore_errors=True)


@dataclass
class Call:
    """A conversation plus helpers that check invariants on every reply."""

    conv: Conversation
    api: ApiClient
    replies: list[Reply] = field(default_factory=list)

    async def start(self) -> Reply:
        return self._check(await self.conv.start())

    async def say(self, text: str) -> Reply:
        return self._check(await self.conv.handle(text))

    def _check(self, reply: Reply) -> Reply:
        lowered = reply.text.lower()
        for word in FORBIDDEN_IN_REPLIES:
            assert word not in lowered, f"forbidden word {word!r} in reply: {reply.text}"
        self.replies.append(reply)
        return reply

    @property
    def all_text(self) -> str:
        return "\n".join(r.text for r in self.replies)

    async def events(self) -> list[dict]:
        return await self.api.call_events(self.conv.call_id)


@pytest.fixture
async def make_call(api_server: ApiServer) -> AsyncIterator:
    clients: list[ApiClient] = []

    async def factory(
        caller_phone: str | None = None,
        nlu: NLU | None = None,
        config_patch: dict | None = None,
    ) -> Call:
        api = ApiClient(api_server.base_url, api_server.token, CLINIC)
        clients.append(api)
        config = await api.config()
        if config_patch:
            config = config.model_copy(update=config_patch)
        call_id = await api.start_call(
            c.StartCallInput(
                direction=c.Direction.inbound, source=c.Source.hawk, caller_phone=caller_phone
            )
        )
        conv = Conversation(
            api=api,
            nlu=nlu or RuleBasedNLU(),
            config=config,
            call_id=call_id,
            caller_phone=caller_phone,
            now=lambda: NOW_LOCAL,
        )
        return Call(conv, api)

    yield factory
    for api in clients:
        await api.aclose()


@pytest.fixture
async def api(api_server: ApiServer) -> AsyncIterator[ApiClient]:
    client = ApiClient(api_server.base_url, api_server.token, CLINIC)
    yield client
    await client.aclose()
