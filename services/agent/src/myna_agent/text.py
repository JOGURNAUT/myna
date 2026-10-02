"""Text normalisation shared by the safety checks and the rule-based parsers."""

from __future__ import annotations

import re
import unicodedata

_DEVANAGARI = re.compile(r"[\u0900-\u097F]")
_PUNCT = re.compile(r"[^\w\s\u0900-\u097F:/.-]")


def normalize(text: str) -> str:
    """Lower-case, NFC, curly quotes → straight, punctuation → space, collapse whitespace."""
    t = unicodedata.normalize("NFC", text).lower()
    t = t.replace("’", "'").replace("‘", "'")
    t = t.replace("can't", "cannot").replace("cant ", "cannot ").replace("won't", "will not")
    t = re.sub(r"n't\b", " not", t)  # don't → do not, isn't → is not
    t = _PUNCT.sub(" ", t)
    return re.sub(r"\s+", " ", t).strip()


def has_devanagari(text: str) -> bool:
    return bool(_DEVANAGARI.search(text))


def contains_phrase(normalized: str, phrase: str) -> bool:
    """Whole-word match of `phrase` inside already-normalised text."""
    return (
        re.search(rf"(?<![\w\u0900-\u097F]){re.escape(phrase)}(?![\w\u0900-\u097F])", normalized)
        is not None
    )


def any_phrase(normalized: str, phrases: tuple[str, ...]) -> str | None:
    for p in phrases:
        if contains_phrase(normalized, p):
            return p
    return None
