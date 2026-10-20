"""WebRTC signalling for the browser: POST/PATCH /api/offer (Pipecat's SmallWebRTC protocol)."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import BackgroundTasks, FastAPI
from pipecat.transports.smallwebrtc.connection import SmallWebRTCConnection
from pipecat.transports.smallwebrtc.request_handler import (
    SmallWebRTCPatchRequest,
    SmallWebRTCRequest,
    SmallWebRTCRequestHandler,
)

from .bot import run_bot
from .brain import Brain
from .pipeline import VoiceSettings

log = logging.getLogger("myna.voice")


def register_voice_routes(app: FastAPI, cfg: VoiceSettings, default_clinic: str) -> None:
    brain = Brain(app)
    handler = SmallWebRTCRequestHandler()

    @app.post("/api/offer")
    async def offer(request: SmallWebRTCRequest, background: BackgroundTasks) -> Any:
        data = request.request_data or {}
        clinic_id = str(data.get("clinicId", default_clinic))
        source = str(data.get("source", "manual_test"))

        async def on_connection(connection: SmallWebRTCConnection) -> None:
            background.add_task(run_bot, connection, brain, cfg, clinic_id, source)

        return await handler.handle_web_request(request, on_connection)

    @app.patch("/api/offer")
    async def ice_candidate(request: SmallWebRTCPatchRequest) -> dict[str, str]:
        await handler.handle_patch_request(request)
        return {"status": "success"}

    @app.get("/voice/health")
    async def voice_health() -> dict[str, object]:
        return {"ok": True, "sttModel": cfg.stt_model, "ttsModel": cfg.tts_model}
