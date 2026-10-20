"""What the caller meant: the ONLY output an LLM produces in Myna.

An NLU provider turns one caller utterance into an `Understanding`. Code then decides what
happens. Providers: `RuleBasedNLU` (deterministic, offline, used in tests and as a fallback),
`ScriptedNLU` (tests), `SarvamNLU` (llm/sarvam.py).
"""

from __future__ import annotations

import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import date
from enum import StrEnum
from typing import Literal, Protocol

from pydantic import BaseModel, Field

from .dates import parse_date, parse_dob, parse_time
from .text import any_phrase, has_devanagari, normalize

Lang = Literal["en", "hi", "hinglish"]


class Intent(StrEnum):
    book = "book"
    reschedule = "reschedule"
    cancel = "cancel"
    faq = "faq"
    other_request = "other_request"  # reports, refills, bills… → a message for staff (flow b)
    talk_to_human = "talk_to_human"
    emergency = "emergency"
    medical_question = "medical_question"
    yes = "yes"
    no = "no"
    provide_info = "provide_info"
    goodbye = "goodbye"
    wrong_number = "wrong_number"  # reminder calls (flow c)
    opt_out = "opt_out"  # "don't call me again"
    unclear = "unclear"


TaskCategory = Literal[
    "report_status",
    "medicine_refill_request",
    "billing_question",
    "doctor_callback",
    "directions_timings",
    "other",
]


class Understanding(BaseModel):
    intent: Intent
    language: Lang
    confidence: float = Field(ge=0, le=1)
    frustrated: bool = False
    third_party: bool = Field(False, description="caller is calling on behalf of someone else")
    name: str | None = Field(None, description="patient's full name if said")
    dob: date | None = Field(
        None, description="patient's date of birth, only if a full date was said"
    )
    phone: str | None = Field(None, description="a phone number if said, digits only")
    service_id: str | None = Field(None, description="one of the clinic's service ids")
    resource_id: str | None = Field(None, description="one of the clinic's doctor ids")
    date_text: str | None = Field(None, description="the caller's exact words for the day")
    time_text: str | None = Field(None, description="the caller's exact words for the time")
    option_number: int | None = Field(
        None, ge=1, le=10, description="which offered option, 1-based"
    )
    faq_id: str | None = Field(None, description="one of the clinic's FAQ ids")
    task_category: TaskCategory | None = Field(
        None, description="for other_request: what kind of message this is for staff"
    )
    secondary_category: TaskCategory | None = Field(
        None,
        description="if the caller ALSO asked something for staff besides booking/rescheduling/cancelling",
    )
    family_member: bool = Field(
        False, description="on a reminder call: the person who answered is not the patient"
    )
    summary: str | None = Field(
        None, max_length=200, description="one line for clinic staff, in English"
    )


Expecting = Literal[
    "intent",
    "name",
    "dob",
    "phone",
    "service",
    "when",
    "choice",
    "appointment",
    "confirm",
    "anything_else",
    # flow (b)
    "message",
    "callback_confirm",
    # flow (c)
    "identity_who",
    "attendance",
]


@dataclass(frozen=True)
class ClinicFacts:
    """The slice of clinic config the NLU needs to map words to ids."""

    services: dict[str, list[str]]  # id → names/synonyms (lower-case)
    resources: dict[str, list[str]]  # id → names (lower-case)
    faqs: dict[str, str]  # id → question


@dataclass(frozen=True)
class TurnContext:
    expecting: Expecting
    today: date
    facts: ClinicFacts
    language: Lang
    options_offered: int = 0
    history: Sequence[tuple[str, str]] = field(default_factory=tuple)  # (speaker, text)


class NLU(Protocol):
    async def understand(self, text: str, ctx: TurnContext) -> Understanding: ...


# ---------------------------------------------------------------- rule-based

SERVICE_SYNONYMS: dict[str, tuple[str, ...]] = {
    "cleaning": ("cleaning", "clean", "scaling", "safai", "saaf", "सफ़ाई", "सफाई"),
    "consultation": (
        "consultation",
        "consult",
        "checkup",
        "check up",
        "check-up",
        "dikhana",
        "dikhaana",
        "jaanch",
        "परामर्श",
        "चेकअप",
    ),
    "filling": ("filling", "fill", "cavity", "फिलिंग"),
    "root-canal": ("root canal", "rct", "रूट कैनाल"),
    "braces-review": ("braces", "brace", "ब्रेसेस"),
}

