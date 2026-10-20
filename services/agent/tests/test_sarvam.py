"""Sarvam provider against a mocked HTTP transport (no network, no key needed)."""

from __future__ import annotations

import json
from datetime import date

import httpx
import pytest

from myna_agent.llm.sarvam import NLUError, SarvamNLU, WithFallback
from myna_agent.nlu import ClinicFacts, Intent, RuleBasedNLU, TurnContext

FACTS = ClinicFacts(
    services={"cleaning": ["cleaning"], "consultation": ["consultation"]},
    resources={"dr-mehta": ["dr. mehta"]},
    faqs={"timings": "What are the clinic timings?"},
)
CTX = TurnContext(expecting="intent", today=date(2026, 10, 12), facts=FACTS, language="hinglish")


def completion(content: str) -> dict:
    return {
        "choices": [
            {
                "index": 0,
                "finish_reason": "stop",
                "message": {"role": "assistant", "content": content},
            }
        ]
    }


def transport(*contents: str, status: int = 200, seen: list | None = None) -> httpx.MockTransport:
    queue = list(contents)

    def handler(request: httpx.Request) -> httpx.Response:
        if seen is not None:
            seen.append(request)
        if status != 200:
            return httpx.Response(status, json={"error": "nope"})
        return httpx.Response(200, json=completion(queue.pop(0)))

    return httpx.MockTransport(handler)


async def test_parses_a_structured_understanding_and_sends_the_documented_request() -> None:
    seen: list[httpx.Request] = []
    body = {
        "intent": "book",
        "language": "hinglish",
        "confidence": 0.92,
        "service_id": "cleaning",
        "date_text": "kal subah",
    }
    nlu = SarvamNLU(
        "key-123", clinic_name="Smile Dental Care", transport=transport(json.dumps(body), seen=seen)
    )
    u = await nlu.understand("kal subah cleaning karwani hai", CTX)
    assert u.intent == Intent.book and u.service_id == "cleaning" and u.date_text == "kal subah"

    req = seen[0]
    assert req.url.path == "/v1/chat/completions"
    assert req.headers["api-subscription-key"] == "key-123"
    sent = json.loads(req.content)
    assert sent["model"] == "sarvam-105b"
    assert sent["response_format"]["type"] == "json_schema"
    assert "Monday, 12 October 2026" in sent["messages"][0]["content"]
    await nlu.aclose()


async def test_tolerates_fences_around_the_json() -> None:
    fenced = '```json\n{"intent": "yes", "language": "en", "confidence": 0.9}\n```'
    nlu = SarvamNLU("k", transport=transport(fenced))
    assert (await nlu.understand("yes", CTX)).intent == Intent.yes


async def test_drops_ids_the_clinic_does_not_have() -> None:
    body = {
        "intent": "book",
        "language": "en",
        "confidence": 0.9,
        "service_id": "whitening",
        "resource_id": "dr-house",
        "faq_id": "parking",
    }
    nlu = SarvamNLU("k", transport=transport(json.dumps(body)))
    u = await nlu.understand("whitening with dr house", CTX)
    assert (u.service_id, u.resource_id, u.faq_id) == (None, None, None)


async def test_retries_once_on_invalid_output_then_succeeds() -> None:
    good = json.dumps({"intent": "cancel", "language": "en", "confidence": 0.9})
    nlu = SarvamNLU("k", transport=transport("I think they want to cancel", good))
    assert (await nlu.understand("cancel it", CTX)).intent == Intent.cancel


async def test_gives_up_after_the_retry() -> None:
    nlu = SarvamNLU("k", transport=transport('{"intent": "dance"}', "not json"))
    with pytest.raises(NLUError):
        await nlu.understand("hmm", CTX)


async def test_http_errors_fall_back_to_rules() -> None:
    nlu = WithFallback(
        SarvamNLU("k", transport=transport(status=503), retry_base_s=0), RuleBasedNLU()
    )
    u = await nlu.understand("I want to cancel my appointment", CTX)
    assert u.intent == Intent.cancel and nlu.fallbacks == 1


async def test_rate_limits_are_retried_not_silently_downgraded() -> None:
    """A 429 must not turn into a rules-based answer labelled as the model's."""
    from myna_agent.llm.sarvam import NLU_STATS

    good = json.dumps({"intent": "yes", "language": "en", "confidence": 0.9})
    calls = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        calls["n"] += 1
        if calls["n"] <= 2:
            return httpx.Response(429, headers={"retry-after": "0"}, json={"error": "slow down"})
        return httpx.Response(200, json=completion(good))

    before = NLU_STATS["retries"]
    nlu = SarvamNLU("k", transport=httpx.MockTransport(handler), retry_base_s=0)
    assert (await nlu.understand("yes", CTX)).intent == Intent.yes
    assert calls["n"] == 3 and NLU_STATS["retries"] - before == 2


# ---- found by Hawk against the real model: the model left service_id empty ----


def _model_without_entities(intent: Intent = Intent.book) -> str:
    return json.dumps({"intent": intent.value, "language": "hinglish", "confidence": 0.95})


async def test_code_fills_the_service_the_model_left_empty() -> None:
    nlu = WithFallback(
        SarvamNLU("k", transport=transport(_model_without_entities())), RuleBasedNLU()
    )
    u = await nlu.understand("Mujhe cleaning ka appointment chahiye kal subah", CTX)
    assert u.intent == Intent.book  # the model's judgement stands
    assert u.service_id == "cleaning"  # code added the fact it could see


async def test_code_never_overrides_what_the_model_did_extract() -> None:
    body = json.dumps(
        {"intent": "book", "language": "en", "confidence": 0.9, "service_id": "consultation"}
    )
    nlu = WithFallback(SarvamNLU("k", transport=transport(body)), RuleBasedNLU())
    u = await nlu.understand("a cleaning please", CTX)
    assert u.service_id == "consultation"


async def test_code_fills_a_bare_answer_to_the_service_question() -> None:
    ctx = TurnContext(
        expecting="service", today=date(2026, 10, 12), facts=FACTS, language="hinglish"
    )
    nlu = WithFallback(
        SarvamNLU("k", transport=transport(_model_without_entities(Intent.provide_info))),
        RuleBasedNLU(),
    )
    assert (await nlu.understand("cleaning", ctx)).service_id == "cleaning"
