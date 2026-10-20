"""End-to-end: agent ↔ real API ↔ SQLite, with the final schedule asserted.

Clock: Monday 12 Oct 2026, 09:00 IST. Seeded (synthetic) patients:
  Pooja Malhotra 9811100733, dob 1990-04-12 — cleaning, Thu 15 Oct 10:00, Dr. Mehta
  Arjun Verma    9911100487, dob 1985-11-02 — consultation, Fri 16 Oct 10:00, Dr. Mehta
  Rahul Gupta    9311100816, dob 1995-01-30 — root canal, Sat 17 Oct 10:00, Dr. Mehta
Tests in this module share one API, so each uses its own patient or slot.
"""

from __future__ import annotations

import pytest

from myna_agent import contracts as c
from myna_agent.conversation import State
from myna_agent.nlu import Intent, ScriptedNLU, Understanding
from myna_agent.tools import ApiClient

pytestmark = pytest.mark.api


async def appointments_of(api: ApiClient, name: str, **factor: str) -> list[c.Appointment]:
    found = await api.tool(
        "find_patient",
        c.FindPatientInput(call_id="check", name=name, **factor),
        c.FindPatientOutput,
    )
    assert isinstance(found.root, c.FindPatientOutput1), f"{name} not found"
    out = await api.tool(
        "list_appointments",
        c.ListAppointmentsInput(verification_id=found.root.verification_id),
        c.ListAppointmentsOutput,
    )
    return out.appointments


# ------------------------------------------------------------------ rule 1: disclosure


async def test_every_call_opens_with_the_ai_disclosure(make_call) -> None:
    call = await make_call()
    reply = await call.start()
    assert "AI assistant" in reply.text
    assert "record" not in reply.text.lower()  # this clinic doesn't record, so we don't claim to
    assert "staff" in reply.text.lower()  # offers a human (pilot rule)


async def test_recording_is_disclosed_when_the_clinic_records(make_call) -> None:
    call = await make_call(config_patch={"record_calls": True})
    assert "record ho rahi hai" in (await call.start()).text


# ------------------------------------------------------------------ flow (a): booking


async def test_new_patient_books_in_english_with_read_back(make_call, api) -> None:
    call = await make_call(caller_phone="9822200111")
    await call.start()
    r = await call.say("Hi, I'd like to book a cleaning")
    assert "day and time" in r.text
    r = await call.say("Tuesday at 11 am")
    assert "Tuesday, 13 October, 11 am with Dr. Mehta is available" in r.text
    assert "full name" in r.text
    r = await call.say("My name is Neha Kapoor")
    assert "date of birth" in r.text
    r = await call.say("15 March 1992")
    # Read-back: name, service, doctor, absolute date, time — before anything is written.
    assert r.state == State.CONFIRM
    for part in ("cleaning", "Neha Kapoor", "Dr. Mehta", "Tuesday, 13 October", "11 am"):
        assert part in r.text
    assert await _no_booking_yet(api, "Neha Kapoor", "9822200111")
    r = await call.say("yes please")
    assert r.text.startswith("Done.")
    assert "anything else" in r.text
    r = await call.say("no thanks")
    assert r.ended and r.state == State.CLOSE

    appts = await appointments_of(api, "Neha Kapoor", phone="9822200111")
    assert [(a.start, a.service_id, a.resource_id) for a in appts] == [
        ("2026-10-13T11:00", "cleaning", "dr-mehta")
    ]
    events = await call.events()
    assert [e["outcome"] for e in events if e["type"] == "end"] == ["booked"]
    tools = [e["tool"] for e in events if e["type"] == "tool_call" and e["ok"]]
    assert tools.index("book") > tools.index("find_slots")
    assert "send_sms_confirmation" in tools


async def _no_booking_yet(api: ApiClient, name: str, phone: str) -> bool:
    found = await api.tool(
        "find_patient",
        c.FindPatientInput(call_id="check", name=name, phone=phone),
        c.FindPatientOutput,
    )
    return isinstance(found.root, c.FindPatientOutput2)


async def test_offers_choices_and_takes_the_second(make_call, api) -> None:
    call = await make_call(caller_phone="9822200222")
    await call.start()
    r = await call.say("I need a consultation with Dr Rao on Wednesday")
    assert "Dr. Rao" in r.text and " or " in r.text  # three spaced-out options
    assert r.text.count("Wednesday, 14 October") == 1  # same day: the date is said once
    r = await call.say("the second one")
    assert "full name" in r.text
    await call.say("Ravi Menon")
    await call.say("1 January 1980")
    r = await call.say("yes")
    assert r.text.startswith("Done.")
    appts = await appointments_of(api, "Ravi Menon", phone="9822200222")
    assert len(appts) == 1 and appts[0].resource_id == "dr-rao"
    assert appts[0].start.startswith("2026-10-14")