_YES = (
    "yes",
    "yeah",
    "yep",
    "yup",
    "sure",
    "ok",
    "okay",
    "correct",
    "confirm",
    "right",
    "haan",
    "han",
    "ha",
    "haanji",
    "haan ji",
    "ji haan",
    "ji",
    "theek hai",
    "thik hai",
    "sahi",
    "sahi hai",
    "bilkul",
    "kar do",
    "kar dijiye",
    "chalega",
    "हाँ",
    "हां",
    "जी",
    "ठीक है",
    "सही",
    "बिल्कुल",
    "कर दो",
    "कर दीजिए",
)
_NO = ("no", "nope", "not", "nahi", "nahin", "mat", "galat", "wrong", "नहीं", "गलत")
# "na" is usually a softener ("kar do na" = "please do it"); it means "no" only on its own.
_BARE_NO = ("na", "naa", "ना")
_BOOK = (
    "book",
    "booking",
    "appointment",
    "new appointment",
    "schedule",
    "milna hai",
    "dikhana hai",
    "dikhaana hai",
    "appointment chahiye",
    "time chahiye",
    "बुक",
    "अपॉइंटमेंट",
)
_RESCHEDULE = (
    "reschedule",
    "change",
    "move",
    "postpone",
    "prepone",
    "shift",
    "badal",
    "badalna",
    "badalni",
    "aage kar",
    "peeche kar",
    "बदल",
    "बदलना",
)
_CANCEL = (
    "cancel",
    "radd",
    "nahi aa paunga",
    "nahi aa paungi",
    "nahi aa sakta",
    "nahi aa sakti",
    "कैंसल",
    "रद्द",
)
_FAQ: dict[str, tuple[str, ...]] = {
    "timings": (
        "timing",
        "timings",
        "time kya",
        "kab khulta",
        "kab tak",
        "open",
        "opening hours",
        "hours",
        "kab band",
        "समय",
        "कब खुलता",
    ),
    "address": ("address", "where is", "location", "kahan hai", "kaha hai", "पता", "कहाँ"),
    "fees": (
        "fee",
        "fees",
        "charges",
        "cost",
        "price",
        "how much",
        "kitna lagega",
        "kitne paise",
        "kitni hai",
        "फीस",
        "कितना लगेगा",
    ),
    "insurance": ("insurance", "cashless", "mediclaim", "बीमा", "इंश्योरेंस"),
}
# Flow (b): what a message for staff is about. Order matters: first match wins.
_CATEGORIES: dict[TaskCategory, tuple[str, ...]] = {
    "medicine_refill_request": (
        "refill",
        "prescription",
        "repeat my medicine",
        "dawai khatam",
        "dawa khatam",
        "goli khatam",
        "medicine khatam",
        "dawai chahiye",
        "parchi",
        "दवा खत्म",
        "दवाई खत्म",
        "पर्ची",
    ),
    "report_status": (
        "report",
        "reports",
        "x-ray report",
        "xray",
        "x-ray",
        "opg",
        "result",
        "results",
        "रिपोर्ट",
    ),
    "billing_question": (
        "bill",
        "billing",
        "invoice",
        "payment",
        "refund",
        "receipt",
        "charged",
        "paise",
        "बिल",
        "पेमेंट",
    ),
    "doctor_callback": (
        "doctor se baat",
        "talk to the doctor",
        "speak to the doctor",
        "doctor to call",
        "doctor call me",
        "doctor ko bolo",
        "doctor se poochna",
        "ask the doctor",
        "call me back",
        "callback",
        "call back",
        "to call me",
        "mujhe call kare",
        "डॉक्टर से बात",
        "मुझे कॉल करें",
        "मुझे कॉल करे",
        "कॉल करें",
        "से कहिए",
    ),
    # A message with no topic yet: Myna asks what to pass on.
    "other": (
        "leave a message",
        "take a message",
        "a message for",
        "message dena",
        "message chhodna",
        "message chodna",
        "sandesh",
        "संदेश",
    ),
}
_WRONG_NUMBER = (
    "wrong number",
    "no one by that name",
    "nobody by that name",
    "galat number",
    "koi nahi hai is naam",
    "is naam ka koi nahi",
    "गलत नंबर",
)
_OPT_OUT = (
    "do not call",
    "stop calling",
    "never call",
    "no more calls",
    "remove my number",
    "call mat karo",
    "mat call karo",
    "phone mat karo",
    "dobara call mat",
    "मत कॉल",
    "कॉल मत करो",
)
# On a reminder call: the person who answered is not the patient.
_FAMILY = (
    "his wife",
    "her husband",
    "his mother",
    "her mother",
    "his father",
    "her father",
    "his son",
    "her son",
    "his daughter",
    "her daughter",
    "not here",
    "not at home",
    "not available",
    "is out",
    "he is out",
    "she is out",
    "main unki",
    "main unka",
    "unki beti",
    "unka beta",
    "unki wife",
    "ghar pe nahi",
    "ghar par nahi",
    "bahar gaye",
    "bahar gayi",
    "abhi nahi hain",
    "वो घर पर नहीं",
    "मैं उनकी",
    "मैं उनका",
)


