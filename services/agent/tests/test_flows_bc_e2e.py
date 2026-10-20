"""End-to-end for flow (b) messages and flow (c) reminder calls, each in its own Hawk tenant.

Clock: Monday 12 Oct 2026, 11:00 IST — inside the default 10:00–18:00 reminder window.
Smile Dental hours: Mon–Fri 10–13 & 17–20:30, so a 2-hour callback promise made at 11:00
lands at 13:00 today.
"""

from __future__ import annotations

from datetime import datetime

import pytest

from myna_agent.conversation import State

pytestmark = pytest.mark.api

API_NOW_UTC = "2026-10-12T05:30:00Z"
NOW_LOCAL = datetime(2026, 10, 12, 11, 0)

POOJA = {"key": "pooja", "name": "Pooja Malhotra", "phone": "9811100733", "dob": "1990-04-12"}
ARJUN = {"key": "arjun", "name": "Arjun Verma", "phone": "9911100487", "dob": "1985-11-02"}
TOMORROW_CLEANING = {
    "key": "a1",
    "patient": "pooja",
    "serviceId": "cleaning",
    "resourceId": "dr-mehta",
    "start": "2026-10-13T10:00",
}
REMINDERS_ON = {"outboundReminders": {"enabled": True}, "greetingLanguage": "en"}


# ====================================================================== flow (b)


async def test_report_question_from_the_registered_number_becomes_a_task(
    make_call, make_tenant
) -> None:
    t = await make_tenant(patients=[POOJA])
    call = await make_call(caller_phone=POOJA["phone"], clinic_id=t["clinicId"])
    await call.start()
    r = await call.say("Is my X-ray report ready?")
    assert r.state == State.TAKE_MESSAGE and "full name" in r.text
    r = await call.say("Pooja Malhotra")
    assert "ending 0733" in r.text
    r = await call.say("yes")
    assert "passed this on" in r.text and "today by 1 pm" in r.text
    assert "anything else" in r.text
    r = await call.say("no, thank you")
    assert r.ended

    # Myna never says anything about the report itself.
    for leak in ("is ready", "not ready", "result"):
        assert leak not in call.all_text.lower().replace("x-ray report ready", "")
    [task] = (await make_tenant.state(t["clinicId"]))["tasks"]
    assert task["category"] == "report_status"
    assert task["verified"] is True and task["patientName"] == "Pooja Malhotra"
    assert task["callbackBy"] == "2026-10-12T13:00"
    assert task["summary"] == "Is my X-ray report ready?"


async def test_refill_request_is_an_urgent_task_not_a_medical_redirect(
    make_call, make_tenant
) -> None:
    t = await make_tenant(patients=[POOJA])
    call = await make_call(caller_phone=POOJA["phone"], clinic_id=t["clinicId"])
    await call.start()
    r = await call.say("I need a refill of the painkiller the doctor gave me")
    assert "medical advice" not in r.text and r.state == State.TAKE_MESSAGE
    await call.say("Pooja Malhotra")
    r = await call.say("yes")
    assert "passed this on" in r.text
    assert "painkiller" not in call.all_text.split("I need a refill", 1)[0]
    [task] = (await make_tenant.state(t["clinicId"]))["tasks"]
    assert task["category"] == "medicine_refill_request" and task["urgency"] == "urgent"


async def test_an_unverified_caller_still_gets_the_message_taken(make_call, make_tenant) -> None:
    t = await make_tenant()
    call = await make_call(caller_phone="9822200111", clinic_id=t["clinicId"])
    await call.start()
    await call.say("I have a question about my bill")
    r = await call.say("Ramesh Kumar")
    assert "date of birth" in r.text and "don't know" in r.text
    r = await call.say("I don't know it")
    assert "ending 0111" in r.text
    r = await call.say("yes")
    assert "passed this on" in r.text
    [task] = (await make_tenant.state(t["clinicId"]))["tasks"]
    assert task["verified"] is False and task["patientId"] is None
    assert task["callerName"] == "Ramesh Kumar" and task["category"] == "billing_question"


async def test_asks_what_to_pass_on_and_takes_a_new_number(make_call, make_tenant) -> None:
    t = await make_tenant(patients=[ARJUN])
    call = await make_call(caller_phone=ARJUN["phone"], clinic_id=t["clinicId"])
    await call.start()
    r = await call.say("I'd like to leave a message for the doctor")
    await call.say("Arjun Verma")
    r = call.replies[-1]
    assert "pass on" in r.text
    r = await call.say("Please ask Dr Mehta to call me about my braces wire")
    assert "ending 0487" in r.text
    r = await call.say("no")
    assert "Which number" in r.text
    r = await call.say("98222 00999")
    assert "ending 0999" in r.text
    await call.say("yes")
    [task] = (await make_tenant.state(t["clinicId"]))["tasks"]
    assert task["category"] == "doctor_callback"
    assert task["callbackNumberMasked"] == "98xxxxx999"
    assert "braces" in task["summary"]