async def test_mind_change_at_read_back_books_only_the_final_choice(make_call, api) -> None:
    call = await make_call(caller_phone="9822200333")
    await call.start()
    await call.say("book a filling on Thursday at 11 am")
    await call.say("Sana Shaikh")
    r = await call.say("5 May 1991")
    assert r.state == State.CONFIRM and "Thursday, 15 October" in r.text
    r = await call.say("no, make it Friday at 12")
    assert r.state == State.CONFIRM and "Friday, 16 October" in r.text and "12 pm" in r.text
    await call.say("yes")
    appts = await appointments_of(api, "Sana Shaikh", phone="9822200333")
    assert [a.start for a in appts] == ["2026-10-16T12:00"]


# ------------------------------------------------------------------ reschedule / cancel


async def test_hinglish_reschedule_with_mind_change(make_call, api) -> None:
    call = await make_call(caller_phone="9811100733")  # Pooja's registered number
    await call.start()
    r = await call.say("Mera appointment change karna hai")
    assert "naam" in r.text
    r = await call.say("Pooja Malhotra")
    # Verified by name + registered phone; only now are details read out.
    assert "Thursday, 15 October" in r.text and "Iski jagah" in r.text
    r = await call.say("Wednesday... nahi, Friday shaam 6 baje")
    assert r.state == State.CONFIRM
    assert "Friday, 16 October" in r.text and "shaam 6 baje" in r.text
    r = await call.say("haan theek hai")
    assert "Ho gaya" in r.text
    appts = await appointments_of(api, "Pooja Malhotra", dob="1990-04-12")
    assert [(a.start, a.status.value) for a in appts] == [("2026-10-16T18:00", "confirmed")]


async def test_third_party_caller_must_verify_the_patient_then_cancels(make_call, api) -> None:
    call = await make_call(caller_phone="9822200999")  # the son's phone, not on record
    await call.start()
    r = await call.say("I want to cancel my father's appointment")
    assert "patient's full name" in r.text and "not yours" in r.text
    r = await call.say("Arjun Verma")
    assert "date of birth" in r.text
    assert "consultation" not in r.text and "October" not in r.text  # nothing disclosed yet
    r = await call.say("2 November 1985")
    assert "cancel" in r.text and "Friday, 16 October" in r.text
    r = await call.say("yes")
    assert "cancelled" in r.text
    assert await appointments_of(api, "Arjun Verma", dob="1985-11-02") == []


async def test_wrong_details_never_disclose_and_end_with_staff(make_call, api) -> None:
    call = await make_call(caller_phone="9822200888")
    await call.start()
    await call.say("cancel my appointment")
    await call.say("Rahul Gupta")
    r = await call.say("1 January 1990")
    assert "couldn't match" in r.text
    r = await call.say("Rahul Gupta, 2 January 1990")
    assert r.ended and r.handoff_to == "9800000002"
    assert "couldn't confirm" in r.text
    for leak in ("root canal", "Saturday", "17 October", "10 am"):
        assert leak not in call.all_text
    still = await appointments_of(api, "Rahul Gupta", dob="1995-01-30")
    assert len(still) == 1 and still[0].status.value == "confirmed"
    ends = [e for e in await call.events() if e["type"] == "end"]
    assert ends[-1]["handoffReason"] == "verification_failed"


# ------------------------------------------------------------------ rules 2, 3, 5, 6


async def test_emergency_mid_booking_stops_everything(make_call) -> None:
    call = await make_call(caller_phone="9822200444")
    await call.start()
    await call.say("I want to book a cleaning tomorrow")
    r = await call.say("wait, bahut khoon aa raha hai")
    assert "112" in r.text and "108" in r.text
    assert r.ended and r.handoff_to == "9800000002"
    r = await call.say("ok, just book it")  # the booking flow never resumes
    assert "112" in r.text and r.ended
    events = await call.events()
    assert not any(e["type"] == "tool_call" and e["tool"] == "book" for e in events)
    assert [e["type"] for e in events].count("handoff") == 1


async def test_emergency_in_hindi_at_the_first_turn(make_call) -> None:
    call = await make_call()
    await call.start()
    r = await call.say("मेरे पापा बेहोश हो गए हैं")
    assert "112" in r.text and "108" in r.text and r.ended
    assert r.language == "hi"


