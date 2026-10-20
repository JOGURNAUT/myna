"""Regressions for what Hawk's AUDIO mode found: real speech recognition mangles names."""

from __future__ import annotations

import pytest
from test_conversation_e2e import appointments_of

from myna_agent.conversation import State

pytestmark = pytest.mark.api


async def test_a_misheard_name_is_corrected_at_the_read_back(make_call, api) -> None:
    """Saaras heard "Neha Kapoor" as "Deha Kapoor"; the caller objects when it is read back."""
    call = await make_call(caller_phone="9822200555")
    await call.start()
    await call.say("Hi, I'd like to book a cleaning Wednesday at 12 pm")
    await call.say("My name is Deha Kapoor")
    r = await call.say("15 March 1992")
    assert r.state == State.CONFIRM and "Deha Kapoor" in r.text

    r = await call.say("No, the name is Neha Kapoor.")
    assert r.state == State.CONFIRM  # still at the read-back, nothing written yet
    assert "Neha Kapoor" in r.text and "Deha" not in r.text

    r = await call.say("yes please")
    assert r.text.startswith("Done.") and "Neha Kapoor" in r.text
    booked = await appointments_of(api, "Neha Kapoor", phone="9822200555")
    assert len(booked) == 1


async def test_an_ordinary_no_at_the_read_back_is_not_taken_for_a_name(make_call) -> None:
    call = await make_call(caller_phone="9822200556")
    await call.start()
    await call.say("Hi, I'd like to book a cleaning Wednesday at 12 pm")
    await call.say("My name is Karan Bedi")
    await call.say("20 June 1988")
    r = await call.say("no, this is wrong")
    assert "Karan Bedi" not in r.text or r.state != State.CONFIRM or "Wrong" not in r.text
    assert "this is wrong" not in r.text.lower()
