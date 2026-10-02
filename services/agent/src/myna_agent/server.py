"""Text endpoint: what Hawk (text mode) and the web demo talk to. Voice joins in M3.

POST /v1/calls                  {clinicId, callerPhone?, source?} → {callId, reply}
POST /v1/calls/{callId}/turns   {text}                            → {reply}
"""

from __future__ import annotations

import json
import logging
import time
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Literal

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from . import contracts as c
from .conversation import Conversation, Reply
from .llm.sarvam import SarvamNLU, WithFallback
from .nlu import NLU, RuleBasedNLU
from .settings import Settings, load_dotenv
from .tools import ApiClient, ToolError

log = logging.getLogger("myna.server")

SESSION_IDLE_SECONDS = 30 * 60


class StartCall(BaseModel):
    clinic_id: str = Field(alias="clinicId")
    caller_phone: str | None = Field(None, alias="callerPhone")
    source: Literal["patient", "manual_test", "hawk"] = "patient"


class Turn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


class ReplyOut(BaseModel):
    text: str
    state: str
    language: str
    ended: bool
    handoff_to: str | None = Field(None, serialization_alias="handoffTo")

    @classmethod
    def of(cls, r: Reply) -> ReplyOut:
        return cls(
            text=r.text,
            state=r.state.value,
            language=r.language,
            ended=r.ended,
            handoff_to=r.handoff_to,
        )


@dataclass
class Session:
    conv: Conversation
    api: ApiClient
    touched: float


def make_nlu(settings: Settings, clinic_name: str) -> NLU:
    if settings.llm_provider == "rules":
        return RuleBasedNLU()
    if settings.llm_provider == "sarvam":
        if not settings.sarvam_api_key:
            raise RuntimeError(
                "LLM_PROVIDER=sarvam needs SARVAM_API_KEY (or set LLM_PROVIDER=rules)"
            )
        sarvam = SarvamNLU(
            settings.sarvam_api_key, model=settings.sarvam_model, clinic_name=clinic_name
        )
        return WithFallback(sarvam, RuleBasedNLU())
    raise RuntimeError(f"unknown LLM_PROVIDER {settings.llm_provider!r}")


def create_app(
    settings: Settings | None = None,
    nlu_factory: Callable[[str], NLU] | None = None,
    now: Callable[[], object] | None = None,
) -> FastAPI:
    sessions: dict[str, Session] = {}

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        yield
        for s in sessions.values():
            await s.api.aclose()

    app = FastAPI(title="Myna agent", lifespan=lifespan)
    cfg = settings or Settings.from_env()

    async def sweep() -> None:
        cutoff = time.monotonic() - SESSION_IDLE_SECONDS
        for call_id in [k for k, s in sessions.items() if s.touched < cutoff]:
            await sessions.pop(call_id).api.aclose()

    @app.get("/health")
    async def health() -> dict[str, bool]:
        return {"ok": True}

    @app.post("/v1/calls")
    async def start_call(body: StartCall) -> dict[str, object]:
        await sweep()
        api = ApiClient(cfg.api_base_url, cfg.agent_api_token, body.clinic_id)
        try:
            config = await api.config()
            call_id = await api.start_call(
                c.StartCallInput(
                    direction=c.Direction.inbound,
                    source=c.Source(body.source),
                    caller_phone=body.caller_phone,
                )
            )
        except ToolError as e:
            await api.aclose()
            raise HTTPException(404 if e.code == "NOT_FOUND" else 502, e.message) from e
        nlu = nlu_factory(config.name) if nlu_factory else make_nlu(cfg, config.name)
        conv = Conversation(
            api=api,
            nlu=nlu,
            config=config,
            call_id=call_id,
            caller_phone=body.caller_phone,
            **({"now": now} if now else {}),
        )
        reply = await conv.start()
        sessions[call_id] = Session(conv, api, time.monotonic())
        if reply.ended:
            await sessions.pop(call_id).api.aclose()
        return {"callId": call_id, "reply": ReplyOut.of(reply).model_dump(by_alias=True)}

    @app.post("/v1/calls/{call_id}/turns")
    async def turn(call_id: str, body: Turn) -> dict[str, object]:
        session = sessions.get(call_id)
        if session is None:
            raise HTTPException(404, "unknown or finished call")
        session.touched = time.monotonic()
        reply = await session.conv.handle(body.text)
        if reply.ended:
            await sessions.pop(call_id).api.aclose()
        return {"reply": ReplyOut.of(reply).model_dump(by_alias=True)}

    return app


class JsonLogFormatter(logging.Formatter):
    """One JSON object per line (Cloud Run / Cloud Logging friendly)."""

    def format(self, record: logging.LogRecord) -> str:
        entry = {
            "severity": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
            "time": self.formatTime(record, "%Y-%m-%dT%H:%M:%S%z"),
        }
        if record.exc_info:
            entry["exception"] = self.formatException(record.exc_info)
        return json.dumps(entry, ensure_ascii=False)


def main() -> None:
    import uvicorn

    load_dotenv()
    handler = logging.StreamHandler()
    handler.setFormatter(JsonLogFormatter())
    logging.basicConfig(level=logging.INFO, handlers=[handler], force=True)
    logging.getLogger("httpx").setLevel(logging.WARNING)  # one line per API call is noise
    settings = Settings.from_env()
    uvicorn.run(create_app(settings), host="127.0.0.1", port=settings.port)


if __name__ == "__main__":
    main()
