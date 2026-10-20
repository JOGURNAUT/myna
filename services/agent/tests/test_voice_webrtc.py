"""The browser path end to end, with a headless WebRTC client (aiortc) standing in for the browser.

It connects to the agent's real /api/offer, "speaks" a recorded sentence through its microphone
track, and checks that Myna's voice comes back over the audio track. Needs SARVAM_API_KEY (real
speech services); skipped without it. Everything else (WebRTC, VAD, barge-in plumbing) is real.
"""

from __future__ import annotations

import asyncio
import socket
import wave
from pathlib import Path

import httpx
import numpy as np
import pytest
import uvicorn
from conftest import NOW_LOCAL, ApiServer
from test_voice_live import KEY, SAMPLE_RATE, needs_key, speak

from myna_agent.nlu import RuleBasedNLU
from myna_agent.server import create_app
from myna_agent.settings import Settings
from myna_agent.voice.brain import Brain

pytestmark = pytest.mark.api


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


@needs_key
async def test_a_browser_like_client_can_talk_to_myna(
    api_server: ApiServer, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from aiortc import RTCPeerConnection, RTCSessionDescription
    from aiortc.contrib.media import MediaPlayer

    heard: list[tuple[str, str]] = []
    original = Brain.turn

    async def recording_turn(self: Brain, call_id: str, text: str) -> dict:
        reply = await original(self, call_id, text)
        heard.append((text, reply["text"]))
        return reply

    monkeypatch.setattr(Brain, "turn", recording_turn)

    settings = Settings(
        api_base_url=api_server.base_url,
        agent_api_token=api_server.token,
        llm_provider="rules",
        sarvam_api_key=KEY,
        sarvam_model="sarvam-105b-conversations",
        port=0,
        voice_enabled=True,
    )
    app = create_app(settings, nlu_factory=lambda _n: RuleBasedNLU(), now=lambda: NOW_LOCAL)
    port = free_port()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
    serving = asyncio.create_task(server.serve())
    for _ in range(100):
        if server.started:
            break
        await asyncio.sleep(0.05)

    # The caller's microphone: a 3 s lead-in (the speech sockets connect), one sentence, then
    # silence so the speech detector can end it.
    pcm = await speak("What are your clinic timings?")
    wav_path = tmp_path / "mic.wav"
    with wave.open(str(wav_path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SAMPLE_RATE)
        w.writeframes(bytes(SAMPLE_RATE * 2 * 3) + pcm + bytes(SAMPLE_RATE * 2 * 6))

    pc = RTCPeerConnection()
    player = MediaPlayer(str(wav_path))
    pc.addTrack(player.audio)
    loud_frames = 0
    got_track = asyncio.Event()
    drains: list[asyncio.Task[None]] = []

    @pc.on("track")
    def on_track(track) -> None:  # type: ignore[no-untyped-def]
        got_track.set()

        async def drain() -> None:
            nonlocal loud_frames
            try:
                while True:
                    frame = await track.recv()
                    samples = frame.to_ndarray().astype(np.float32)
                    if float(np.sqrt(np.mean(samples**2))) > 800:  # clearly speech, not silence
                        loud_frames += 1
            except Exception:
                return

        drains.append(asyncio.create_task(drain()))

    pc.createDataChannel("rtvi")  # the bot side expects a data channel to exist
    await pc.setLocalDescription(await pc.createOffer())
    try:
        async with httpx.AsyncClient(timeout=30) as http:
            res = await http.post(
                f"http://127.0.0.1:{port}/api/offer",
                json={
                    "sdp": pc.localDescription.sdp,
                    "type": pc.localDescription.type,
                    "request_data": {"clinicId": "smile-dental", "source": "hawk"},
                },
            )
        assert res.status_code == 200, res.text
        answer = res.json()
        await pc.setRemoteDescription(RTCSessionDescription(sdp=answer["sdp"], type=answer["type"]))

        for _ in range(400):  # up to 40 s: connect, listen, think, speak
            if heard and loud_frames > 25:
                break
            await asyncio.sleep(0.1)
    finally:
        await pc.close()
        server.should_exit = True
        await serving

    assert heard, "Myna never heard a turn over WebRTC"
    caller_text, reply_text = heard[0]
    assert "timing" in caller_text.lower()
    assert "Monday to Friday" in reply_text
    assert loud_frames > 25, "no spoken reply came back over the audio track"
