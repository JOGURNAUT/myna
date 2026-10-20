"""Sarvam chat-completions as an NLU provider.

API (docs.sarvam.ai, checked 2026-10-03): POST https://api.sarvam.ai/v1/chat/completions,
header `api-subscription-key`, models `sarvam-105b` / `sarvam-105b-conversations`
(`sarvam-30b` is deprecated), `response_format` supports `json_schema`, `reasoning_effort`
low|high|max. The model only fills an `Understanding`; it never writes a reply.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any

import httpx
from pydantic import ValidationError

from ..nlu import NLU, Understanding, fill_gaps

log = logging.getLogger("myna.llm.sarvam")

#: Process-wide counters, exposed at GET /v1/stats so Hawk can say how many understandings
#: really came from the model and how many silently fell back to rules.
NLU_STATS: dict[str, int] = {"calls": 0, "fallbacks": 0, "retries": 0}

SYSTEM_PROMPT = """You are the language-understanding step of Myna, the phone receptionist for {clinic}, \
a dental clinic in India. Callers speak English, Hindi or Hinglish (Hindi in Latin script), and may switch.

You DO NOT reply to the caller. You only fill a JSON object describing what the caller just said.

Today is {today}. Myna's last question was about: {expecting}.
{options}
Clinic services (use these ids for service_id): {services}
Doctors (use these ids for resource_id): {doctors}
FAQ topics (use these ids for faq_id): {faqs}

Rules:
- intent: book | reschedule | cancel | faq | other_request (reports, refills, bills, call-backs,
  a message for the doctor) | talk_to_human | emergency (any medical emergency, self-harm, accident,
  heavy bleeding, chest pain, breathing trouble, unconsciousness) | medical_question (asks for
  advice, diagnosis or how to take medicines; a REFILL request is other_request, not this) |
  yes | no | provide_info (answers Myna's question) | goodbye | wrong_number | opt_out (does not
  want calls any more) | unclear.
- task_category (for other_request): report_status | medicine_refill_request | billing_question |
  doctor_callback | directions_timings | other. secondary_category: set it when the caller books,
  reschedules or cancels AND also asks something for staff in the same breath.
- summary: for other_request, or when Myna asked what to pass on: one short line in English for
  clinic staff, faithful to what the caller said. Never add advice or answers.
- family_member: on a reminder call, true when the person who answered says they are not the
  patient (a relative, "not at home").
- language: "hi" if Devanagari, "hinglish" if Hindi words in Latin script, else "en".
- Copy the caller's exact words for the day into date_text and for the time into time_text; do not
  convert them. Only set dob when a full date of birth with a year was said.
