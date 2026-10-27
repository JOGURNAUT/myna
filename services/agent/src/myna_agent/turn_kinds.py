"""Turns that carry no answer: "hmm", "one minute", "sorry, what?".

On a phone line these are everywhere (speech-to-text also turns breath and room noise into
"hmm"), and none of them is a failure to understand. They must not count towards the
two-strikes handoff. Matching is whole-utterance on purpose: "wait, Tuesday" is an answer.
"""

from __future__ import annotations

from typing import Literal

from .text import normalize

TurnKind = Literal["hold", "repeat", "noise"]

_NOISE_WORDS = {
    "hmm", "hm", "hmmm", "mm", "mmm", "uh", "uhh", "um", "umm", "er", "ah", "oh", "huh",
    "हम्म", "हम", "अं", "उम्म",
}  # fmt: skip
_GREETINGS = {"hello", "hi", "hey", "helo", "hallo", "namaste", "हेलो", "हैलो", "नमस्ते"}
_HOLD = {
    "ek minute", "ek minute ruko", "ek minute rukiye", "ek minute dijiye", "ek second", "ek min",
    "thoda ruko", "thoda ruk jao", "ruko", "ruk jao", "rukiye", "ruko zara", "zara ruko",
    "one minute", "just a minute", "just a moment", "one moment", "one second", "wait",
    "wait a minute", "wait a second", "hold on", "hold on a second", "give me a minute",
    "let me check", "let me see", "ek minute ek minute",
    "एक मिनट", "एक मिनट रुको", "एक मिनट रुकिए", "रुको", "रुकिए", "ठहरिए", "ज़रा रुकिए",
}  # fmt: skip
_REPEAT = {
    "what", "sorry", "sorry what", "pardon", "excuse me", "come again", "once more", "again",
    "repeat", "repeat that", "say that again", "say again", "can you repeat", "can you repeat that",
    "can you say that again", "please repeat", "i did not catch that", "i did not hear you",
    "i cannot hear you", "cannot hear you", "you are breaking up", "can you hear me",
    "bolo", "boliye", "haan bolo", "haan boliye", "ji boliye", "ji bolo", "go ahead",
    "kya", "kya kaha", "kya bola", "kya bola aapne", "kya kya", "dobara", "dobara bolo",
    "dobara bolna", "dobara boliye", "phir se", "phir se bolo", "phir se boliye", "kya dobara bolo",
    "awaaz nahi aa rahi", "aawaz nahi aa rahi", "sunai nahi de raha", "sunai nahi diya",
    "क्या", "क्या कहा", "क्या बोला", "दोबारा", "दोबारा बोलो", "दोबारा बोलिए", "फिर से बोलिए",
    "फिर से बोलो", "आवाज़ नहीं आ रही", "सुनाई नहीं दे रहा",
}  # fmt: skip


def classify_turn(text: str) -> TurnKind | None:
    """ "hold" (give me a moment), "repeat" (say that again), "noise" (nothing meaningful)."""
    words = normalize(text).split()
    kept = [w for w in words if w not in _NOISE_WORDS]
    if not words or not kept:
        return "noise"
    phrase = " ".join(kept)
    if all(w in _GREETINGS for w in kept):
        return "noise"
    if phrase in _HOLD:
        return "hold"
    if phrase in _REPEAT:
        return "repeat"
    return None
