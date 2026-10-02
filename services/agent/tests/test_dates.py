from datetime import date

import pytest

from myna_agent.dates import DateRef, parse_date, parse_dob, parse_time

MON = date(2026, 10, 12)  # Monday


def d(s: str) -> date:
    return date.fromisoformat(s)


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("tomorrow please", "2026-10-13"),
        ("kal aa sakti hoon", "2026-10-13"),
        ("कल सुबह", "2026-10-13"),
        ("parso", "2026-10-14"),
        ("aaj hi", "2026-10-12"),
        ("on Thursday", "2026-10-15"),
        ("guruvar ko", "2026-10-15"),
        ("गुरुवार को", "2026-10-15"),
        ("Monday", "2026-10-19"),  # same weekday → next week, never today
        ("next Tuesday", "2026-10-20"),
        ("agle mangalvar", "2026-10-20"),
        ("agle hafte Friday", "2026-10-23"),
        ("this Saturday", "2026-10-17"),
        ("14 October", "2026-10-14"),
        ("14th of Oct", "2026-10-14"),
        ("October 14", "2026-10-14"),
        ("14 अक्टूबर", "2026-10-14"),
        ("16/10", "2026-10-16"),
        ("pehli tareekh", "2026-11-01"),  # the 1st has passed this month → next month
        ("15 tareekh", "2026-10-15"),
        ("5 January", "2027-01-05"),  # past this year → next year
    ],
)
def test_single_days(text: str, expected: str) -> None:
    ref = parse_date(text, MON)
    assert ref == DateRef(d(expected), d(expected))


def test_mind_change_takes_the_last_mention() -> None:
    assert parse_date("Wednesday... nahi, Tuesday", MON) == DateRef(
        d("2026-10-13"), d("2026-10-13")
    )
    assert parse_date("kal nahi, parso", MON) == DateRef(d("2026-10-14"), d("2026-10-14"))


def test_next_week_is_a_range() -> None:
    assert parse_date("sometime next week", MON) == DateRef(d("2026-10-19"), d("2026-10-25"))
    assert parse_date("agle hafte", MON) == DateRef(d("2026-10-19"), d("2026-10-25"))


@pytest.mark.parametrize(
    "text",
    ["I want a cleaning", "may I book", "do you have time", "sunita sharma", "31/02", "mar jaunga"],
)
def test_no_false_dates(text: str) -> None:
    assert parse_date(text, MON) is None


@pytest.mark.parametrize(
    ("text", "hhmm", "pod"),
    [
        ("10:30 am", "10:30", None),
        ("4:30 pm", "16:30", None),
        ("at 11", "11:00", None),
        ("at 4", "16:00", None),
        ("11", None, None),  # a bare number is not a time
        ("at 14 October", None, None),  # a date, not a time
        ("4 baje", "16:00", None),  # 1–7 → afternoon/evening at a clinic
        ("11 baje", "11:00", None),
        ("subah 10 baje", "10:00", "morning"),
        ("shaam ko 6 baje", "18:00", "evening"),
        ("saade chaar", "16:30", None),
        ("साढ़े चार बजे", "16:30", None),
        ("sawa paanch baje", "17:15", None),
        ("paune chhe", "17:45", None),
        ("dhai baje", "14:30", None),
        ("5 pm... no, 6 pm", "18:00", None),
        ("evening", None, "evening"),
        ("dopahar mein", None, "afternoon"),
    ],
)
def test_times(text: str, hhmm: str | None, pod: str | None) -> None:
    ref = parse_time(text)
    if hhmm is None and pod is None:
        assert ref is None
        return
    assert ref is not None
    assert ref.as_hhmm() == hhmm
    assert ref.part_of_day == pod


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("12 April 1990", "1990-04-12"),
        ("my dob is 12/04/1990", "1990-04-12"),
        ("1990-04-12", "1990-04-12"),
        ("April 12, 1990", "1990-04-12"),
        ("12 अप्रैल 1990", "1990-04-12"),
    ],
)
def test_dob(text: str, expected: str) -> None:
    assert parse_dob(text) == d(expected)


@pytest.mark.parametrize("text", ["12 April", "31/02/1990", "born in 1990"])
def test_dob_needs_a_full_valid_date(text: str) -> None:
    assert parse_dob(text) is None
