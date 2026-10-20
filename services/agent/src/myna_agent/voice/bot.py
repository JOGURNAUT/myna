"""One browser call: WebRTC in, Pipecat pipeline, WebRTC out."""

from __future__ import annotations

import logging
from typing import Any

from pipecat.frames.frames import TTSSpeakFrame
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import WorkerRunner
from pipecat.pipeline.task import PipelineParams, PipelineWorker
from pipecat.processors.frameworks.rtvi import RTVIProcessor
from pipecat.transports.base_transport import TransportParams
from pipecat.transports.smallwebrtc.connection import SmallWebRTCConnection
from pipecat.transports.smallwebrtc.transport import SmallWebRTCTransport

from .brain import Brain
from .latency import Clock
from .pipeline import VoiceSettings, build_processors

log = logging.getLogger("myna.voice")


async def run_bot(
    connection: SmallWebRTCConnection,
    brain: Brain,
    cfg: VoiceSettings,
    clinic_id: str,
    source: str = "manual_test",
) -> None:
    started = await brain.start(clinic_id, source)
    call_id: str = started["callId"]
    greeting: dict[str, Any] = started["reply"]

    transport = SmallWebRTCTransport(
        webrtc_connection=connection,
        params=TransportParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            audio_in_sample_rate=cfg.sample_rate,
            audio_out_sample_rate=cfg.sample_rate,
        ),
    )
    rtvi = RTVIProcessor()
    clock = Clock(call_id)

    async def notify(message: dict[str, Any]) -> None:
        await rtvi.send_server_message(message)

    parts, _myna = build_processors(cfg, brain, call_id, clock, rtvi, greeting["language"], notify)
    worker = PipelineWorker(
        Pipeline([transport.input(), *parts, transport.output()]),
        params=PipelineParams(
            audio_in_sample_rate=cfg.sample_rate,
            audio_out_sample_rate=cfg.sample_rate,
            enable_metrics=True,
        ),
    )

    @rtvi.event_handler("on_client_ready")
    async def on_client_ready(processor: RTVIProcessor) -> None:
        await processor.set_bot_ready()
        # Myna speaks first: the AI disclosure has to open every call.
        await notify({"type": "greeting", "reply": greeting, "callId": call_id})
        await worker.queue_frame(TTSSpeakFrame(greeting["text"]))

    @transport.event_handler("on_client_disconnected")
    async def on_client_disconnected(_transport: SmallWebRTCTransport, _client: object) -> None:
        log.info("voice client disconnected (call %s)", call_id)
        await worker.cancel()

    try:
        await WorkerRunner(handle_sigint=False).run(worker)
    finally:
        await brain.hangup(call_id)  # no-op if the call already ended normally
