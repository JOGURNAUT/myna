import pytest

from myna_agent.safety import check


@pytest.mark.parametrize(
    "text",
    [
        "I have chest pain",
        "my father can't breathe",
        "she fainted in the clinic",
        "the bleeding won't stop after the extraction",
        "bleeding heavily since morning",
        "there was an accident",
        "I want to kill myself",
        "seene mein dard ho raha hai",
        "bahut khoon aa raha hai",
        "khoon ruk nahi raha",
        "papa behosh ho gaye",
        "saans nahi aa rahi",
        "बहुत खून आ रहा है",
        "सीने में दर्द है",
        "मैं आत्महत्या करना चाहता हूँ",
    ],
)
def test_emergencies_are_caught(text: str) -> None:
    assert check(text).emergency is not None


@pytest.mark.parametrize(
    "text",
    [
        "my gums bleed a little when I brush",
        "I want a cleaning",
        "I booked by accidentally pressing the wrong button",
        "daant mein dard hai, appointment chahiye",
        "mera appointment kal hai",
    ],
)
def test_ordinary_requests_are_not_emergencies(text: str) -> None:
    assert check(text).emergency is None


@pytest.mark.parametrize(
    "text",
    [
        "which painkiller should I take",
        "can I take ibuprofen",
        "kaunsi dawai lun",
        "swelling hai, kya karun",
        "is it normal that it hurts",
        "क्या करूँ, दर्द हो रहा है",
        "500 mg theek hai?",
    ],
)
def test_medical_questions_are_caught(text: str) -> None:
    assert check(text).medical is not None


def test_booking_a_doctor_is_not_a_medical_question() -> None:
    assert check("I want to see the doctor about my tooth pain").medical is None


@pytest.mark.parametrize(
    "text", ["can I talk to the staff", "kisi se baat karni hai", "real person please"]
)
def test_asking_for_a_human(text: str) -> None:
    assert check(text).wants_human is not None
