"""Message categories and staff requests are decided by code, not a noisy model (Hawk full run)."""

from __future__ import annotations

import json
from datetime import date

from test_sarvam import FACTS, transport

from myna_agent.llm.sarvam import SarvamNLU, WithFallback
from myna_agent.nlu import Intent, RuleBasedNLU, TurnContext


def ctx(expecting: str) -> TurnContext:
    return TurnContext(
        expecting=expecting,  # type: ignore[arg-type]
        today=date(2026, 10, 12),
        facts=FACTS,
        language="en",
    )


def wrap(body: dict) -> WithFallback:
    return WithFallback(SarvamNLU("k", transport=transport(json.dumps(body))), RuleBasedNLU())


async def test_a_report_question_filed_under_other_gets_its_real_category() -> None:
    nlu = wrap(
        {"intent": "other_request", "language": "en", "confidence": 0.9, "task_category": "other"}
    )
    u = await nlu.understand("is my X-ray report ready?", ctx("message"))
    assert u.task_category == "report_status"


async def test_a_doctor_callback_in_hindi_is_recognised() -> None:
    nlu = wrap(
        {"intent": "provide_info", "language": "hi", "confidence": 0.9, "task_category": "other"}
    )
    u = await nlu.understand("डॉक्टर मेहता से कहिए मुझे कॉल करें, ब्रेसेस का तार ढीला है।", ctx("message"))
    assert u.task_category == "doctor_callback"


async def test_a_specific_category_from_the_model_is_never_overridden() -> None:
    nlu = wrap(
        {
            "intent": "other_request",
            "language": "en",
            "confidence": 0.9,
            "task_category": "billing_question",
        }
    )
    u = await nlu.understand("is my X-ray report ready?", ctx("intent"))
    assert u.task_category == "billing_question"


async def test_a_bill_question_is_a_message_not_an_faq() -> None:
    nlu = wrap({"intent": "faq", "language": "hi", "confidence": 0.9, "faq_id": "insurance"})
    u = await nlu.understand("पिछले महीने के बिल के बारे में सवाल है।", ctx("intent"))
    assert u.intent == Intent.other_request and u.task_category == "billing_question"
    assert u.faq_id is None


async def test_a_real_faq_stays_an_faq() -> None:
    nlu = wrap({"intent": "faq", "language": "en", "confidence": 0.9, "faq_id": "timings"})
    u = await nlu.understand("what are your timings?", ctx("intent"))
    assert u.intent == Intent.faq and u.faq_id == "timings"
