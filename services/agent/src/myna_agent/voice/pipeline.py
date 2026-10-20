"""The voice pipeline, built from Pipecat parts and Myna's own turn logic.

    audio in -> VAD -> Saaras STT -> UserTurnProcessor -> MynaTurn -> Bulbul TTS -> tap -> audio out

What is Pipecat's: transport, voice-activity detection, the Sarvam STT/TTS services and barge-in.
What is Myna's: `MynaTurn`, which takes each final transcript to the agent (the same logic Hawk and
the web chat drive), and speaks the fixed reply. No language model writes the speech.

Versions in use: pipecat-ai 1.13 (see docs/decisions.md). `build_processors` returns the middle of
the pipeline so a test can drive it with recorded audio instead of a browser.
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.frames.frames import (
    EndTaskFrame,
    Frame,
    InputAudioRawFrame,
    TranscriptionFrame,
    TTSAudioRawFrame,
    TTSSpeakFrame,
    TTSUpdateSettingsFrame,
    VADUserStoppedSpeakingFrame,
)
from pipecat.processors.audio.vad_processor import VADProcessor
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.processors.frameworks.rtvi import RTVIProcessor
from pipecat.services.sarvam.stt import SarvamRealtimeSTTService
from pipecat.services.sarvam.tts import SarvamTTSService
from pipecat.transcriptions.language import Language
from pipecat.turns.user_turn_processor import UserTurnProcessor
from pipecat.turns.user_turn_strategies import ExternalUserTurnStrategies

from .brain import Brain
from .latency import Clock, TurnTimings

log = logging.getLogger("myna.voice")

#: Myna's reply language -> the language Bulbul pronounces it in. Hinglish is Hindi words in
#: Roman script, which Bulbul reads correctly as hi-IN.
TTS_LANGUAGE: dict[str, Language] = {
    "en": Language.EN_IN,
    "hi": Language.HI_IN,
    "hinglish": Language.HI_IN,
}

#: How long Saaras waits in silence before it decides the caller has finished a sentence.
SILENCE_MS = 450


@dataclass(frozen=True)
class VoiceSettings:
    api_key: str
    stt_model: str = "saaras:v4"
    #: "transcribe" keeps scripts as spoken; Hinglish comes back in Devanagari (Myna reads both).
    stt_mode: str = "transcribe"
    tts_model: str = "bulbul:v3"
    tts_voice: str = "priya"
    sample_rate: int = 16000


class MynaTurn(FrameProcessor):
    """One final transcript = one caller turn: ask the agent, speak what it says."""

    def __init__(
        self,
        brain: Brain,
        call_id: str,
        clock: Clock,
        notify: Callable[[dict[str, Any]], Awaitable[None]],
        first_language: str = "hinglish",
    ) -> None:
        super().__init__(name="MynaTurn")
        self._brain = brain
        self._call_id = call_id
        self._clock = clock
        self._notify = notify
        self._tts_language = TTS_LANGUAGE[first_language]

    async def process_frame(self, frame: Frame, direction: FrameDirection) -> None:
        await super().process_frame(frame, direction)
        if isinstance(frame, VADUserStoppedSpeakingFrame):
            self._clock.caller_stopped()
        if isinstance(frame, TranscriptionFrame):
            if frame.text.strip():
                await self._take_turn(frame.text.strip())
            return  # the transcript is consumed here; only Myna's reply goes on to the speaker
        await self.push_frame(frame, direction)

    async def _take_turn(self, text: str) -> None:
        self._clock.got_transcript()
        try:
            reply = await self._brain.turn(self._call_id, text)
        except Exception:
            log.exception("agent turn failed on a voice call")
            await self._notify(
                {"type": "error", "message": "Myna had a problem; staff will call you back."}
            )
            await self.push_frame(EndTaskFrame(), FrameDirection.UPSTREAM)
            return
        self._clock.got_reply(reply["language"], len(reply["text"]))
        await self._notify({"type": "turn", "caller": text, "reply": reply})
        await self.speak(reply)

    async def speak(self, reply: dict[str, Any]) -> None:
        language = TTS_LANGUAGE.get(reply["language"], Language.EN_IN)
        if language != self._tts_language:  # the caller switched language mid-call
            self._tts_language = language
            await self.push_frame(
                TTSUpdateSettingsFrame(delta=SarvamTTSService.Settings(language=language))
            )
        await self.push_frame(TTSSpeakFrame(reply["text"]))
        if reply["ended"]:
            # Upstream end-of-task: queued behind the speech, so Myna finishes her sentence.
            await self.push_frame(EndTaskFrame(), FrameDirection.UPSTREAM)


class FirstAudioTap(FrameProcessor):
    """Sits after TTS: the first audio frame of a reply ends the turn's stopwatch."""

    def __init__(self, clock: Clock, notify: Callable[[dict[str, Any]], Awaitable[None]]) -> None:
        super().__init__(name="FirstAudioTap")
        self._clock = clock
        self._notify = notify

    async def process_frame(self, frame: Frame, direction: FrameDirection) -> None:
        await super().process_frame(frame, direction)
        if isinstance(frame, TTSAudioRawFrame):
            done: TurnTimings | None = self._clock.first_audio()
            if done:
                await self._notify({"type": "latency", **done.as_json()})
        await self.push_frame(frame, direction)


