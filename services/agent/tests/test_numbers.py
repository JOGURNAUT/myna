from datetime import date

import pytest

from myna_agent.dates import parse_dob
from myna_agent.numbers import words_to_digits


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("twelve april nineteen ninety", "12 april 1990"),
        ("twelfth of april, nineteen eighty-five", "12 of april, 1985"),
        ("born on the first of may two thousand five", "born on the 1 of may 2005"),
        ("twenty fifteen", "2015"),
        ("baarah april unnees sau nabbe", "12 april 1990"),
        ("do hazaar paanch", "2005"),
        ("बारह अप्रैल उन्नीस सौ नब्बे", "12 अप्रैल 1990"),
        ("my name is Pooja", "my name is pooja"),
    ],
)
def test_words_to_digits(text: str, expected: str) -> None:
    assert words_to_digits(text) == expected


@pytest.mark.parametrize(
    ("text", "dob"),
    [
        ("twelve April nineteen ninety", "1990-04-12"),
        ("thirtieth January nineteen ninety five", "1995-01-30"),
        ("baarah April unnees sau nabbe", "1990-04-12"),
        ("तीस जनवरी उन्नीस सौ पचानवे", "1995-01-30"),
        ("2 नवंबर 1985", "1985-11-02"),
    ],
)
def test_dob_in_words(text: str, dob: str) -> None:
    assert parse_dob(text) == date.fromisoformat(dob)