async def test_model_flagged_emergency_is_honoured_too(make_call) -> None:
    # A paraphrase the keyword list misses, caught by the model.
    nlu = ScriptedNLU([Understanding(intent=Intent.emergency, language="en", confidence=0.8)])
    call = await make_call(nlu=nlu)
    await call.start()
    r = await call.say("my mouth won't stop filling with red")
    assert "112" in r.text and r.ended


async def test_medical_question_is_redirected_without_advice(make_call) -> None:
    call = await make_call(caller_phone="9822200555")
    await call.start()
    r = await call.say("which painkiller should I take for my tooth?")
    assert "can't give medical advice" in r.text
    assert not r.ended
    r = await call.say("ok then book a consultation tomorrow morning")
    assert "Tuesday, 13 October" in r.text  # the flow carries on normally


async def test_two_failed_understandings_hand_off(make_call) -> None:
    call = await make_call()
    await call.start()
    r = await call.say("blorp")
    # Still in the greeting language (Hinglish): one unknown word isn't a language switch.
    assert "samajh nahi" in r.text and not r.ended
    r = await call.say("zzzz")
    assert r.ended and r.handoff_to is not None
    ends = [e for e in await call.events() if e["type"] == "end"]
    assert ends[-1]["handoffReason"] == "repeated_misunderstanding"


async def test_frustrated_caller_goes_to_staff(make_call) -> None:
    call = await make_call()
    await call.start()
    r = await call.say("this is useless, how many times do I have to say it")
    assert r.ended


async def test_asking_for_staff_is_always_honoured(make_call) -> None:
    call = await make_call()
    await call.start()
    await call.say("I want to book a cleaning")
    r = await call.say("actually can I talk to the staff")
    assert r.ended and r.handoff_to == "9800000002"


async def test_kill_switch_hands_off_before_anything_else(make_call) -> None:
    call = await make_call(config_patch={"kill_switch": True})
    r = await call.start()
    assert r.ended and r.handoff_to == "9800000002"
    assert "connect" in r.text.lower() or "jod" in r.text


async def test_model_outage_is_treated_as_not_understood(make_call) -> None:
    class Broken:
        async def understand(self, text, ctx):
            raise TimeoutError("LLM timed out")

    call = await make_call(nlu=Broken())
    await call.start()
    r = await call.say("hello?")
    assert "didn't catch" in r.text or "samajh" in r.text


# ------------------------------------------------------------------ FAQ


async def test_faq_answers_only_from_config(make_call) -> None:
    call = await make_call()
    await call.start()
    r = await call.say("what are your timings?")
    assert "Monday to Friday" in r.text and not r.ended


async def test_blank_faq_answer_is_never_guessed(make_call) -> None:
    call = await make_call()
    await call.start()
    r = await call.say("do you take cashless insurance?")
    assert "won't guess" in r.text and r.ended
    ends = [e for e in await call.events() if e["type"] == "end"]
    assert ends[-1]["handoffReason"] == "unanswered_question"


# ------------------------------------------------------------------ races


async def test_slot_taken_between_read_back_and_yes(make_call) -> None:
    first = await make_call(caller_phone="9822200666")
    second = await make_call(caller_phone="9822200777")
    for call, name in ((first, "Kiran Rao"), (second, "Leela Iyer")):
        await call.start()
        await call.say("book a consultation on Thursday at 12 pm")
        await call.say(name)
        r = await call.say("3 March 1993")
        assert r.state == State.CONFIRM and "12 pm" in r.text
    assert (await first.say("yes")).text.startswith("Done.")
    r = await second.say("yes")
    assert "just taken" in r.text
    assert "12 pm" not in r.text.split("just taken", 1)[1]  # the taken slot is not re-offered


async def test_a_conversation_that_cannot_progress_hands_off_instead_of_looping(
    make_call,
) -> None:
    """The same question three times running means Myna is stuck, whatever the cause."""

    class Deaf:
        """A model that always says 'book' but never extracts anything."""

        async def understand(self, text, ctx):
            return Understanding(intent=Intent.book, language="en", confidence=0.95)

    call = await make_call(nlu=Deaf())
    await call.start()
    replies = [await call.say("cleaning") for _ in range(4)]
    assert not replies[0].ended and not replies[1].ended
    assert replies[2].ended and replies[2].handoff_to is not None
    events = await call.events()
    assert [e["handoffReason"] for e in events if e["type"] == "end"] == [
        "repeated_misunderstanding"
    ]
