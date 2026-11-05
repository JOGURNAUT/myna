"""Second vertical: restaurant reservations on the same engine (docs/plan-generalise.md)."""

from __future__ import annotations

ANANYA = {"key": "ananya", "name": "Ananya Kulkarni", "phone": "9822200101"}
ANANYA_TABLE = {
    "key": "a1",
    "patient": "ananya",
    "serviceId": "table-2",
    "resourceId": "table-1",
    "start": "2026-10-13T20:00",
}


async def _call(make_call, make_tenant, phone: str | None = None, **seed):
    t = await make_tenant(baseClinicId="spice-route", **seed)
    call = await make_call(caller_phone=phone, clinic_id=t["clinicId"])
    await call.start()
    return call, t


async def test_book_a_table_for_four_with_name_and_phone_only(make_call, make_tenant) -> None:
    call, t = await _call(make_call, make_tenant)
    r = await call.say("I want a table for 4 tomorrow at 8 pm")
    assert "Table" in r.text and "8 pm" in r.text, r.text
    r = await call.say("Rahul Shah")  # name, not a request for a table called "Shah"
    assert (
        "date of birth" not in r.text.lower() and "phone" in r.text.lower()
    ) or "mobile" in r.text.lower()
    r = await call.say("9822211111")
    assert "Shall I book" in r.text and "Rahul Shah" in r.text, r.text
    r = await call.say("yes")
    assert "booked" in r.text.lower()
    state = await make_tenant.state(t["clinicId"])
    booked = [a for a in state["appointments"] if a["patientName"] == "Rahul Shah"]
    assert len(booked) == 1 and booked[0]["serviceId"] == "table-4"
    # never asked for a date of birth anywhere in the call
    assert "birth" not in call.all_text.lower()


async def test_party_size_picks_a_table_that_seats_them(make_call, make_tenant) -> None:
    call, _ = await _call(make_call, make_tenant)
    await call.say("book a table")
    assert call.conv.expecting == "service"
    r = await call.say("6")
    assert call.conv.draft.service_id == "table-6"
    assert "Table 5" in r.text or "when" in r.text.lower() or "day" in r.text.lower()


async def test_a_party_too_big_for_any_table_goes_to_staff(make_call, make_tenant) -> None:
    call, _ = await _call(make_call, make_tenant)
    r = await call.say("table for 15 people tomorrow")
    assert r.ended and call.conv.handoff_reason == "party_too_large"


async def test_changing_the_party_size_mid_call_keeps_one_booking(make_call, make_tenant) -> None:
    call, t = await _call(make_call, make_tenant, phone="9822233333")
    await call.say("table for 2 tomorrow at 8 pm")
    await call.say("actually we are 4 people")
    assert call.conv.draft.service_id == "table-4"
    await call.say("Nisha Rao")
    r = await call.say("yes")
    assert "booked" in r.text.lower(), r.text
    state = await make_tenant.state(t["clinicId"])
    mine = [a for a in state["appointments"] if a["patientName"] == "Nisha Rao"]
    assert len(mine) == 1 and mine[0]["serviceId"] == "table-4"


async def test_nothing_is_shown_without_the_right_phone(make_call, make_tenant) -> None:
    """Cancelling needs name + the phone the booking was made with (rule 4, restaurant mode)."""
    call, _ = await _call(make_call, make_tenant, patients=[ANANYA], appointments=[ANANYA_TABLE])
    await call.say("I want to cancel my reservation")
    await call.say("Ananya Kulkarni")  # a seeded guest
    r = await call.say("9000000000")  # the wrong phone
    assert "Table" not in r.text and "kulkarni" not in r.text.lower().replace("ananya kulkarni", "")
    assert call.conv.identity.verified is False


async def test_cancel_with_name_and_phone(make_call, make_tenant) -> None:
    call, _ = await _call(make_call, make_tenant, patients=[ANANYA], appointments=[ANANYA_TABLE])
    await call.say("I want to cancel my reservation")
    await call.say("Ananya Kulkarni")
    r = await call.say("9822200101")
    assert "cancel" in r.text.lower(), r.text
    r = await call.say("yes")
    assert "cancelled" in r.text.lower(), r.text


async def test_allergy_question_is_never_answered(make_call, make_tenant) -> None:
    call, _ = await _call(make_call, make_tenant)
    r = await call.say("is the paneer dish safe for my nut allergy?")
    assert "can't advise" in r.text or "salah nahi" in r.text, r.text


async def test_reply_wording_is_the_restaurants(make_call, make_tenant) -> None:
    call, _ = await _call(make_call, make_tenant)
    r = await call.say("mujhe table book karni hai")
    assert "kitne logon" in r.text.lower(), r.text
