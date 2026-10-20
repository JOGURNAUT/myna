"""Parse spoken dates and times in English, Hinglish and Hindi (Devanagari).

Deterministic and tested, because dates are where voice agents fail (see Hawk). The LLM may
also extract dates, but code decides: if this parser understands the caller, it wins.

Mind changes ("Wednesday... nahi, Tuesday") are handled by taking the LAST mention.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, timedelta

from .numbers import words_to_digits
from .text import normalize

WEEKDAYS: dict[str, int] = {}
for idx, names in enumerate(
    [
        ("monday", "mon", "somvar", "somwar", "सोमवार", "मंडे", "मन्डे"),
        ("tuesday", "tue", "tues", "mangalvar", "mangalwar", "मंगलवार", "ट्यूसडे", "ट्यूज़डे", "ट्यूजडे"),
        ("wednesday", "wed", "budhvar", "budhwar", "बुधवार", "वेडनेसडे", "वेनेसडे"),
        (
            "thursday",
            "thu",
            "thurs",
            "guruvar",
            "guruwar",
            "veervar",
            "brihaspativar",
            "गुरुवार",
            "वीरवार",
            "थर्सडे",
            "थर्स्डे",
            "थरसडे",
        ),
        ("friday", "fri", "shukravar", "shukrawar", "शुक्रवार", "फ्राइडे", "फ्राईडे"),
        ("saturday", "sat", "shanivar", "shaniwar", "शनिवार", "सैटरडे", "सेटरडे", "सैटर्डे"),
        ("sunday", "sun", "ravivar", "raviwar", "itvaar", "इतवार", "रविवार", "संडे", "सनडे"),
    ]
):
    for n in names:
        WEEKDAYS[n] = idx

MONTHS: dict[str, int] = {}
for idx, names in enumerate(
    [
        ("january", "jan", "janvari", "जनवरी"),
        ("february", "feb", "farvari", "फरवरी", "फ़रवरी"),
        ("march", "mar", "मार्च"),
        ("april", "apr", "अप्रैल"),
        ("may", "mai", "मई"),
        ("june", "jun", "joon", "जून"),
        ("july", "jul", "julai", "जुलाई"),
        ("august", "aug", "agast", "अगस्त"),
        ("september", "sep", "sept", "sitambar", "सितंबर", "सितम्बर"),
        ("october", "oct", "aktubar", "aktoobar", "अक्टूबर"),
        ("november", "nov", "navambar", "नवंबर", "नवम्बर"),
        ("december", "dec", "disambar", "दिसंबर", "दिसम्बर"),
    ],
    start=1,
):
    for n in names:
        MONTHS[n] = idx

# Hindi ordinal day-of-month words ("pehli tareekh" = the 1st).
ORDINAL_DAYS: dict[str, int] = {
    "pehli": 1,
    "pahli": 1,
    "पहली": 1,
    "doosri": 2,
    "dusri": 2,
    "दूसरी": 2,
    "teesri": 3,
    "tisri": 3,
    "तीसरी": 3,
    "chauthi": 4,
    "chouthi": 4,
    "चौथी": 4,
    "paanchvi": 5,
    "panchvi": 5,
    "पांचवी": 5,
    "पाँचवीं": 5,
    "chhathi": 6,
    "छठी": 6,
    "saatvi": 7,
    "सातवीं": 7,
    "aathvi": 8,
    "आठवीं": 8,
    "nauvi": 9,
    "नौवीं": 9,
    "dasvi": 10,
    "दसवीं": 10,
}

HOUR_WORDS: dict[str, int] = {
    "ek": 1,
    "do": 2,
    "teen": 3,
    "char": 4,
    "chaar": 4,
    "paanch": 5,
    "panch": 5,
    "chhe": 6,
    "che": 6,
    "chhah": 6,
    "saat": 7,
    "aath": 8,
    "nau": 9,
    "das": 10,
    "gyarah": 11,
    "gyaarah": 11,
    "barah": 12,
    "baarah": 12,
    "एक": 1,
    "दो": 2,
    "तीन": 3,
    "चार": 4,
    "पांच": 5,
    "पाँच": 5,
    "छह": 6,
    "छः": 6,
    "सात": 7,
    "आठ": 8,
    "नौ": 9,
    "दस": 10,
    "ग्यारह": 11,
    "बारह": 12,
}

PART_OF_DAY_WORDS: dict[str, str] = {
    "morning": "morning",
    "subah": "morning",
    "subha": "morning",
    "सुबह": "morning",
    "afternoon": "afternoon",
    "dopahar": "afternoon",
    "dopehar": "afternoon",
    "दोपहर": "afternoon",
    "evening": "evening",
    "shaam": "evening",
    "sham": "evening",
    "शाम": "evening",
    "night": "evening",
    "raat": "evening",
    "रात": "evening",
}


@dataclass(frozen=True)
class DateRef:
    """A day, or a range of days the caller is open to ("next week")."""

    start: date
    end: date

    @property
    def is_single_day(self) -> bool:
        return self.start == self.end


@dataclass(frozen=True)
class TimeRef:
    hour: int | None  # 0-23 when known
    minute: int
    part_of_day: str | None  # morning | afternoon | evening

    def as_hhmm(self) -> str | None:
        return None if self.hour is None else f"{self.hour:02d}:{self.minute:02d}"


def _week_start(d: date) -> date:
    return d - timedelta(days=d.weekday())


def _next_weekday(today: date, wd: int) -> date:
    """The next `wd` strictly after today."""
    delta = (wd - today.weekday()) % 7
    return today + timedelta(days=delta or 7)


def _resolve_day_of_month(today: date, day: int, month: int | None) -> date | None:
    try:
        if month is None:
            candidate = date(today.year, today.month, day)
            if candidate < today:
                m = today.month % 12 + 1
                y = today.year + (1 if today.month == 12 else 0)
                candidate = date(y, m, day)
            return candidate
        candidate = date(today.year, month, day)
        return candidate if candidate >= today else date(today.year + 1, month, day)
    except ValueError:
        return None


_NUM = r"(\d{1,2})(?:st|nd|rd|th)?"
_MONTH_ALT = "|".join(sorted((re.escape(m) for m in MONTHS), key=len, reverse=True))
_WD_ALT = "|".join(sorted((re.escape(w) for w in WEEKDAYS), key=len, reverse=True))
_ORD_ALT = "|".join(sorted((re.escape(w) for w in ORDINAL_DAYS), key=len, reverse=True))
_B = r"(?<![\wऀ-ॿ])"  # word boundary that understands Devanagari
_E = r"(?![\wऀ-ॿ])"

_DATE_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(rf"{_B}(day after tomorrow|parso|parson|परसों){_E}"), "plus2"),
    (re.compile(rf"{_B}(today|aaj|आज){_E}"), "today"),
    (re.compile(rf"{_B}(tomorrow|kal|कल){_E}"), "tomorrow"),
    (
        re.compile(
            rf"{_B}(next|agle|agla|agli|अगले|अगला)\s+(?:week|hafte|hafta|हफ्ते|हफ़्ते)\s+(?:ka\s+|ke\s+|on\s+)?({_WD_ALT}){_E}"
        ),
        "next_week_wd",
    ),
    (re.compile(rf"{_B}(next|agle|agla|agli|अगले|अगला)\s+({_WD_ALT}){_E}"), "next_wd"),
    (re.compile(rf"{_B}(this|is|iss|इस)\s+({_WD_ALT}){_E}"), "this_wd"),
    (re.compile(rf"{_B}(next week|agle hafte|agla hafta|अगले हफ्ते|अगले हफ़्ते){_E}"), "next_week"),
    (re.compile(rf"{_B}(this week|is hafte|इस हफ्ते|इस हफ़्ते){_E}"), "this_week"),
    (re.compile(rf"{_B}{_NUM}\s*(?:of\s+)?({_MONTH_ALT}){_E}"), "day_month"),
    (re.compile(rf"{_B}({_MONTH_ALT})\s+{_NUM}{_E}"), "month_day"),
    (re.compile(rf"{_B}(\d{{1,2}})[/-](\d{{1,2}}){_E}(?![/-]\d)"), "dd_mm"),
    (re.compile(rf"{_B}({_ORD_ALT})\s+(?:tareekh|tarikh|tarik|date|तारीख){_E}"), "ordinal_day"),
    (
        re.compile(rf"{_B}(\d{{1,2}})(?:st|nd|rd|th)?\s+(?:tareekh|tarikh|tarik|तारीख){_E}"),
        "num_day",
    ),
    (re.compile(rf"{_B}({_WD_ALT}){_E}"), "wd"),
]


def parse_date(text: str, today: date) -> DateRef | None:
    """Last date mentioned in `text`, resolved against `today` (business-local)."""
    t = normalize(text)
    found: list[tuple[int, DateRef]] = []
    taken: list[tuple[int, int]] = []

    def overlaps(span: tuple[int, int]) -> bool:
        return any(span[0] < e and s < span[1] for s, e in taken)

    for pattern, kind in _DATE_PATTERNS:
        for m in pattern.finditer(t):
            if overlaps(m.span()):
                continue
            ref = _resolve(kind, m, today)
            if ref is not None:
                found.append((m.start(), ref))
                taken.append(m.span())
    if not found:
        return None
    return max(found, key=lambda x: x[0])[1]


def _resolve(kind: str, m: re.Match[str], today: date) -> DateRef | None:
    def one(d: date | None) -> DateRef | None:
        return None if d is None else DateRef(d, d)

    match kind:
        case "today":
            return one(today)
        case "tomorrow":
            return one(today + timedelta(days=1))
        case "plus2":
            return one(today + timedelta(days=2))
        case "wd":
            return one(_next_weekday(today, WEEKDAYS[m.group(1)]))
        case "this_wd":
            wd = WEEKDAYS[m.group(2)]
            d = _week_start(today) + timedelta(days=wd)
            return one(d if d > today else _next_weekday(today, wd))
        case "next_wd" | "next_week_wd":
            wd = WEEKDAYS[m.group(2)]
            return one(_week_start(today) + timedelta(days=7 + wd))
        case "next_week":
            start = _week_start(today) + timedelta(days=7)
            return DateRef(start, start + timedelta(days=6))
        case "this_week":
            return DateRef(today, _week_start(today) + timedelta(days=6))
        case "day_month":
            return one(_resolve_day_of_month(today, int(m.group(1)), MONTHS[m.group(2)]))
        case "month_day":
            return one(_resolve_day_of_month(today, int(m.group(2)), MONTHS[m.group(1)]))
        case "dd_mm":
            day, month = int(m.group(1)), int(m.group(2))
            return one(_resolve_day_of_month(today, day, month)) if 1 <= month <= 12 else None
        case "ordinal_day":
            return one(_resolve_day_of_month(today, ORDINAL_DAYS[m.group(1)], None))
        case "num_day":
            return one(_resolve_day_of_month(today, int(m.group(1)), None))
    return None


# ---------------------------------------------------------------- times

_HOUR_ALT = "|".join(sorted((re.escape(w) for w in HOUR_WORDS), key=len, reverse=True))
_HOUR = rf"(\d{{1,2}}|{_HOUR_ALT})"
_BAJE = r"(?:baje|bje|baj|o'?clock|बजे)"
_POD_ALT = "|".join(sorted((re.escape(w) for w in PART_OF_DAY_WORDS), key=len, reverse=True))

_TIME_PATTERNS: list[tuple[re.Pattern[str], str]] = [
    (re.compile(rf"{_B}(saade|sade|sadhe|साढ़े|साढे)\s+{_HOUR}{_E}"), "plus30"),
    (re.compile(rf"{_B}(sawa|sava|सवा)\s+{_HOUR}{_E}"), "plus15"),
    (re.compile(rf"{_B}(paune|pone|पौने)\s+{_HOUR}{_E}"), "minus15"),
    (re.compile(rf"{_B}(dhai|dhaai|ढाई){_E}"), "two_thirty"),
    (re.compile(rf"{_B}(dedh|डेढ़){_E}"), "one_thirty"),
    (re.compile(rf"{_B}(\d{{1,2}})[:.](\d{{2}})\s*(am|pm|a\.m\.|p\.m\.)?{_E}"), "hh_mm"),
    (re.compile(rf"{_B}(\d{{1,2}})\s*(am|pm|a\.m\.|p\.m\.){_E}"), "h_ampm"),
    (re.compile(rf"{_B}{_HOUR}\s*{_BAJE}"), "h_baje"),
    (
        re.compile(
            rf"{_B}(?:at|around|by)\s+(\d{{1,2}}){_E}(?!\s*(?:/|-|th|st|nd|rd|{_MONTH_ALT}))"
        ),
        "at_h",
    ),
]


def _hour_value(token: str) -> int | None:
    if token.isdigit():
        h = int(token)
        return h if 0 <= h <= 23 else None
    return HOUR_WORDS.get(token)


def _to_24h(hour: int, ampm: str | None, part_of_day: str | None) -> int:
    if hour >= 13:
        return hour
    if ampm:
        pm = ampm.startswith("p")
        return (hour % 12) + (12 if pm else 0)
    if part_of_day in ("afternoon", "evening"):
        return hour if hour == 12 else hour + 12
    if part_of_day == "morning":
        return 0 if hour == 12 else hour
    # Clinic heuristic: 1–7 means afternoon/evening, 8–11 morning, 12 noon.
    return hour + 12 if 1 <= hour <= 7 else hour


def parse_time(text: str) -> TimeRef | None:
    """Last time of day mentioned in `text` (an hour, or just a part of the day)."""
    t = normalize(text)
    pods = [
        (m.start(), PART_OF_DAY_WORDS[m.group(1)]) for m in re.finditer(rf"{_B}({_POD_ALT}){_E}", t)
    ]
    part_of_day = pods[-1][1] if pods else None

    hits: list[tuple[int, int, int, str | None]] = []  # (pos, hour, minute, ampm)
    taken: list[tuple[int, int]] = []
    for pattern, kind in _TIME_PATTERNS:
        for m in pattern.finditer(t):
            if any(m.start() < e and s < m.end() for s, e in taken):
                continue
            parsed = _time_hit(kind, m)
            if parsed is not None:
                hits.append((m.start(), *parsed))
                taken.append(m.span())

    if not hits:
        return TimeRef(None, 0, part_of_day) if part_of_day else None
    _, hour, minute, ampm = max(hits, key=lambda h: h[0])
    return TimeRef(_to_24h(hour, ampm, part_of_day), minute, part_of_day)


def _time_hit(kind: str, m: re.Match[str]) -> tuple[int, int, str | None] | None:
    match kind:
        case "plus30" | "plus15" | "minus15":
            h = _hour_value(m.group(2))
            if h is None:
                return None
            if kind == "plus30":
                return h, 30, None
            if kind == "plus15":
                return h, 15, None
            return (h - 1 if h > 1 else 12), 45, None
        case "two_thirty":
            return 2, 30, None
        case "one_thirty":
            return 1, 30, None
        case "hh_mm":
            h, mi = int(m.group(1)), int(m.group(2))
            return (h, mi, m.group(3)) if h <= 23 and mi <= 59 else None
        case "h_ampm":
            h = int(m.group(1))
            return (h, 0, m.group(2)) if 1 <= h <= 12 else None
        case "h_baje":
            h = _hour_value(m.group(1))
            return None if h is None else (h, 0, None)
        case "at_h":
            h = int(m.group(1))
            return (h, 0, None) if 1 <= h <= 12 else None
    return None


# ---------------------------------------------------------------- date of birth

_DOB_PATTERNS = [
    re.compile(r"(?<!\d)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)"),  # 1990-04-12
    re.compile(r"(?<!\d)(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?!\d)"),  # 12/04/1990
]
_DOB_WORDS = re.compile(rf"{_B}{_NUM}\s*(?:of\s+)?({_MONTH_ALT})\s*,?\s*(\d{{4}}){_E}")
_DOB_WORDS_US = re.compile(rf"{_B}({_MONTH_ALT})\s+{_NUM},?\s+(\d{{4}}){_E}")


def parse_dob(text: str) -> date | None:
    """A full date of birth with a four-digit year; None if any part is missing.
    Accepts number words ("twelve April nineteen ninety", "baarah April unnees sau nabbe")."""
    t = normalize(words_to_digits(text))
    try:
        if m := _DOB_PATTERNS[0].search(t):
            return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        if m := _DOB_PATTERNS[1].search(t):
            return date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
        if m := _DOB_WORDS.search(t):
            return date(int(m.group(3)), MONTHS[m.group(2)], int(m.group(1)))
        if m := _DOB_WORDS_US.search(t):
            return date(int(m.group(3)), MONTHS[m.group(1)], int(m.group(2)))
    except ValueError:
        return None
    return None