def mentions_booking(text: str) -> bool:
    """Did the caller use a booking word ("book", "appointment", "milna hai")? Code checks this
    itself, so a model that collapses "book X and ask Y" into one label can't drop the booking."""
    return any_phrase(normalize(text), _BOOK) is not None


def _category(t: str) -> TaskCategory | None:
    for category, words in _CATEGORIES.items():
        if any_phrase(t, words):
            return category
    return None


_GOODBYE = (
    "bye",
    "goodbye",
    "that's all",
    "thats all",
    "nothing else",
    "no thanks",
    "bas",
    "bas itna",
    "that is all",
    "kuch nahi",
    "aur kuch nahi",
    "बस",
    "धन्यवाद",
    "शुक्रिया",
)
_THIRD_PARTY = (
    "my mother",
    "my father",
    "my mom",
    "my dad",
    "my son",
    "my daughter",
    "my wife",
    "my husband",
    "my child",
    "my grandmother",
    "my grandfather",
    "for my",
    "mummy",
    "papa",
    "maa",
    "beti",
    "beta",
    "patni",
    "pati",
    "dadi",
    "nani",
    "ke liye",
    "मम्मी",
    "पापा",
    "माँ",
    "बेटी",
    "बेटा",
    "पत्नी",
    "पति",
    "के लिए",
)
_FRUSTRATED = (
    "useless",
    "not listening",
    "not understanding",
    "stupid",
    "bakwas",
    "pagal",
    "irritating",
    "frustrat",
    "kitni baar",
    "how many times",
    "बकवास",
)
_HINGLISH_MARKERS = (
    "hai",
    "hain",
    "hoon",
    "hu",
    "mera",
    "meri",
    "mujhe",
    "kya",
    "nahi",
    "karna",
    "chahiye",
    "aap",
    "theek",
    "haan",
    "kal",
    "ko",
    "ka",
    "ke",
    "ki",
    "wala",
    "wali",
    "kar",
    "dijiye",
    "naam",
    "bhi",
    "abhi",
    "agle",
    "subah",
    "shaam",
    "baje",
)
_ORDINALS: dict[str, int] = {
    "first": 1,
    "1st": 1,
    "pehla": 1,
    "pehli": 1,
    "pehle": 1,
    "pahla": 1,
    "पहला": 1,
    "पहली": 1,
    "second": 2,
    "2nd": 2,
    "doosra": 2,
    "dusra": 2,
    "doosri": 2,
    "dusri": 2,
    "दूसरा": 2,
    "दूसरी": 2,
    "third": 3,
    "3rd": 3,
    "teesra": 3,
    "tisra": 3,
    "teesri": 3,
    "तीसरा": 3,
    "तीसरी": 3,
}
_PHONE = re.compile(r"(?<!\d)(?:\+?91[\s-]?)?([6-9]\d{4}[\s-]?\d{5})(?!\d)")
_NAME_PATTERNS = [
    re.compile(
        r"(?:my name is|name is|this is|i am|i'm|patient is|patient's name is|patient name is)\s+(.+)",
        re.I,
    ),
    re.compile(
        r"(?:mera naam|meri beti ka naam|mere bete ka naam|patient ka naam|unka naam|naam)\s+(.+?)(?:\s+hai\b|$)",
        re.I,
    ),
    re.compile(r"^main\s+(.+?)\s+(?:bol rahi|bol raha|hoon|hu)\b", re.I),
    re.compile(r"(?:मेरा नाम|नाम)\s+(.+?)(?:\s+है|$)"),
]
_NAME_STOP = re.compile(
    r"\s*(?:,|\.|\band\b|\baur\b|\bmy\b|\bdob\b|\bdate of birth\b|\bborn\b|\bnumber\b|\bphone\b|\bhai\b|\bhoon\b|\d|$)",
    re.I,
)
_LEADING_FILLER = re.compile(
    r"^(?:(?:hello|hi|namaste|ji|haan|yes|sure|ok|okay|it's|its)\b[\s,.]*)+", re.I
)
_FILLER = {
    "hello",
    "hi",
    "namaste",
    "ji",
    "haan",
    "yes",
    "sure",
    "ok",
    "okay",
    "it's",
    "its",
    "it",
    "is",
}


