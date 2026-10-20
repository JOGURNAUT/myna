"""The voice pipeline against the REAL Sarvam services (skipped without SARVAM_API_KEY).

No browser needed: Bulbul speaks a caller's sentence, those bytes go in as microphone audio, and
the real pipeline (VAD -> Saaras -> Myna -> Bulbul) has to answer out loud.
"""

from __future__ import annotations

import asyncio
import base64
import os
import re
from pathlib import Path

import httpx
import pytest
from conftest import NOW_LOCAL, ApiServer

from myna_agent.nlu import RuleBasedNLU
from myna_agent.server import create_app
from myna_agent.settings import REPO_ROOT, Settings

pytestmark = pytest.mark.api


def _key() -> str | None:
    if os.environ.get("SARVAM_API_KEY"):
        return os.environ["SARVAM_API_KEY"]
    env = Path(REPO_ROOT) / ".env"
    if env.exists():
        m = re.search(r"^SARVAM_API_KEY=(.+)$", env.read_text(encoding="utf-8"), re.M)
        if m:
            return m.group(1).strip().strip("'\"")
    return None


KEY = _key()
needs_key = pytest.mark.skipif(not KEY, reason="SARVAM_API_KEY not set")
SAMPLE_RATE = 16000


async def speak(text: str, language: str = "en-IN") -> bytes:
    """A caller's sentence as 16 kHz 16-bit mono PCM (Bulbul, WAV header stripped)."""
    async with httpx.AsyncClient(timeout=60) as http:
        res = await http.post(
            "https://api.sarvam.ai/text-to-speech",
            headers={"api-subscription-key": KEY or ""},
            json={
                "text": text,
                "language_code": language,
                "model": "bulbul:v3",
                "speaker": "rahul",
                "speech_sample_rate": SAMPLE_RATE,
                "output_audio_codec": "wav",
            },
        )
    res.raise_for_status()
    return base64.b64decode(res.json()["audios"][0])[44:]


@needs_key
async def test_a_spoken_question_gets_a_spoken_answer(api_server: ApiServer) -> None:
    from pipecat.frames.frames import InputAudioRawFrame, TTSAudioRawFrame
    from pipecat.pipeline.pipeline import Pipeline
    from pipecat.pipeline.runner import WorkerRunner
    from pipecat.pipeline.task import PipelineParams, PipelineWorker
    from pipecat.processors.frame_processor import FrameDirection, FrameProcessor

    from myna_agent.voice.brain import Brain
    from myna_agent.voice.latency import Clock
    from myna_agent.voice.pipeline import VoiceSettings, build_processors

    settings = Settings(
        api_base_url=api_server.base_url,
        agent_api_token=api_server.token,
        llm_provider="rules",
        sarvam_api_key=KEY,
        sarvam_model="sarvam-105b-conversations",
        port=0,
    )
    app = create_app(settings, nlu_factory=lambda _n: RuleBasedNLU(), now=lambda: NOW_LOCAL)
    brain = Brain(app)
    started = await brain.start("smile-dental", "hawk")
    call_id = started["callId"]

    audio_out = bytearray()
    events: list[dict] = []

    class Sink(FrameProcessor):
        async def process_frame(self, frame, direction: FrameDirection) -> None:  # type: ignore[no-untyped-def]
            await super().process_frame(frame, direction)
            if isinstance(frame, TTSAudioRawFrame):
                audio_out.extend(frame.audio)
            await self.push_frame(frame, direction)

    async def notify(message: dict) -> None:
        events.append(message)

    clock = Clock(call_id)
    parts, _ = build_processors(
        VoiceSettings(api_key=KEY or ""), brain, call_id, clock, None, "hinglish", notify
    )
    task = PipelineWorker(
        Pipeline([*parts, Sink()]),
        params=PipelineParams(audio_in_sample_rate=SAMPLE_RATE, audio_out_sample_rate=SAMPLE_RATE),
    )

    pcm = await speak("What are your clinic timings?")
    silence = bytes(SAMPLE_RATE * 2 * 2)  # 2 s of silence so the VAD sees the sentence end

    async def microphone() -> None:
        await asyncio.sleep(1.5)  # let the Sarvam sockets connect
        chunk = SAMPLE_RATE * 2 // 50  # 20 ms
        for data in (pcm, silence):
            for i in range(0, len(data), chunk):
                await task.queue_frame(
                    InputAudioRawFrame(
                        audio=data[i : i + chunk], sample_rate=SAMPLE_RATE, num_channels=1
                    )
                )
                await asyncio.sleep(0.01)
        # wait for Myna to answer out loud
        for _ in range(300):
            if any(e["type"] == "latency" for e in events):
                break
            await asyncio.sleep(0.1)
        await asyncio.sleep(1.0)
        await task.cancel()

    await asyncio.wait_for(
        asyncio.gather(WorkerRunner(handle_sigint=False).run(task), microphone()), timeout=90
    )
    await brain.aclose()

    turns = [e for e in events if e["type"] == "turn"]
    assert turns, f"no turn taken; events={events}"
    assert "timing" in turns[0]["caller"].lower()  # Saaras heard the question
    assert "Monday to Friday" in turns[0]["reply"]["text"]  # Myna answered from the clinic config
    assert len(audio_out) > SAMPLE_RATE  # more than a second of spoken reply
    latency = next(e for e in events if e["type"] == "latency")
    print(
        "voice latency (ms):",
        {k: latency[k] for k in ("stt_ms", "agent_ms", "tts_first_audio_ms", "total_ms")},
    )
    assert latency["total_ms"] is not None and latency["total_ms"] < 8000