async def test_booking_and_a_question_in_one_call(make_call, make_tenant) -> None:
    t = await make_tenant(patients=[POOJA])
    call = await make_call(caller_phone=POOJA["phone"], clinic_id=t["clinicId"])
    await call.start()
    await call.say("Book a cleaning tomorrow at 12, and is my report ready?")
    r = await call.say("Pooja Malhotra")
    assert r.state == State.CONFIRM
    r = await call.say("yes")
    assert r.text.startswith("Done.") and "question for the team" in r.text and "0733" in r.text
    r = await call.say("yes")
    assert "passed this on" in r.text
    s = await make_tenant.state(t["clinicId"])
    assert [(a["start"], a["status"]) for a in s["appointments"]] == [
        ("2026-10-13T12:00", "confirmed")
    ]
    assert [x["category"] for x in s["tasks"]] == ["report_status"]


async def test_hinglish_message(make_call, make_tenant) -> None:
    t = await make_tenant(patients=[POOJA])
    call = await make_call(caller_phone=POOJA["phone"], clinic_id=t["clinicId"])
    await call.start()
    r = await call.say("Meri report aa gayi kya?")
    assert "naam" in r.text
    await call.say("Pooja Malhotra")
    r = await call.say("haan")
    assert "team ko bata diya" in r.text and "aaj" in r.text


# ====================================================================== flow (c)


async def outbound(make_call, make_tenant, language="en", **tenant):
    t = await make_tenant(
        config={**REMINDERS_ON, "greetingLanguage": language},
        patients=tenant.get("patients", [POOJA]),
        appointments=tenant.get("appointments", [TOMORROW_CLEANING]),
    )
    call = await make_call(clinic_id=t["clinicId"])
    [reminder] = await call.api.due_reminders()
    reply = await call.conv.start_outbound(reminder)
    call._check(reply)
    return t, call, reply


async def reminder_outcomes(make_tenant, t) -> list[str]:
    return [r["outcome"] for r in (await make_tenant.state(t["clinicId"]))["reminders"]]


async def test_reminder_confirmed_after_identity_check(make_call, make_tenant) -> None:
    t, call, r = await outbound(make_call, make_tenant)
    assert "automated assistant" in r.text and "Am I speaking with Pooja?" in r.text
    assert "cleaning" not in r.text and "October" not in r.text  # nothing before verification
    r = await call.say("yes, speaking")
    assert "date of birth" in r.text and "cleaning" not in r.text
    r = await call.say("12 April 1990")
    assert "cleaning with Dr. Mehta on Tuesday, 13 October at 10 am" in r.text
    r = await call.say("yes, I will come")
    assert r.ended and "see you" in r.text
    assert await reminder_outcomes(make_tenant, t) == ["confirmed"]
    assert await call.api.due_reminders() == []


async def test_family_member_gets_no_details(make_call, make_tenant) -> None:
    t, call, _ = await outbound(make_call, make_tenant)
    r = await call.say("No, this is her mother. She is not at home.")
    assert r.ended and "ask Pooja to call" in r.text and "98000 00001" in r.text
    for leak in ("cleaning", "October", "Tuesday", "Dr. Mehta", "10 am"):
        assert leak not in call.all_text
    assert await reminder_outcomes(make_tenant, t) == ["reached_family"]


async def test_wrong_number(make_call, make_tenant) -> None:
    t, call, _ = await outbound(make_call, make_tenant)
    r = await call.say("Wrong number, there's no one by that name here")
    assert r.ended and "Sorry for the trouble" in r.text
    assert await reminder_outcomes(make_tenant, t) == ["wrong_number"]


async def test_opt_out_is_honoured_and_remembered(make_call, make_tenant) -> None:
    t, call, _ = await outbound(make_call, make_tenant)
    r = await call.say("Please don't call me again")
    assert r.ended and "won't call this number" in r.text
    s = await make_tenant.state(t["clinicId"])
    assert [r["outcome"] for r in s["reminders"]] == ["opted_out"]
    assert s["patients"][0]["doNotCall"] is True
    assert await call.api.due_reminders() == []


