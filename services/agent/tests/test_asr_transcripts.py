"""Real speech-recognition output (Saaras v4 via Hawk audio mode, 2026-10-20) must be understood.

Saaras writes Hinglish in Devanagari, spells English words phonetically ("क्लीनिंग", "फ्राइडे"),
and sometimes switches script mid-call. These strings are what the recogniser actually returned.
"""

from __future__ import annotations

from datetime import date

import pytest

from myna_agent.dates import parse_date, parse_time
from myna_agent.nlu import ClinicFacts, Intent, RuleBasedNLU, TurnContext
from myna_agent.safety import check

TODAY = date(2026, 10, 12)  # a Monday
FACTS = ClinicFacts(
    services={
        "cleaning": ["cleaning"],
        "consultation": ["consultation", "checkup"],
        "filling": ["filling"],
        "root-canal": ["root canal"],
    },
    resources={"dr-mehta": ["dr. mehta", "mehta"]},
    faqs={},
)


def ctx(expecting: str) -> TurnContext:
    return TurnContext(expecting=expecting, today=TODAY, facts=FACTS, language="hinglish")  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("heard", "service"),
    [
        ("मुझे क्लीनिंग का अपॉइंटमेंट चाहिए कल दोपहर 12 बजे", "cleaning"),
        ("मुझे चेकअप का अपॉइंटमेंट चाहिए फ्राइडे दोपहर 12 बजे", "consultation"),
        ("मुझे सफाई का अपॉइंटमेंट चाहिए कल सुबह 11:00 बजे", "cleaning"),
    ],
)
def test_services_spelled_the_way_saaras_writes_them(heard: str, service: str) -> None:
    u = RuleBasedNLU().parse(heard, ctx("intent"))
    assert u.service_id == service
    assert u.intent == Intent.book


@pytest.mark.parametrize(
    ("heard", "expected"),
    [
        ("फ्राइडे", date(2026, 10, 16)),
        ("थर्सडे शाम को", date(2026, 10, 15)),
        ("मंडे", date(2026, 10, 19)),
        ("संडे", date(2026, 10, 18)),
    ],
)
def test_english_weekdays_in_devanagari(heard: str, expected: date) -> None:
    ref = parse_date(heard, TODAY)
    assert ref is not None and ref.start == expected


def test_eleven_oclock_with_minutes_in_devanagari_speech() -> None:
    t = parse_time("कल सुबह 11:00 बजे")
    assert t is not None and t.as_hhmm() == "11:00"


@pytest.mark.parametrize("heard", ["नाही बस थँक्यू", "नहीं, बस धन्यवाद।", "No, bas. Thank you."])
def test_goodbyes_as_recognised(heard: str) -> None:
    assert RuleBasedNLU().parse(heard, ctx("anything_else")).intent in (Intent.goodbye, Intent.no)


# ---- Safety rules must hold when English words arrive in Devanagari (Saaras' habit).


@pytest.mark.parametrize(
    "heard",
    [
        "मेरी मम्मी को चेस्ट पेन हो रहा है",
        "पापा को हार्ट अटैक आया है",
        "बहुत ब्लीडिंग हो रही है",
        "ब्लीडिंग रुक नहीं रही",
        "एक्सीडेंट हो गया है",
        "वो अनकॉन्शियस हो गए हैं",
        "मुझे सुसाइड के ख्याल आ रहे हैं",
    ],
)
def test_emergencies_are_caught_in_transliterated_speech(heard: str) -> None:
    assert check(heard).emergency is not None


def test_ordinary_dental_bleeding_is_not_an_emergency() -> None:
    assert check("मसूड़ों से ब्लीडिंग होती है, चेकअप चाहिए").emergency is None


@pytest.mark.parametrize("heard", ["कौन सी मेडिसिन लूं", "पैरासिटामोल ले सकता हूँ क्या", "डोज़ कितनी है"])
def test_medicine_questions_are_still_refused(heard: str) -> None:
    assert check(heard).medical is not None


def test_refills_and_staff_requests_and_opt_outs() -> None:
    assert check("मुझे रीफिल चाहिए").refill is not None
    assert check("मुझे स्टाफ से बात करनी है").wants_human is not None
    assert check("मुझे रिसेप्शनिस्ट से बात करनी है").wants_human is not None
    assert check("दोबारा कॉल मत करना").opt_out is not None


@pytest.mark.parametrize(
    ("heard", "intent"),
    [
        ("कैंसिल कर दो।", Intent.cancel),
        ("मुझे अपॉइंटमेंट रीशेड्यूल करना है", Intent.reschedule),
        ("मेरा अपॉइंटमेंट चेंज करना है", Intent.reschedule),
    ],
)
def test_change_and_cancel_in_transliterated_speech(heard: str, intent: Intent) -> None:
    assert RuleBasedNLU().parse(heard, ctx("intent")).intent == intent


@pytest.mark.parametrize(
    ("heard", "hhmm"),
    [
        ("tomorrow at eleven a.m.", "11:00"),
        ("ten a.m. please", "10:00"),
        ("two p.m.", "14:00"),
        ("twelve thirty p.m.", "12:30"),
        ("half past two in the afternoon", "14:30"),
        ("quarter past ten", "10:15"),
        ("quarter to eleven", "10:45"),
        ("at 11 a.m.", "11:00"),
        ("eleven o'clock", "11:00"),
    ],
)
def test_english_times_the_way_they_are_transcribed(heard: str, hhmm: str) -> None:
    t = parse_time(heard)
    assert t is not None and t.as_hhmm() == hhmm
