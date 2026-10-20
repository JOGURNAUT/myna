"""Text endpoint: what Hawk (text mode) and the web demo talk to. Voice joins in M3.

POST /v1/calls                  {clinicId, callerPhone?, source?} → {callId, reply}
POST /v1/calls/{callId}/turns   {text}                            → {reply}
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Literal
from zoneinfo import ZoneInfo

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from . import contracts as c
from .config_cache import ConfigCache
from .conversation import Conversation, Reply
from .llm.sarvam import NLU_STATS, SarvamNLU, WithFallback
from .nlu import NLU, RuleBasedNLU
from .session_store import (
    InMemoryStore,
    LockTimeout,
    RedisStore,
    ResilientStore,
    SessionStore,
)
from .settings import Settings, load_dotenv
from .snapshot import IncompatibleSnapshot, restore, snapshot
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
    """This instance's warm objects for a call. The truth lives in the SessionStore."""

    conv: Conversation
    api: ApiClient
    clinic_id: str
    touched: float
    rev: int = 0


def make_redis(settings: Settings) -> Any | None:
    """A Redis client when REDIS_URL is set; None means single-process, in-memory."""
    if not settings.redis_url:
        return None
    from redis.asyncio import Redis

    return Redis.from_url(
        settings.redis_url, decode_responses=True, socket_timeout=2, socket_connect_timeout=2
    )


def make_store(redis: Any | None) -> SessionStore:
    """Shared Redis state (with a memory fallback if it goes down), else this process's memory."""
    if redis is None:
        return InMemoryStore()
    return ResilientStore(RedisStore(redis), InMemoryStore())


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
    store: SessionStore | None = None,
    config_cache: ConfigCache | None = None,
) -> FastAPI:
    sessions: dict[str, Session] = {}
    worker_id = f"agent-{uuid.uuid4().hex[:12]}"
    cfg = settings or Settings.from_env()
    redis = make_redis(cfg)
    sessions_store: SessionStore = store if store is not None else make_store(redis)
    configs = config_cache if config_cache is not None else ConfigCache(redis)

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        yield
        for s in sessions.values():
            await s.api.aclose()
        if redis is not None:
            await redis.aclose()

    app = FastAPI(title="Myna agent", lifespan=lifespan)

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
            config = await configs.get(api)
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

    async def keep(
        conv: Conversation, api: ApiClient, clinic_id: str, reply: Reply
    ) -> dict[str, object]:
        """Persist the call after a turn (or forget it if it ended)."""
        session = sessions.get(conv.call_id) or Session(conv, api, clinic_id, time.monotonic())
        sessions[conv.call_id] = session
        session.touched = time.monotonic()
        if reply.ended:
            await finish(conv.call_id)
        else:
            session.rev += 1
            await sessions_store.save(
                conv.call_id, snapshot(conv, clinic_id=clinic_id, rev=session.rev)
            )
        return {"callId": conv.call_id, "reply": ReplyOut.of(reply).model_dump(by_alias=True)}

    async def finish(call_id: str) -> None:
        session = sessions.pop(call_id, None)
        await sessions_store.delete(call_id)
        if session is not None:
            await session.api.aclose()

    async def revive(call_id: str, data: dict[str, object]) -> Session:
        """This instance hasn't seen the call (another one took the earlier turns): rebuild it."""
        clinic_id = str(data["clinicId"])
        api = ApiClient(cfg.api_base_url, cfg.agent_api_token, clinic_id)
        try:
            config = await configs.get(api)
        except ToolError as e:
            await api.aclose()
            raise HTTPException(502, e.message) from e
        clock = clock_for(config)
        phone = data.get("callerPhone")
        conv = Conversation(
            api=api,
            nlu=nlu_factory(config.name) if nlu_factory else make_nlu(cfg, config.name),
            config=config,
            call_id=call_id,
            caller_phone=str(phone) if phone else None,
            **({"now": clock} if clock else {}),
        )
        session = Session(conv, api, clinic_id, time.monotonic())
        sessions[call_id] = session
        return session

    @app.post("/v1/calls")
    async def start_call(body: StartCall) -> dict[str, object]:
        await sweep()
        conv, api, _ = await open_call(
            body.clinic_id, c.Direction.inbound, body.source, body.caller_phone
        )
        reply = await conv.start()
        return await keep(conv, api, body.clinic_id, reply)

    @app.post("/v1/outbound")
    async def start_outbound(body: StartOutbound) -> dict[str, object]:
        """Place a reminder call (text mode: the 'callee' answers via /turns)."""
        await sweep()

        async def pick(api: ApiClient) -> c.DueReminder | None:
            # Claim first: with several instances/workers, only one may ring a given patient.
            claimed = await api.claim_reminders(worker_id, body.appointment_id)
            return claimed[0] if claimed else None

        conv, api, reminder = await open_call(
            body.clinic_id, c.Direction.outbound, body.source, None, pick
        )
        assert reminder is not None
        reply = await conv.start_outbound(reminder)
        return await keep(conv, api, body.clinic_id, reply)

    @app.post("/v1/calls/{call_id}/hangup")
    async def hangup(call_id: str) -> dict[str, bool]:
        """The caller dropped (closed the tab, lost signal). Idempotent."""
        try:
            async with sessions_store.lock(call_id):
                data = await sessions_store.load(call_id)
                if data is None:
                    return {"ok": True}  # already finished
                session = sessions.get(call_id) or await revive(call_id, data)
                try:
                    restore(session.conv, data)
                    await session.conv.hang_up()
                except IncompatibleSnapshot:
                    pass
                await finish(call_id)
        except LockTimeout as e:
            raise HTTPException(409, "another turn of this call is still running") from e
        return {"ok": True}

    @app.post("/v1/calls/{call_id}/turns")
    async def turn(call_id: str, body: Turn) -> dict[str, object]:
        try:
            async with sessions_store.lock(call_id):
                data = await sessions_store.load(call_id)
                if data is None:
                    raise HTTPException(404, "unknown or finished call")
                session = sessions.get(call_id) or await revive(call_id, data)
                try:
                    restore(session.conv, data)  # another instance may have moved it on
                except IncompatibleSnapshot as e:
                    log.warning("discarding incompatible call state: %s", e)
                    await finish(call_id)
                    raise HTTPException(
                        410, "this call's state is from another version; please start again"
                    ) from e
                session.rev = int(data["rev"])
                reply = await session.conv.handle(body.text)
                out = await keep(session.conv, session.api, session.clinic_id, reply)
        except LockTimeout as e:
            raise HTTPException(409, "another turn of this call is still running") from e
        return {"reply": out["reply"]}

    if cfg.voice_enabled and cfg.sarvam_api_key:
        from .voice.pipeline import VoiceSettings
        from .voice.routes import register_voice_routes

        register_voice_routes(app, VoiceSettings(api_key=cfg.sarvam_api_key), cfg.voice_clinic)

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