async def test_patient_reschedules_during_the_reminder(make_call, make_tenant) -> None:
    t, call, r = await outbound(make_call, make_tenant, language="hinglish")
    assert "Kya meri baat Pooja se ho rahi hai?" in r.text
    await call.say("haan main hi bol rahi hoon")
    await call.say("12 April 1990")
    r = await call.say("Nahi aa paungi, Thursday 11 baje kar do")
    assert r.state == State.CONFIRM and "Thursday, 15 October" in r.text
    r = await call.say("haan")
    assert r.ended and "Ho gaya" in r.text
    s = await make_tenant.state(t["clinicId"])
    assert [(a["start"], a["status"]) for a in s["appointments"]] == [
        ("2026-10-15T11:00", "confirmed")
    ]
    assert [r["outcome"] for r in s["reminders"]] == ["rescheduled"]


async def test_patient_cancels_during_the_reminder(make_call, make_tenant) -> None:
    t, call, _ = await outbound(make_call, make_tenant)
    await call.say("yes")
    await call.say("12/04/1990")
    r = await call.say("Please cancel it")
    assert r.state == State.CONFIRM and "cancel" in r.text
    r = await call.say("yes")
    assert r.ended
    s = await make_tenant.state(t["clinicId"])
    assert s["appointments"][0]["status"] == "cancelled"
    assert [r["outcome"] for r in s["reminders"]] == ["cancelled"]


async def test_wrong_date_of_birth_twice_discloses_nothing(make_call, make_tenant) -> None:
    t, call, _ = await outbound(make_call, make_tenant)
    await call.say("yes")
    r = await call.say("1 January 1991")
    assert "doesn't match" in r.text
    r = await call.say("2 February 1992")
    assert r.ended and "can't share the details" in r.text
    assert "cleaning" not in call.all_text and "October" not in call.all_text
    assert await reminder_outcomes(make_tenant, t) == ["not_verified"]


async def test_no_answer_and_voicemail(make_call, make_tenant) -> None:
    t, call, _ = await outbound(make_call, make_tenant)
    r = await call.say("[no answer]")
    assert r.ended and r.text == ""
    assert await reminder_outcomes(make_tenant, t) == ["no_answer"]

    t2, call2, _ = await outbound(make_call, make_tenant)
    r = await call2.say("[voicemail]")
    assert r.ended and "calling for Pooja" in r.text and "cleaning" not in r.text
    assert await reminder_outcomes(make_tenant, t2) == ["voicemail"]


async def test_emergency_on_a_reminder_call(make_call, make_tenant) -> None:
    _, call, _ = await outbound(make_call, make_tenant)
    r = await call.say("I'm having chest pain right now")
    assert r.ended and "112" in r.text and r.handoff_to == "9800000002"


async def test_reminders_stay_off_unless_enabled(make_call, make_tenant) -> None:
    t = await make_tenant(patients=[POOJA], appointments=[TOMORROW_CLEANING])
    call = await make_call(clinic_id=t["clinicId"])
    assert await call.api.due_reminders() == []


async def test_a_model_that_folds_book_and_ask_into_one_label_still_books(
    make_call, make_tenant
) -> None:
    """Seen live with sarvam-105b-conversations: "Is my report ready? Also book me a cleaning
    tomorrow" came back as a lone other_request and the booking vanished."""
    from myna_agent.nlu import Intent, ScriptedNLU, Understanding

    t = await make_tenant(patients=[POOJA])
    collapsed = Understanding(
        intent=Intent.other_request,
        language="en",
        confidence=0.95,
        task_category="report_status",
        summary="Wants to know if the X-ray report is ready",
        service_id="cleaning",
    )
    call = await make_call(
        caller_phone=POOJA["phone"], clinic_id=t["clinicId"], nlu=ScriptedNLU([collapsed])
    )
    await call.start()
    await call.say("Is my X-ray report ready? Also book me a cleaning tomorrow at 12")
    r = await call.say("Pooja Malhotra")
    assert r.state == State.CONFIRM and "cleaning" in r.text
    r = await call.say("yes")
    assert r.text.startswith("Done.") and "question for the team" in r.text
    await call.say("yes")
    s = await make_tenant.state(t["clinicId"])
    assert [a["start"] for a in s["appointments"]] == ["2026-10-13T12:00"]
    assert [x["category"] for x in s["tasks"]] == ["report_status"]


async def test_a_plain_message_with_a_day_is_not_turned_into_a_booking(
    make_call, make_tenant
) -> None:
    from myna_agent.nlu import Intent, ScriptedNLU, Understanding

    t = await make_tenant(patients=[POOJA])
    msg = Understanding(
        intent=Intent.other_request,
        language="en",
        confidence=0.95,
        task_category="report_status",
        summary="Asks when the report can be collected",
    )
    call = await make_call(
        caller_phone=POOJA["phone"], clinic_id=t["clinicId"], nlu=ScriptedNLU([msg])
    )
    await call.start()
    r = await call.say("Can I collect my X-ray report tomorrow?")
    assert r.state == State.TAKE_MESSAGE  # a day alone, with no booking word, stays a message
