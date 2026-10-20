"""Regression tests for bugs Hawk found when run against the REAL model (Hawk run 3)."""

from __future__ import annotations

import json
from datetime import date

import pytest
from test_sarvam import FACTS, transport

from myna_agent.conversation import State
from myna_agent.llm.sarvam import SarvamNLU, WithFallback
from myna_agent.nlu import (
    Intent,
    RuleBasedNLU,
    ScriptedNLU,
    TurnContext,
    Understanding,
)

pytestmark = pytest.mark.api


def ctx(expecting: str, lang: str = "hinglish") -> TurnContext:
    return TurnContext(expecting=expecting, today=date(2026, 10, 12), facts=FACTS, language=lang)  # type: ignore[arg-type]


async def test_a_confused_model_does_not_stop_a_goodbye() -> None:
    """ "Nahi, bas. Thank you." after "anything else?" came back as a new FAQ question."""
    confused = json.dumps(
        {"intent": "faq", "language": "en", "confidence": 0.9, "faq_id": "timings"}
    )
    nlu = WithFallback(SarvamNLU("k", transport=transport(confused)), RuleBasedNLU())
    u = await nlu.understand("Nahi, bas. Thank you.", ctx("anything_else"))
    assert u.intent in (Intent.no, Intent.goodbye)


async def test_the_model_still_wins_when_it_is_not_confused() -> None:
    body = json.dumps({"intent": "emergency", "language": "en", "confidence": 0.9})
    nlu = WithFallback(SarvamNLU("k", transport=transport(body)), RuleBasedNLU())
    u = await nlu.understand("no thanks, but my father cannot breathe", ctx("anything_else", "en"))
    assert u.intent == Intent.emergency


async def test_a_hint_copied_from_an_earlier_turn_cannot_wipe_the_slot_being_confirmed(
    make_call,
) -> None:
    """At 'Shall I book it?' the live model answered 'Haan ji' with date_text copied from an
    earlier turn. That reset the draft and the next step crashed (HTTP 500)."""

    def yes_with_stale_hint(text, context):
        return Understanding(
            intent=Intent.yes,
            language="hinglish",
            confidence=0.95,
            date_text="kal subah",
            time_text="11 baje",
        )

    call = await make_call(caller_phone="9822200123")
    await call.start()
    await call.say("Mujhe cleaning ka appointment chahiye kal subah 11 baje")
    await call.say("Neha Kapoor")
    r = await call.say("15 March 1992")
    assert r.state == State.CONFIRM
    call.conv.nlu = ScriptedNLU([yes_with_stale_hint])
    r = await call.say("Haan ji")
    assert r.text.startswith(("Ho gaya", "Done")), r.text


async def test_an_unexpected_bug_becomes_a_handoff_not_a_dead_line(make_call) -> None:
    call = await make_call()
    await call.start()

    async def boom(*_a, **_k):
        raise RuntimeError("simulated bug")

    call.conv._on_intent = boom  # type: ignore[method-assign]
    r = await call.say("I want to book a cleaning")
    assert r.ended and r.handoff_to is not None
    ends = [e for e in await call.events() if e["type"] == "end"]
    assert ends[-1]["handoffReason"] == "tool_failure"


async def test_hinglish_words_veto_a_switch_to_english(make_call) -> None:
    call = await make_call(caller_phone="9822200456")
    await call.start()
    await call.say("Mujhe cleaning ka appointment chahiye kal subah 11 baje")
    forced = Understanding(intent=Intent.no, language="en", confidence=0.9)
    call.conv.nlu = ScriptedNLU([forced])
    await call.say("Nahi, bas. Thank you.")
    assert call.conv.lang == "hinglish"


async def test_a_model_yes_does_not_beat_a_plain_no() -> None:
    """The live model heard a 'yes' in 'Nahi, bas. Thank you.' and Myna asked what to book next."""
    yes = json.dumps({"intent": "yes", "language": "en", "confidence": 0.9})
    nlu = WithFallback(SarvamNLU("k", transport=transport(yes)), RuleBasedNLU())
    u = await nlu.understand("Nahi, bas. Thank you.", ctx("anything_else"))
    assert u.intent in (Intent.no, Intent.goodbye)


async def test_a_real_yes_is_left_alone() -> None:
    yes = json.dumps({"intent": "yes", "language": "hinglish", "confidence": 0.9})
    nlu = WithFallback(SarvamNLU("k", transport=transport(yes)), RuleBasedNLU())
    assert (await nlu.understand("haan ji", ctx("confirm"))).intent == Intent.yes


async def test_a_slow_model_is_cut_off_and_rules_answer_in_time() -> None:
    """Hawk run 5: a rate-limited model call hung past 20 s. The budget bounds it."""
    import time

    import httpx

    from myna_agent.llm.sarvam import NLU_STATS

    async def slow(request: httpx.Request) -> httpx.Response:
        import asyncio

        await asyncio.sleep(5)
        return httpx.Response(200, json={})

    before = NLU_STATS["fallbacks"]
    nlu = WithFallback(
        SarvamNLU("k", transport=httpx.MockTransport(slow)), RuleBasedNLU(), deadline_s=0.2
    )
    started = time.perf_counter()
    u = await nlu.understand("I want to cancel my appointment", ctx("intent", "en"))
    assert time.perf_counter() - started < 1.5
    assert u.intent == Intent.cancel and NLU_STATS["fallbacks"] - before == 1