def detect_language(text: str) -> Lang:
    if has_devanagari(text):
        return "hi"
    # Word tokens, not whitespace splits: "hai." must count as "hai" (Hawk run 1).
    words = set(re.findall(r"[a-z]+", normalize(text)))
    return "hinglish" if any(m in words for m in _HINGLISH_MARKERS) else "en"


def _extract_name(raw: str, expecting: Expecting) -> str | None:
    text = raw.strip()
    for pattern in _NAME_PATTERNS:
        if m := pattern.search(text):
            candidate = _NAME_STOP.split(m.group(1).strip(), maxsplit=1)[0]
            return _clean_name(candidate)
    if expecting == "name":
        # A bare answer to "what's the name?": take the leading words before any date/number.
        text = _LEADING_FILLER.sub("", text)
        candidate = _NAME_STOP.split(text, maxsplit=1)[0]
        return _clean_name(candidate)
    return None


def _clean_name(candidate: str) -> str | None:
    words = [w for w in re.split(r"\s+", candidate.strip(" .,'\"")) if w]
    while words and words[0].lower() in _FILLER:
        words.pop(0)
    words = [w for w in words if re.fullmatch(r"[A-Za-zऀ-ॿ'.-]+", w)]
    if not 1 <= len(words) <= 4:
        return None
    return " ".join(w if has_devanagari(w) else w.capitalize() for w in words)


def _match_id(t: str, table: dict[str, list[str]]) -> str | None:
    for id_, names in table.items():
        if any_phrase(t, tuple(names)):
            return id_
    return None