- name is the PATIENT's name. third_party is true if the caller speaks for someone else.
- option_number: if Myna offered numbered options and the caller picked one (1-based).
- confidence: how sure you are about intent, 0 to 1. Use below 0.5 if the caller was unclear.
- frustrated: true only if the caller is clearly annoyed with Myna.
- Never invent values. Leave fields null when not said."""

_EXPECTING = {
    "intent": "what the caller wants",
    "anything_else": "whether the caller needs anything else",
    "name": "the patient's full name",
    "dob": "the patient's date of birth",
    "phone": "a mobile number",
    "service": "what the visit is for",
    "when": "which day and time suits the caller",
    "choice": "which of the offered times the caller wants",
    "appointment": "which existing appointment the caller means",
    "confirm": "yes or no to confirm the read-back",
    "message": "what to pass on to clinic staff (take the whole utterance as the message)",
    "callback_confirm": "whether the team may call back on the number Myna read out",
    "identity_who": "whether Myna is speaking to the patient (a reminder call)",
    "attendance": "whether the patient will come to the appointment, or wants to move/cancel it",
}

_JSON_OBJECT = re.compile(r"\{.*\}", re.S)


class NLUError(Exception):
    pass


class SarvamNLU:
    def __init__(
        self,
        api_key: str,
        *,
        model: str = "sarvam-105b",
        clinic_name: str = "the clinic",
        base_url: str = "https://api.sarvam.ai",
        timeout: float = 8.0,
        retry_base_s: float = 1.5,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.model = model
        self._retry_base = retry_base_s
        self.clinic_name = clinic_name
        self._http = httpx.AsyncClient(
            base_url=base_url,
            headers={"api-subscription-key": api_key},
            timeout=timeout,
            transport=transport,
        )
        self._schema = Understanding.model_json_schema()

    async def aclose(self) -> None:
        await self._http.aclose()

    def _messages(self, text: str, ctx: Any) -> list[dict[str, str]]:
        facts = ctx.facts
        options = (
            f"Myna just offered {ctx.options_offered} options, numbered in the order she said them."
            if ctx.options_offered
            else ""
        )
        system = SYSTEM_PROMPT.format(
            clinic=self.clinic_name,
            today=ctx.today.strftime("%A, %d %B %Y"),
            expecting=_EXPECTING.get(ctx.expecting, ctx.expecting),
            options=options,
            services=", ".join(f"{k} ({v[0]})" for k, v in facts.services.items()),
            doctors=", ".join(f"{k} ({v[0]})" for k, v in facts.resources.items()),
            faqs=", ".join(f"{k} ({q})" for k, q in facts.faqs.items()) or "none",
        )
        messages = [{"role": "system", "content": system}]
        for speaker, said in ctx.history[-6:]:
            role = "assistant" if speaker == "agent" else "user"
            messages.append({"role": role, "content": said})
        messages.append({"role": "user", "content": text})
        return messages

    async def understand(self, text: str, ctx: Any) -> Understanding:
        last_error: Exception | None = None
        for attempt in range(2):
            try:
                content = await self._complete(self._messages(text, ctx))
                return self._validate(content, ctx)
            except (NLUError, ValidationError, json.JSONDecodeError) as e:
                last_error = e
                log.warning("sarvam understanding attempt %d failed: %s", attempt + 1, e)
        raise NLUError(f"no valid understanding after retry: {last_error}")

    async def _complete(self, messages: list[dict[str, str]]) -> str:
        body = {
            "model": self.model,
            "messages": messages,
            "temperature": 0.1,
            "max_tokens": 600,
            "reasoning_effort": "low",
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": "understanding", "schema": self._schema},
            },
        }
        res = await self._post_with_retry(body)
        choices = res.json().get("choices") or []
        if not choices:
            raise NLUError("no choices in response")
        content = (choices[0].get("message") or {}).get("content") or ""
        if not content.strip():
            raise NLUError("empty content")
        return content

    async def _post_with_retry(self, body: dict[str, Any]) -> httpx.Response:
        """Sarvam's Starter plan allows ~40-60 chat requests a minute. A 429 (or a 5xx) is retried
        with backoff instead of failing the turn, so rate limits don't silently degrade a call
        to the rule-based fallback."""
        last: Exception | None = None
        for attempt in range(4):
            try:
                res = await self._http.post("/v1/chat/completions", json=body)
                if res.status_code == 429 or res.status_code >= 500:
                    wait = (
                        float(res.headers.get("retry-after", 0) or 0)
                        or self._retry_base * 2**attempt
                    )
                    NLU_STATS["retries"] += 1
                    last = httpx.HTTPStatusError(
                        f"HTTP {res.status_code}", request=res.request, response=res
                    )
                    await asyncio.sleep(min(wait, 10))
                    continue
                res.raise_for_status()
                return res
            except httpx.HTTPError as e:
                last = e
                if attempt == 3:
                    break
                await asyncio.sleep(self._retry_base / 3 * 2**attempt)
        raise NLUError(f"sarvam request failed after retries: {last}")

    @staticmethod
    def _validate(content: str, ctx: Any) -> Understanding:
        match = _JSON_OBJECT.search(content)  # tolerate fences or stray text around the JSON
        if match is None:
            raise NLUError("no JSON object in content")
        u = Understanding.model_validate(json.loads(match.group(0)))
        # Ids the clinic doesn't have are dropped, never trusted.
        updates: dict[str, Any] = {}
        if u.service_id and u.service_id not in ctx.facts.services:
            updates["service_id"] = None
        if u.resource_id and u.resource_id not in ctx.facts.resources:
            updates["resource_id"] = None
        if u.faq_id and u.faq_id not in ctx.facts.faqs:
            updates["faq_id"] = None
        if u.option_number and u.option_number > max(ctx.options_offered, 1):
            updates["option_number"] = None
        return u.model_copy(update=updates) if updates else u


class WithFallback:
    """Primary NLU, falling back to another (rules) when the primary fails outright."""

    def __init__(self, primary: NLU, fallback: NLU) -> None:
        self.primary = primary
        self.fallback = fallback
        self.fallbacks = 0

    async def understand(self, text: str, ctx: Any) -> Understanding:
        NLU_STATS["calls"] += 1
        try:
            understood = await self.primary.understand(text, ctx)
            # The model decides what the caller MEANT; code fills in facts it left out.
            return fill_gaps(understood, await self.fallback.understand(text, ctx))
        except Exception:
            self.fallbacks += 1
            NLU_STATS["fallbacks"] += 1
            log.exception("primary NLU failed; using fallback")
            return await self.fallback.understand(text, ctx)
