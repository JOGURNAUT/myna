"""Text endpoint: what Hawk (text mode) and the web demo talk to. Voice joins in M3.

POST /v1/calls                  {clinicId, callerPhone?, source?} → {callId, reply}
POST /v1/calls/{callId}/turns   {text}                            → {reply}
"""

from __future__ import annotations

import json
import logging
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from . import contracts as c
from .conversation import Conversation, Reply
from .llm.sarvam import NLU_STATS, SarvamNLU, WithFallback
from .nlu import NLU, RuleBasedNLU
from .settings import Settings, load_dotenv
from .tools import ApiClient, ToolError

log = logging.getLogger("myna.server")

SESSION_IDLE_SECONDS = 30 * 60


class StartCall(BaseModel):
    clinic_id: str = Field(alias="clinicId")
    caller_phone: str | None = Field(None, alias="callerPhone")
    source: Literal["patient", "manual_test", "hawk"] = "patient"


class StartOutbound(BaseModel):
    clinic_id: str = Field(alias="clinicId")
    #: A specific due reminder; default: the first one due.
    appointment_id: str | None = Field(None, alias="appointmentId")
    source: Literal["patient", "manual_test", "hawk"] = "patient"


class Turn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


class ReplyOut(BaseModel):
    text: str
    state: str
    language: str
    ended: bool
    handoff_to: str | None = Field(None, serialization_alias="handoffTo")
    expecting: str

    @classmethod
    def of(cls, r: Reply) -> ReplyOut:
        return cls(
            text=r.text,
            state=r.state.value,
            language=r.language,
            ended=r.ended,
            handoff_to=r.handoff_to,
            expecting=r.expecting,
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
    now: Callable[[], datetime] | None = None,
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

    @app.get("/v1/stats")
    async def stats() -> dict[str, object]:
        """What actually answered: provider, model, and how often the model failed over to rules."""
        return {
            "provider": cfg.llm_provider,
            "model": cfg.sarvam_model if cfg.llm_provider == "sarvam" else None,
            **{f"nlu{k.capitalize()}": v for k, v in NLU_STATS.items()},
        }

    def clock_for(config: c.BusinessConfig) -> Callable[[], datetime] | None:
        if now is not None:
            return now
        if cfg.fake_now is None:
            return None  # Conversation's default: the clinic's real wall clock
        pinned = datetime.fromisoformat(cfg.fake_now.replace("Z", "+00:00"))
        local = pinned.astimezone(ZoneInfo(config.timezone)).replace(tzinfo=None)
        return lambda: local

    async def open_call(
        clinic_id: str,
        direction: c.Direction,
        source: str,
        phone: str | None,
        pick: Callable[[ApiClient], Awaitable[c.DueReminder | None]] | None = None,
    ) -> tuple[Conversation, ApiClient, c.DueReminder | None]:
        api = ApiClient(cfg.api_base_url, cfg.agent_api_token, clinic_id)
        try:
            config = await api.config()
            reminder = await pick(api) if pick else None
            if pick and reminder is None:
                raise HTTPException(404, "no reminder is due")
            call_id = await api.start_call(
                c.StartCallInput(
                    direction=direction,
                    source=c.Source(source),
                    caller_phone=reminder.phone if reminder else phone,
                )
            )
        except ToolError as e:
            await api.aclose()
            raise HTTPException(404 if e.code == "NOT_FOUND" else 502, e.message) from e
        except HTTPException:
            await api.aclose()
            raise
        nlu = nlu_factory(config.name) if nlu_factory else make_nlu(cfg, config.name)
        clock = clock_for(config)
        conv = Conversation(
            api=api,
            nlu=nlu,
            config=config,
            call_id=call_id,
            caller_phone=reminder.phone if reminder else phone,
            **({"now": clock} if clock else {}),
        )
        return conv, api, reminder

    def keep(conv: Conversation, api: ApiClient, reply: Reply) -> dict[str, object]:
        sessions[conv.call_id] = Session(conv, api, time.monotonic())
        return {"callId": conv.call_id, "reply": ReplyOut.of(reply).model_dump(by_alias=True)}

    @app.post("/v1/calls")
    async def start_call(body: StartCall) -> dict[str, object]:
        await sweep()
        conv, api, _ = await open_call(
            body.clinic_id, c.Direction.inbound, body.source, body.caller_phone
        )
        reply = await conv.start()
        out = keep(conv, api, reply)
        if reply.ended:
            await sessions.pop(conv.call_id).api.aclose()
        return out

    @app.post("/v1/outbound")
    async def start_outbound(body: StartOutbound) -> dict[str, object]:
        """Place a reminder call (text mode: the 'callee' answers via /turns)."""
        await sweep()

        async def pick(api: ApiClient) -> c.DueReminder | None:
            due = await api.due_reminders()
            if body.appointment_id is None:
                return due[0] if due else None
            return next((d for d in due if d.appointment_id == body.appointment_id), None)

        conv, api, reminder = await open_call(
            body.clinic_id, c.Direction.outbound, body.source, None, pick
        )
        assert reminder is not None
        reply = await conv.start_outbound(reminder)
        return keep(conv, api, reply)

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