class RuleBasedNLU:
    """Keyword and pattern NLU. Deterministic: the baseline Hawk compares the LLM against."""

    async def understand(self, text: str, ctx: TurnContext) -> Understanding:
        return self.parse(text, ctx)

    def parse(self, text: str, ctx: TurnContext) -> Understanding:
        t = normalize(text)
        lang = detect_language(text)
        if ctx.expecting == "message":
            # Whatever the caller says now IS the message; only its category is inferred.
            return Understanding(
                intent=Intent.provide_info,
                language=lang,
                confidence=0.9,
                frustrated=any_phrase(t, _FRUSTRATED) is not None,
                task_category=_category(t),
                summary=text.strip()[:200],
            )
        dob = parse_dob(text)
        # A date of birth is not an appointment date.
        when_text = text if dob is None else None
        date_ref = parse_date(when_text, ctx.today) if when_text else None
        time_ref = parse_time(when_text) if when_text else None
        phone_m = _PHONE.search(text)
        phone = re.sub(r"\D", "", phone_m.group(1)) if phone_m else None
        services = {k: [*v, *SERVICE_SYNONYMS.get(k, ())] for k, v in ctx.facts.services.items()}
        service_id = _match_id(t, services)
        resource_id = _match_id(t, ctx.facts.resources)
        option = next((n for w, n in _ORDINALS.items() if any_phrase(t, (w,))), None)
        if (
            option is None
            and ctx.expecting == "choice"
            and (m := re.search(r"\b(?:option|number)\s+(\d)\b", t))
        ):
            option = int(m.group(1))
        name = (
            _extract_name(text, ctx.expecting)
            if ctx.expecting in ("name", "intent", "dob")
            else None
        )
        if name and (service_id and name.lower() in " ".join(services[service_id])):
            name = None

        faq_id = None
        for fid, words in _FAQ.items():
            if fid in ctx.facts.faqs and any_phrase(t, words):
                faq_id = fid
                break

        category = _category(t)
        intent = self._intent(
            t,
            ctx,
            faq_id,
            category,
            has_info=any((name, dob, phone, service_id, resource_id, date_ref, time_ref, option)),
        )
        confidence = 0.3 if intent == Intent.unclear else 0.9
        task_category = category if intent == Intent.other_request else None
        secondary = category if intent in (Intent.book, Intent.reschedule, Intent.cancel) else None
        return Understanding(
            intent=intent,
            language=lang,
            confidence=confidence,
            frustrated=any_phrase(t, _FRUSTRATED) is not None,
            third_party=any_phrase(t, _THIRD_PARTY) is not None,
            name=name,
            dob=dob,
            phone=phone,
            service_id=service_id,
            resource_id=resource_id,
            date_text=text if date_ref else None,
            time_text=text if time_ref else None,
            option_number=option,
            faq_id=faq_id,
            task_category=task_category,
            secondary_category=secondary,
            family_member=ctx.expecting == "identity_who" and any_phrase(t, _FAMILY) is not None,
            summary=text.strip()[:200] if intent == Intent.other_request else None,
        )

    def _intent(
        self,
        t: str,
        ctx: TurnContext,
        faq_id: str | None,
        category: TaskCategory | None,
        *,
        has_info: bool,
    ) -> Intent:
        if any_phrase(t, _OPT_OUT):
            return Intent.opt_out
        if ctx.expecting == "identity_who":
            if any_phrase(t, _WRONG_NUMBER):
                return Intent.wrong_number
            if any_phrase(t, _FAMILY) or any_phrase(t, _NO) or t in _BARE_NO:
                return Intent.no
            if any_phrase(t, _YES) or any_phrase(
                t, ("speaking", "bol raha", "bol rahi", "main hi")
            ):
                return Intent.yes
        choosing = ("intent", "anything_else", "attendance")
        if any_phrase(t, _CANCEL) and ctx.expecting in choosing:
            return Intent.cancel
        if any_phrase(t, _RESCHEDULE) and ctx.expecting in choosing:
            return Intent.reschedule
        if ctx.expecting in ("confirm", "anything_else", "callback_confirm", "attendance"):
            if any_phrase(t, _NO) or t in _BARE_NO:
                return Intent.no
            if any_phrase(t, _YES) or any_phrase(
                t, ("will come", "aa jaunga", "aa jaungi", "aaunga", "aaungi", "आ जाऊँगा", "आ जाऊँगी")
            ):
                return Intent.yes
        if ctx.expecting in ("intent", "anything_else"):
            if any_phrase(t, _BOOK):
                return Intent.book
            if faq_id:
                return Intent.faq
            if category is not None:
                return Intent.other_request
        if any_phrase(t, _GOODBYE):
            return Intent.goodbye
        if ctx.expecting in ("intent", "anything_else") and any_phrase(
            t, tuple(w for ws in SERVICE_SYNONYMS.values() for w in ws)
        ):
            return Intent.book
        if has_info:
            return Intent.provide_info
        return Intent.unclear


# ---------------------------------------------------------------- scripted (tests)


def fill_gaps(model: Understanding, rules: Understanding) -> Understanding:
    """Let deterministic code fill in what the model left empty.

    Found by Hawk against the real model: sarvam-105b-conversations returned `intent=book` but no
    `service_id` for "Mujhe cleaning ka appointment chahiye", and again for the bare answer
    "cleaning", so Myna asked what the visit was for 16 times. Matching a word against the
    clinic's own list of services, doctors and numbers is a job for code. The model keeps the
    judgement calls (intent, language, frustration, emergencies); code only ADDS facts it can see
    in the caller's words, and never overrides something the model did extract.
    """
    gaps = {
        name: getattr(rules, name)
        for name in ("service_id", "resource_id", "option_number", "phone", "dob", "name", "faq_id")
        if getattr(model, name) is None and getattr(rules, name) is not None
    }
    return model.model_copy(update=gaps) if gaps else model


Script = Understanding | Callable[[str, TurnContext], Understanding]


class ScriptedNLU:
    """Replays a fixed list of understandings, falling back to rules when the script runs out."""

    def __init__(self, script: Sequence[Script]) -> None:
        self._script = list(script)
        self._rules = RuleBasedNLU()
        self.seen: list[str] = []

    async def understand(self, text: str, ctx: TurnContext) -> Understanding:
        self.seen.append(text)
        if not self._script:
            return self._rules.parse(text, ctx)
        step = self._script.pop(0)
        return step(text, ctx) if callable(step) else step
