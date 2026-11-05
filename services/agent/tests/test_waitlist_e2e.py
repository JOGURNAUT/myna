"""Restaurant waitlist: a full evening, a guest waits, a table frees up, the guest is called.

Clock: Monday 12 Oct 2026, 11:00 IST. Tomorrow 8 pm every table is taken (five seeded bookings).
"""

from __future__ import annotations

from datetime import datetime

import pytest

pytestmark = pytest.mark.api

API_NOW_UTC = "2026-10-12T05:30:00Z"
NOW_LOCAL = datetime(2026, 10, 12, 11, 0)

ON = {"outboundReminders": {"enabled": True, "callWindow": {"start": "10:00", "end": "20:00"}}}
# Tuesday has one sitting (8 to 9:30 pm), so five bookings at 8 pm make the day truly full.
_DAY = [{"start": "12:00", "end": "15:00"}, {"start": "19:00", "end": "23:00"}]
HOURS = {d: _DAY for d in ("mon", "wed", "thu", "fri", "sat", "sun")} | {
    "tue": [{"start": "20:00", "end": "21:30"}]
}
EVENING = "2026-10-13T20:00"

GUESTS = [
    {"key": f"g{i}", "name": n, "phone": p}
    for i, (n, p) in enumerate(
        [
            ("Ananya Kulkarni", "9822200401"),
            ("Bilal Khan", "9822200402"),
            ("Chitra Rao", "9822200403"),
            ("Dev Malhotra", "9822200404"),
            ("Esha Gill", "9822200405"),
        ]
    )
]
# five tables, all taken at 8 pm: 1-2 seat two, 3-4 seat four, 5 seats four or six
FULL_EVENING = [
    {
        "key": f"a{i}",
        "patient": f"g{i}",
        "serviceId": svc,
        "resourceId": f"table-{i + 1}",
        "start": EVENING,
    }
    for i, svc in enumerate(["table-2", "table-2", "table-4", "table-4", "table-4"])
]


async def _offers(api):
    due = await api.due_reminders()
    return [d for d in due if d.kind.value == "waitlist_offer"]


async def _full_evening(make_call, make_tenant, phone: str | None = None):
    t = await make_tenant(
        baseClinicId="spice-route",
        config={**ON, "hours": HOURS, "greetingLanguage": "en"},
        patients=GUESTS,
        appointments=FULL_EVENING,
    )
    call = await make_call(caller_phone=phone, clinic_id=t["clinicId"])
    await call.start()
    return t, call


async def _join(make_call, make_tenant, t, who: str, phone: str):
    call = await make_call(caller_phone=phone, clinic_id=t["clinicId"])
    await call.start()
    r = await call.say("table for 2 tomorrow at 8 pm")
    assert "waitlist" in r.text.lower(), r.text
    r = await call.say("yes please")
    r = await call.say(who)
    assert "waitlist" in r.text.lower() and "call" in r.text.lower(), r.text
    return call


async def test_a_full_evening_offers_the_waitlist_and_takes_a_name(make_call, make_tenant) -> None:
    t, _ = await _full_evening(make_call, make_tenant)
    await _join(make_call, make_tenant, t, "Farah Siddiqui", "9822200411")
    state = await make_tenant.state(t["clinicId"])
    assert [a["status"] for a in state["appointments"]].count("confirmed") == 5


async def test_declining_the_waitlist_asks_for_another_day(make_call, make_tenant) -> None:
    _, call = await _full_evening(make_call, make_tenant)
    r = await call.say("table for 2 tomorrow at 8 pm")
    assert "waitlist" in r.text.lower()
    r = await call.say("no")
    assert "another day" in r.text.lower() or "which day" in r.text.lower(), r.text


async def test_a_freed_table_is_held_offered_and_confirmed(make_call, make_tenant) -> None:
    t, _ = await _full_evening(make_call, make_tenant)
    await _join(make_call, make_tenant, t, "Farah Siddiqui", "9822200411")

    # Ananya (table 1, a table for two) cancels with her name and phone.
    canceller = await make_call(caller_phone="9822200401", clinic_id=t["clinicId"])
    await canceller.start()
    await canceller.say("I want to cancel my reservation")
    await canceller.say("Ananya Kulkarni")
    r = await canceller.say("yes")
    assert "cancel" in r.text.lower(), r.text

    # The table is held (pending) for Farah and she is due a call.
    [offer] = await _offers(canceller.api)
    assert offer.kind.value == "waitlist_offer" and offer.patient_name == "Farah Siddiqui"
    state = await make_tenant.state(t["clinicId"])
    held = [a for a in state["appointments"] if a["status"] == "pending"]
    assert len(held) == 1 and held[0]["patientName"] == "Farah Siddiqui"

    # The call: name check by the number we dialled, then the offer; nothing about anyone else.
    call = await make_call(clinic_id=t["clinicId"])
    r = await call.conv.start_outbound(offer)
    assert "Farah" in r.text
    r = await call.say("yes, speaking")
    assert "opened" in r.text and "Table 1" in r.text and "birth" not in r.text.lower(), r.text
    for leak in ("Ananya", "Kulkarni"):
        assert leak not in call.all_text
    r = await call.say("yes please")
    assert r.ended and "confirmed" in r.text.lower(), r.text

    state = await make_tenant.state(t["clinicId"])
    farah = [a for a in state["appointments"] if a["patientName"] == "Farah Siddiqui"]
    assert [a["status"] for a in farah] == ["confirmed"]
    assert await _offers(call.api) == []


async def test_a_declined_table_goes_to_the_next_guest(make_call, make_tenant) -> None:
    t, _ = await _full_evening(make_call, make_tenant)
    await _join(make_call, make_tenant, t, "Farah Siddiqui", "9822200411")
    await _join(make_call, make_tenant, t, "Gita Nambiar", "9822200412")

    canceller = await make_call(caller_phone="9822200401", clinic_id=t["clinicId"])
    await canceller.start()
    await canceller.say("I want to cancel my reservation")
    await canceller.say("Ananya Kulkarni")
    await canceller.say("yes")

    [first] = await _offers(canceller.api)
    assert first.patient_name == "Farah Siddiqui"  # first come, first served
    call = await make_call(clinic_id=t["clinicId"])
    await call.conv.start_outbound(first)
    await call.say("yes, speaking")
    r = await call.say("no thanks")
    assert r.ended

    [second] = await _offers(canceller.api)
    assert second.patient_name == "Gita Nambiar"
    state = await make_tenant.state(t["clinicId"])
    assert [a["patientName"] for a in state["appointments"] if a["status"] == "pending"] == [
        "Gita Nambiar"
    ]


async def test_nobody_is_held_or_called_while_outbound_calls_are_off(
    make_call, make_tenant
) -> None:
    t = await make_tenant(
        baseClinicId="spice-route",
        config={"hours": HOURS},
        patients=GUESTS,
        appointments=FULL_EVENING,
    )  # outbound off by default
    await _join(make_call, make_tenant, t, "Farah Siddiqui", "9822200411")
    canceller = await make_call(caller_phone="9822200401", clinic_id=t["clinicId"])
    await canceller.start()
    await canceller.say("I want to cancel my reservation")
    await canceller.say("Ananya Kulkarni")
    await canceller.say("yes")
    assert await _offers(canceller.api) == []
    state = await make_tenant.state(t["clinicId"])
    assert [a for a in state["appointments"] if a["status"] == "pending"] == []
