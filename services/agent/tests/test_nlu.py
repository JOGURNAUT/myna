from datetime import date

import pytest

from myna_agent.nlu import ClinicFacts, Intent, RuleBasedNLU, TurnContext, detect_language

FACTS = ClinicFacts(
    services={
        "cleaning": ["cleaning"],
        "consultation": ["consultation"],
        "root-canal": ["root canal"],
    },
    resources={"dr-mehta": ["dr. mehta", "mehta"], "dr-rao": ["dr. rao", "rao"]},
    faqs={"timings": "timings", "insurance": "insurance"},
)
nlu = RuleBasedNLU()


def parse(text: str, expecting: str = "intent"):
    ctx = TurnContext(expecting=expecting, today=date(2026, 10, 12), facts=FACTS, language="en")  # type: ignore[arg-type]
    return nlu.parse(text, ctx)


@pytest.mark.parametrize(
    ("text", "lang"),
    [
        ("I want to book a cleaning", "en"),
        ("do you take insurance", "en"),
        ("mujhe appointment chahiye", "hinglish"),
        ("kal aa sakti hoon kya", "hinglish"),
        ("मुझे अपॉइंटमेंट चाहिए", "hi"),
    ],
)
def test_language(text: str, lang: str) -> None:
    assert detect_language(text) == lang


@pytest.mark.parametrize(
    ("text", "intent"),
    [
        ("I'd like to book a cleaning", Intent.book),
        ("appointment chahiye", Intent.book),
        ("I need to reschedule", Intent.reschedule),
        ("mera appointment badalna hai", Intent.reschedule),
        ("please cancel my appointment", Intent.cancel),
        ("what are your timings", Intent.faq),
        ("is my x-ray report ready", Intent.other_request),
        ("cleaning karwani hai", Intent.book),
        ("blah", Intent.unclear),
    ],
)
def test_intents(text: str, intent: Intent) -> None:
    assert parse(text).intent == intent


@pytest.mark.parametrize(
    ("text", "intent"),
    [
        ("yes please", Intent.yes),
        ("haan ji", Intent.yes),
        ("theek hai", Intent.yes),
        ("हाँ", Intent.yes),
        ("no", Intent.no),
        ("nahi", Intent.no),
        ("na", Intent.no),
        ("kar do na", Intent.yes),  # "na" softens; it isn't "no"
        ("nahi ji", Intent.no),
    ],
)
def test_confirmations(text: str, intent: Intent) -> None:
    assert parse(text, "confirm").intent == intent


@pytest.mark.parametrize(
    ("text", "name"),
    [
        ("My name is Pooja Malhotra", "Pooja Malhotra"),
        ("this is Arjun Verma, born 2 November 1985", "Arjun Verma"),
        ("mera naam Pooja Malhotra hai", "Pooja Malhotra"),
        ("main Neha Kapoor bol rahi hoon", "Neha Kapoor"),
        ("Pooja Malhotra", "Pooja Malhotra"),
        ("ji, Rahul Gupta", "Rahul Gupta"),
        ("मेरा नाम पूजा मल्होत्रा है", "पूजा मल्होत्रा"),
    ],
)
def test_names(text: str, name: str) -> None:
    assert parse(text, "name").name == name


def test_a_patient_named_like_a_doctor_is_still_a_name() -> None:
    u = parse("Kiran Rao", "name")
    assert u.name == "Kiran Rao"


def test_extracts_everything_from_one_sentence() -> None:
    u = parse("Hi, I'm Pooja Malhotra, I want to move my cleaning to next Tuesday evening")
    assert u.intent == Intent.reschedule
    assert u.name == "Pooja Malhotra"
    assert u.date_text is not None and u.time_text is not None


def test_phone_numbers() -> None:
    assert parse("my number is +91 98111 00733", "phone").phone == "9811100733"
    assert parse("98111-00733", "phone").phone == "9811100733"


def test_dob_is_not_an_appointment_date() -> None:
    u = parse("12 April 1990", "dob")
    assert u.dob == date(1990, 4, 12) and u.date_text is None


@pytest.mark.parametrize(
    ("text", "n"), [("the second one", 2), ("pehla wala", 1), ("teesra", 3), ("option 2", 2)]
)
def test_option_choice(text: str, n: int) -> None:
    assert parse(text, "choice").option_number == n


def test_third_party_and_frustration() -> None:
    assert parse("booking for my mother").third_party
    assert parse("mummy ke liye appointment chahiye").third_party
    assert parse("this is useless").frustrated


@pytest.mark.parametrize(
    ("text", "name"),
    [
        ("ji main Neha Kapoor bol rahi hoon", "Neha Kapoor"),
        ("main Neha Kapoor bol rahi hoon", "Neha Kapoor"),
        ("Hi, this is Neha Kapoor speaking", "Neha Kapoor"),
        ("जी मैं नेहा कपूर बोल रही हूँ", "नेहा कपूर"),
        ("haan ji, mera naam Rahul Gupta hai", "Rahul Gupta"),
    ],
)
def test_formal_introductions(text: str, name: str) -> None:
    """Found by the live demo: 'ji main X bol rahi hoon' was not understood as a name."""
    assert parse(text, "name").name == name


def test_name_corrections_at_the_read_back() -> None:
    from myna_agent.nlu import extract_name_correction

    assert extract_name_correction("No, the name is Neha Kapoor.") == "Neha Kapoor"
    assert extract_name_correction("nahi, naam Neha Kapoor hai") == "Neha Kapoor"
    assert extract_name_correction("नहीं, नाम नेहा कपूर है।") == "नेहा कपूर"
    # Ordinary objections are not names.
    for text in ("no, this is wrong", "no thanks", "nahi, Wednesday kar do", "I am not sure"):
        assert extract_name_correction(text) is None