class CallerAudioMeter(FrameProcessor):
    """Counts seconds of caller audio (for the cost line), then passes everything on."""

    def __init__(self, clock: Clock) -> None:
        super().__init__(name="CallerAudioMeter")
        self._clock = clock
        self.seconds = 0.0

    async def process_frame(self, frame: Frame, direction: FrameDirection) -> None:
        await super().process_frame(frame, direction)
        if isinstance(frame, InputAudioRawFrame):
            self.seconds += frame.num_frames / max(1, frame.sample_rate)
        await self.push_frame(frame, direction)


def build_processors(
    cfg: VoiceSettings,
    brain: Brain,
    call_id: str,
    clock: Clock,
    rtvi: RTVIProcessor | None,
    first_language: str,
    notify: Callable[[dict[str, Any]], Awaitable[None]],
) -> tuple[list[FrameProcessor], MynaTurn]:
    """Everything between "audio in" and "audio out", in order."""
    clock.endpoint_ms = SILENCE_MS
    vad = VADProcessor(
        vad_analyzer=SileroVADAnalyzer(params=VADParams(stop_secs=SILENCE_MS / 1000)),
    )
    stt = SarvamRealtimeSTTService(
        api_key=cfg.api_key,
        sample_rate=cfg.sample_rate,
        settings=SarvamRealtimeSTTService.Settings(
            model=cfg.stt_model,
            language=None,  # Saaras detects the language of each utterance
            mode=cfg.stt_mode,
            stream_type="fast",
        ),
    )
    # Barge-in: Saaras signals when the caller starts talking; this processor turns that into
    # the interruption that cuts Myna off mid-sentence.
    turns = UserTurnProcessor(
        user_turn_strategies=ExternalUserTurnStrategies(enable_interruptions=True),
    )
    myna = MynaTurn(brain, call_id, clock, notify, first_language)
    tts = SarvamTTSService(
        api_key=cfg.api_key,
        sample_rate=cfg.sample_rate,
        settings=SarvamTTSService.Settings(
            model=cfg.tts_model,
            voice=cfg.tts_voice,
            language=TTS_LANGUAGE[first_language],
            min_buffer_size=30,  # the API rejects < 30, though the guide says 15-25
        ),
    )
    parts: list[FrameProcessor] = [vad]
    if rtvi is not None:
        parts.append(rtvi)
    parts += [stt, turns, myna, tts, FirstAudioTap(clock, notify)]
    return parts, myna
