"""Per-turn latency for the voice path: where each millisecond of the pause went."""

from __future__ import annotations

import json
import logging
import time
from dataclasses import asdict, dataclass, field

log = logging.getLogger("myna.voice")


@dataclass
class TurnTimings:
    """One caller turn. All values in milliseconds; None = not observed."""

    call_id: str
    turn: int
    #: End of the caller's speech (VAD) -> final transcript from Saaras.
    stt_ms: int | None = None
    #: Transcript -> Myna's reply text (language model + schedule tools).
    agent_ms: int | None = None
    #: Reply text handed to Bulbul -> first audio frame out.
    tts_first_audio_ms: int | None = None
    #: End of the caller's speech -> first audio of Myna's reply (what the caller feels).
    total_ms: int | None = None
    #: total_ms plus the silence the speech detector waits for before it decides the caller
    #: has finished: the pause the caller actually feels.
    felt_ms: int | None = None
    language: str | None = None
    tts_chars: int = 0
    audio_seconds_in: float = 0.0
    extra: dict[str, object] = field(default_factory=dict)

    def as_json(self) -> dict[str, object]:
        return asdict(self)


@dataclass
class Clock:
    """Marks moments within one turn and turns them into `TurnTimings`."""

    call_id: str
    #: Silence (ms) the voice-activity detector waits before declaring end of speech.
    endpoint_ms: int = 0
    turn: int = 0
    speech_end: float | None = None
    transcript_at: float | None = None
    reply_at: float | None = None
    spoke_at: float | None = None
    timings: TurnTimings | None = None
    history: list[TurnTimings] = field(default_factory=list)

    @staticmethod
    def now() -> float:
        return time.perf_counter()

    def caller_stopped(self) -> None:
        self.speech_end = self.now()

    def got_transcript(self) -> None:
        self.turn += 1
        self.transcript_at = self.now()
        self.reply_at = self.spoke_at = None
        self.timings = TurnTimings(self.call_id, self.turn)
        if self.speech_end is not None:
            self.timings.stt_ms = _ms(self.speech_end, self.transcript_at)

    def got_reply(self, language: str, chars: int) -> None:
        self.reply_at = self.now()
        if self.timings and self.transcript_at is not None:
            self.timings.agent_ms = _ms(self.transcript_at, self.reply_at)
            self.timings.language = language
            self.timings.tts_chars = chars

    def first_audio(self) -> TurnTimings | None:
        """Call on every outgoing audio frame; completes the turn on the first one."""
        t = self.timings
        if t is None or self.spoke_at is not None or self.reply_at is None:
            return None
        self.spoke_at = self.now()
        t.tts_first_audio_ms = _ms(self.reply_at, self.spoke_at)
        if self.speech_end is not None:
            t.total_ms = _ms(self.speech_end, self.spoke_at)
            t.felt_ms = t.total_ms + self.endpoint_ms
        self.history.append(t)
        log.info(json.dumps({"event": "voice_turn", **t.as_json()}, ensure_ascii=False))
        return t


def _ms(a: float, b: float) -> int:
    return max(0, round((b - a) * 1000))
