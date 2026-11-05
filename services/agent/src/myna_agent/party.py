"""How many guests? "table for 4", "4 log", "do log", "we are six", or a bare "4" when asked.

Restaurants only. Code does this, not the model: the number picks the table size, and a number
that fits no table (a big group) is a handoff rather than an invented booking.
"""

from __future__ import annotations

import re

from .numbers import words_to_digits
from .text import normalize

_UNIT = r"(?:people|persons?|guests?|pax|log|logon|lok|jan|diners?|adults?|members?|लोग|लोगों|जन)"
# A number that is really a time ("table for 8 pm", "8 baje") must not become a party size.
_MONTHS = "january|february|march|april|may|june|july|august|september|october|november|december"
_NOT_TIME = rf"(?!\s*(?:am|pm|a m|p m|baje|bje|बजे|o clock|oclock|tarikh|तारीख|{_MONTHS}))"

_EXPLICIT = [
    re.compile(rf"(?<!\d)(\d{{1,2}})\s*{_UNIT}\b"),
    re.compile(rf"\b(?:for|party of|group of|table for|of)\s+(\d{{1,2}}){_NOT_TIME}(?!\d)"),
    re.compile(r"\b(?:we are|we re|hum|hum log|हम)\s+(\d{1,2})\b"),
    re.compile(r"(?<!\d)(\d{1,2})\s+(?:of us|ke liye|ka table|ki table)"),
]


def parse_party_size(text: str, *, bare: bool = False) -> int | None:
    """The number of guests, or None. `bare` accepts a lone number: Myna just asked "how many?"."""
    t = normalize(words_to_digits(text))
    for pattern in _EXPLICIT:
        if m := pattern.search(t):
            return int(m.group(1))
    if bare and (m := re.fullmatch(r"(?:\w+\s+)?(\d{1,2})(?:\s+(?:please|na|hai|hain|ji))?", t)):
        return int(m.group(1))
    return None
