"""The call as an explicit state machine (CLAUDE.md, Part 1).

Inbound:  GREETING → IDENTIFY_INTENT → VERIFY_PATIENT
          → (BOOK | RESCHEDULE | CANCEL | FAQ | TAKE_MESSAGE | HANDOFF) → CONFIRM → CLOSE
          (ANYTHING_ELSE loops back to IDENTIFY_INTENT)
Outbound: DIAL → IDENTITY_CHECK → REMIND
          → (CONFIRM_ATTENDANCE | RESCHEDULE | CANCEL | NO_ANSWER / VOICEMAIL) → CLOSE

Per caller turn, in this order:
  1. hard safety checks in code (emergency → 112/108 + handoff; "staff" → handoff)
  2. NLU → Understanding (the only thing the LLM decides)
  3. LLM-flagged emergency / medical question / frustration
  4. understanding failures (2 in a row → handoff)
  5. dispatch on what Myna last asked (`expecting`)
Every schedule read or write goes through the API's tools; nothing is written without a
read-back and an explicit yes.
"""

from __future__ import annotations

import logging
import re
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from enum import StrEnum
from typing import Any, Literal
from zoneinfo import ZoneInfo

from . import contracts as c
from . import i18n, safety
from .dates import DateRef, TimeRef, parse_date, parse_time
from .i18n import Lang, line
from .nlu import (
    NLU,
    ClinicFacts,
    Expecting,
    Intent,
    TurnContext,
    Understanding,
    detect_language,
    mentions_booking,
)
from .text import has_devanagari, normalize
from .tools import ApiClient, ToolError

log = logging.getLogger("myna.conversation")

MAX_FAILED_UNDERSTANDING = 2
#: The same question this many times in a row means we are stuck: hand over to a person.
MAX_SAME_QUESTION = 3
MAX_OFFERS = 3

# Evidence that a caller is speaking English rather than giving a bare name, date or number.
_ENGLISH_FUNCTION_WORDS = frozenset(
    [
        "i",
        "i'm",
        "i'd",
        "my",
        "me",
        "you",
        "your",
        "the",
        "a",
        "an",
        "is",
        "are",
        "was",
        "to",
        "for",
        "of",
        "and",
        "on",
        "at",
        "in",
        "it",
        "can",
        "could",
        "would",
        "want",
        "need",
        "like",
        "please",
        "what",
        "which",
        "when",
        "where",
        "how",
        "do",
        "does",
        "not",
        "no",
        "yes",
        "this",
        "that",
    ]
)


class State(StrEnum):
    GREETING = "GREETING"
    IDENTIFY_INTENT = "IDENTIFY_INTENT"
    VERIFY_PATIENT = "VERIFY_PATIENT"
    BOOK = "BOOK"
    RESCHEDULE = "RESCHEDULE"
    CANCEL = "CANCEL"
    FAQ = "FAQ"
    TAKE_MESSAGE = "TAKE_MESSAGE"
    CONFIRM = "CONFIRM"
    ANYTHING_ELSE = "ANYTHING_ELSE"
    HANDOFF = "HANDOFF"
    CLOSE = "CLOSE"
    # outbound reminders
    DIAL = "DIAL"
    IDENTITY_CHECK = "IDENTITY_CHECK"
    REMIND = "REMIND"
    CONFIRM_ATTENDANCE = "CONFIRM_ATTENDANCE"
    NO_ANSWER = "NO_ANSWER"
    VOICEMAIL = "VOICEMAIL"


Goal = Literal["book", "reschedule", "cancel"]

# Text-mode stand-ins for telephony events on reminder calls (Hawk sends these).
NO_ANSWER_MARKER = "[no answer]"
VOICEMAIL_MARKER = "[voicemail]"


@dataclass
class Reply:
    text: str
    state: State
    language: Lang
    ended: bool = False
    handoff_to: str | None = None
    #: What Myna is waiting for. Hawk's scripted patients use it; the UI can too.
    expecting: str = "intent"


@dataclass
class MessageDraft:
    """Flow (b): a message for staff being collected."""

    category: str = "other"
    request: str | None = None
    callback_number: str | None = None
    number_confirmed: bool = False
    asked_dob: bool = False


@dataclass
class Identity:
    name: str | None = None
    dob: date | None = None
    phone: str | None = None
    third_party: bool = False
    verification_id: str | None = None
    patient_name: str | None = None
    failed_attempts: int = 0
    tried: set[tuple[str, str]] = field(default_factory=set)

    @property
    def verified(self) -> bool:
        return self.verification_id is not None


@dataclass
class Draft:
    goal: Goal | None = None
    service_id: str | None = None
    resource_id: str | None = None
    date_ref: DateRef | None = None
    time_ref: TimeRef | None = None
    offered: list[c.Slot] = field(default_factory=list)
    chosen: c.Slot | None = None
    appointments: list[c.Appointment] | None = None
    target: c.Appointment | None = None
    idempotency_key: str | None = None
    new_patient: bool = False


def _quotes(hint: str | None, text: str) -> bool:
    """Is `hint` (a model-extracted span) actually something the caller just said?"""
    if not hint or not hint.strip():
        return False
    return normalize(hint) in normalize(text)


def _d(local_dt: str) -> date:
    return date.fromisoformat(local_dt[:10])


def _hhmm(local_dt: str) -> str:
    return local_dt[11:16]


class Conversation:
    def __init__(
        self,
        *,
        api: ApiClient,
        nlu: NLU,
        config: c.BusinessConfig,
        call_id: str,
        caller_phone: str | None = None,
        now: Callable[[], datetime] | None = None,
    ) -> None:
        self.api = api
        self.nlu = nlu
        self.config = config
        self.call_id = call_id
        self.caller_phone = caller_phone
        zone = ZoneInfo(config.timezone)
        # Clinic-local wall clock: the server may run in UTC, the clinic doesn't.
        self._now = now or (lambda: datetime.now(zone).replace(tzinfo=None))
        self.mode: Literal["inbound", "outbound"] = "inbound"
        self.reminder: c.DueReminder | None = None
        self.reminder_outcome: str | None = None
        self.message: MessageDraft | None = None
        self.pending_message: MessageDraft | None = None
        self.lang: Lang = config.greeting_language.value  # type: ignore[assignment]
        self.state = State.GREETING
        self.expecting: Expecting = "intent"
        self.identity = Identity()
        self.draft = Draft()
        self.failed_understanding = 0
        self.ended = False
        self.outcomes: list[str] = []
        self.handoff_reason: str | None = None
        self.transcript: list[tuple[str, str]] = []
        self._offer_booking_next = False
        self._pending_end: str | None = None
        self._same_question = 1
        self.facts = ClinicFacts(
            services={
                s.id: [
                    s.name.lower(),
                    s.id.replace("-", " "),
                    *(v.lower() for v in s.spoken.values()),
                ]
                for s in config.services
            },
            resources={
                r.id: [r.name.lower(), r.name.lower().replace("dr. ", "").replace("dr ", ""), r.id]
                for r in config.resources
            },
            faqs={f.id: f.question for f in config.faq},
        )

    # ================================================================ public

    async def start(self) -> Reply:
        return await self._finish(await self._start())

    async def handle(self, text: str) -> Reply:
        if self.ended:
            # Never resume a flow after an emergency, handoff or goodbye.
            key = "emergency" if self.handoff_reason == "emergency" else "call_over"
            return Reply(
                line(key, self.lang),
                self.state,
                self.lang,
                ended=True,
                handoff_to=self.config.human_handoff_number if self.handoff_reason else None,
            )
        await self._log_turn("caller", text)
        try:
            reply = await self._handle(text)
        except Exception:
            # A bug must never become a dead line: log it and put a person on the call.
            log.exception("unexpected error on call %s", self.call_id)
            reply = await self._handoff("tool_failure", line("handoff", self.lang))
        return await self._finish(reply)

    async def _finish(self, reply: Reply) -> Reply:
        """Every agent reply is logged exactly once, then the end of the call if it ended."""
        reply = await self._break_loops(reply)
        await self._log_turn("agent", reply.text)
        if self._pending_end is not None:
            await self._log_end(self._pending_end)
            self._pending_end = None
        return reply

    async def _break_loops(self, reply: Reply) -> Reply:
        """A safety net for ANY understanding failure (model or rules): if Myna is about to ask
        the exact same thing a third time running, she isn't making progress. Hand over."""
        last_agent = next((t for s, t in reversed(self.transcript) if s == "agent"), None)
        if reply.ended or last_agent != reply.text:
            self._same_question = 1
            return reply
        self._same_question += 1
        if self._same_question < MAX_SAME_QUESTION:
            return reply
        log.warning("same question asked %d times; handing off", self._same_question)
        return await self._handoff("repeated_misunderstanding", line("handoff_confused", self.lang))

    async def _start(self) -> Reply:
        clinic = self.config.spoken_name.get(self.lang) or self.config.name
        if self.config.kill_switch:
            return await self._handoff("kill_switch", line("kill_switch", self.lang, clinic=clinic))
        recording = line("recording_on", self.lang) if self.config.record_calls else ""
        self.state = State.IDENTIFY_INTENT
        self.expecting = "intent"
        return await self._say(line("greeting", self.lang, clinic=clinic, recording=recording))

    async def _handle(self, text: str) -> Reply:
        if self.mode == "outbound" and self.state == State.DIAL:
            marker = text.strip().lower()
            if marker == NO_ANSWER_MARKER:
                return await self._end_reminder("no_answer", State.NO_ANSWER, "")
            if marker == VOICEMAIL_MARKER:
                return await self._end_reminder(
                    "voicemail", State.VOICEMAIL, self._reminder_line("outbound_voicemail")
                )
        taking_message = self.expecting == "message"

        # 1. Hard rules, in code, before any model.
        flags = safety.check(text)
        self._update_language(text, detect_language(text))
        if flags.emergency:
            return await self._emergency(f"caller said: {flags.emergency}")
        if flags.wants_human and not taking_message:
            return await self._handoff("caller_asked", line("handoff", self.lang))
        if flags.opt_out and self.mode == "outbound":
            return await self._end_reminder("opted_out", State.CLOSE, line("opted_out", self.lang))

        # 2. Understand.
        u = await self._understand(text)

        # 3. Model-flagged safety.
        if u is not None:
            self._update_language(text, u.language)
            if u.intent == Intent.emergency:
                return await self._emergency("model flagged an emergency")
            if u.intent == Intent.talk_to_human and not taking_message:
                return await self._handoff("caller_asked", line("handoff", self.lang))
            if u.intent == Intent.opt_out and self.mode == "outbound":
                return await self._end_reminder(
                    "opted_out", State.CLOSE, line("opted_out", self.lang)
                )
            if u.frustrated:
                return await self._handoff("frustrated", line("handoff", self.lang))
        medical = flags.medical or (u is not None and u.intent == Intent.medical_question)
        if medical and not taking_message:
            # Redirect, then carry on. (While taking a message, Myna only writes it down:
            # passing a question to the doctor is fine; answering it is not.)
            return await self._say(f"{line('medical', self.lang)} {self._reprompt()}")

        # 4. Did we understand? (The optional date of birth for a message takes any answer:
        #    "I don't know it" is fine there.)
        optional_answer = self.message is not None and self.expecting == "dob"
        unclear = u is None or u.intent == Intent.unclear or u.confidence < 0.5
        if unclear and not optional_answer:
            return await self._not_understood()
        if u is None:  # only reachable for an optional answer: carry on without it
            assert self.message is not None
            self.message.asked_dob = True
            return await self._advance_message()
        self.failed_understanding = 0

        # 5. Dispatch on what we asked.
        return await self._dispatch(u, text)

    # ================================================================ dispatch

    async def _dispatch(self, u: Understanding, text: str) -> Reply:
        match self.expecting:
            case "identity_who":
                return await self._on_identity_who(u)
            case "attendance":
                return await self._on_attendance(u, text)
            case "message":
                return await self._on_message_text(u, text)
            case "callback_confirm":
                return await self._on_callback_confirm(u)
        if self.mode == "outbound" and self.state == State.IDENTITY_CHECK:
            return await self._outbound_verify(u)
        if self.message is not None and self.expecting in ("name", "dob", "phone"):
            if self.expecting == "phone":
                if not u.phone:
                    return await self._not_understood()
                self.message.callback_number, self.message.number_confirmed = u.phone, False
            self._absorb(u, text)
            if self.expecting == "dob" and u.dob is None:
                self.message.asked_dob = True  # "I don't know it" is a fine answer here
            return await self._advance_message()
        if self.expecting in ("intent", "anything_else"):
            return await self._on_intent(u, text)
        if u.intent == Intent.goodbye and self.draft.goal is None:
            return await self._close()

        self._absorb(u, text)
        match self.expecting:
            case "confirm":
                return await self._on_confirm(u, text)
            case "choice":
                return await self._on_choice(u, text)
            case "appointment":
                return await self._on_appointment_choice(u, text)
            case _:
                return await self._advance()

    async def _on_intent(self, u: Understanding, text: str) -> Reply:
        if self._offer_booking_next:
            self._offer_booking_next = False
            if u.intent == Intent.yes:
                self.draft = Draft(goal="book")
                return await self._advance()
        if u.intent in (Intent.goodbye, Intent.no) and self.expecting == "anything_else":
            return await self._close()
        if u.intent == Intent.goodbye:
            return await self._close()
        if u.intent == Intent.yes and self.expecting == "anything_else":
            return await self._ask("intent", line("ask_intent", self.lang))
        if u.intent == Intent.faq:
            return await self._answer_faq(u.faq_id)
        if u.intent == Intent.other_request:
            request = u.summary or text.strip()
            category = u.task_category or "other"
            if not self._also_wants_booking(u, text):
                return await self._start_message(category, request)
            # The model folded "book X, and also ask Y" into one label (seen live with
            # sarvam-105b-conversations). Don't lose the booking: book first, Y waits its turn.
            self.pending_message = MessageDraft(category=category, request=request[:200])
            u = u.model_copy(update={"intent": Intent.book})
        elif u.secondary_category:
            # "Book a cleaning, and is my report ready?" — the question waits its turn.
            self.pending_message = MessageDraft(
                category=u.secondary_category, request=(u.summary or text.strip())[:200]
            )

        goal: Goal | None = {
            Intent.book: "book",
            Intent.reschedule: "reschedule",
            Intent.cancel: "cancel",
        }.get(u.intent)  # type: ignore[assignment]
        if goal is None and u.intent == Intent.provide_info and (u.service_id or u.date_text):
            goal = "book"
        if goal is None:
            return await self._not_understood()

        self.draft = Draft(goal=goal)
        self._absorb(u, text)
        return await self._advance()

    def _also_wants_booking(self, u: Understanding, text: str) -> bool:
        """A message request that ALSO books: a booking word, plus a service, day or time.
        Needing both keeps "can I collect my report tomorrow?" a plain message."""
        names_when = (
            u.service_id is not None
            or parse_date(text, self._today()) is not None
            or parse_time(text) is not None
        )
        return mentions_booking(text) and names_when

    # ================================================================ slot filling

    def _absorb(self, u: Understanding, text: str) -> None:
        """Take whatever the caller just told us. Later mentions overwrite earlier ones."""
        ident = self.identity
        if not ident.verified:
            if u.third_party:
                ident.third_party = True
            if u.name:
                ident.name = u.name
            if u.dob:
                ident.dob = u.dob
        if u.phone:
            ident.phone = u.phone
        d = self.draft
        if self.expecting in ("name", "dob", "phone"):
            # "Kiran Rao" is a patient, not a request for Dr. Rao.
            return
        if u.service_id and u.service_id in self.facts.services and d.goal == "book":
            if u.service_id != d.service_id:
                d.offered, d.chosen = [], None
            d.service_id = u.service_id
        if (
            u.resource_id
            and u.resource_id in self.facts.resources
            and d.goal in ("book", "reschedule")
        ):
            if u.resource_id != d.resource_id:
                d.offered, d.chosen = [], None
            d.resource_id = u.resource_id
        if d.goal in ("book", "reschedule") and self.expecting != "dob":
            # Code parses dates; the model's `date_text` is only a hint of where to look.
            # A hint only counts if it QUOTES what the caller just said. The live model copies
            # dates from earlier turns into `date_text` on a bare "haan ji" (Hawk run 3), which
            # would wipe the slot being confirmed.
            date_hint = u.date_text if _quotes(u.date_text, text) else None
            time_hint = u.time_text if _quotes(u.time_text, text) else None
            date_ref = parse_date(text, self._today()) or (
                parse_date(date_hint, self._today()) if date_hint else None
            )
            time_ref = parse_time(text) or (parse_time(time_hint) if time_hint else None)
            if date_ref and date_ref != d.date_ref:
                d.date_ref, d.offered, d.chosen = date_ref, [], None
            if time_ref and time_ref != d.time_ref:
                d.time_ref, d.offered, d.chosen = time_ref, [], None

    async def _advance(self) -> Reply:
        """Ask for the next missing thing, or move to read-back."""
        d = self.draft
        if d.goal == "book":
            self.state = State.BOOK
            if d.service_id is None:
                return await self._ask("service", self._ask_service())
            if d.chosen is None:
                if d.date_ref is None and (d.time_ref is None or d.time_ref.hour is None):
                    return await self._ask("when", line("ask_when", self.lang))
                return await self._offer(d.service_id, d.resource_id)
            if not self.identity.verified and not d.new_patient:
                prompt = await self._verify_step(allow_new_patient=True)
                if prompt is not None:
                    return prompt
            return await self._confirm_booking()

        if d.goal in ("reschedule", "cancel"):
            self.state = State.RESCHEDULE if d.goal == "reschedule" else State.CANCEL
            if not self.identity.verified:
                prompt = await self._verify_step(allow_new_patient=False)
                if prompt is not None:
                    return prompt
            if d.target is None:
                return await self._pick_appointment()
            if d.goal == "cancel":
                return await self._confirm_cancel()
            if d.chosen is None:
                if d.date_ref is None and (d.time_ref is None or d.time_ref.hour is None):
                    return await self._ask("when", line("ask_new_when", self.lang))
                return await self._offer(d.target.service_id, d.resource_id or d.target.resource_id)
            return await self._confirm_reschedule()

        return await self._ask("intent", line("ask_intent", self.lang))

    # ================================================================ verification (rule 4)

    async def _verify_step(self, *, allow_new_patient: bool) -> Reply | None:
        """Returns a question to ask, or None once verified (or registered as a new patient)."""
        self.state = State.VERIFY_PATIENT
        ident = self.identity
        if ident.name is None:
            key = "ask_name_third_party" if ident.third_party else "ask_name"
            return await self._ask("name", line(key, self.lang))

        if await self._try_verify():
            return None

        if ident.dob is None:
            return await self._ask("dob", line("ask_dob", self.lang))

        # Name + DOB didn't match anyone.
        if allow_new_patient:
            phone = ident.phone or self.caller_phone
            if phone is None:
                return await self._ask("phone", line("ask_phone", self.lang))
            self.draft.new_patient = True
            return None
        ident.failed_attempts += 1
        if ident.failed_attempts >= 2:
            return await self._handoff(
                "verification_failed", line("verify_failed_handoff", self.lang)
            )
        ident.name, ident.dob = None, None
        return await self._ask("name", line("verify_failed_retry", self.lang))

    async def _try_verify(self) -> bool:
        """Try each factor we hold, once: name + caller ID, name + spoken phone, name + DOB."""
        ident = self.identity
        if ident.verified:
            return True
        if ident.name is None:
            return False
        attempts: list[tuple[str, dict[str, Any]]] = []
        if self.caller_phone:
            attempts.append(("caller_phone", {"phone": self.caller_phone}))
        if ident.phone:
            attempts.append(("phone", {"phone": ident.phone}))
        if ident.dob:
            attempts.append(("dob", {"dob": ident.dob}))
        for factor, extra in attempts:
            marker = (ident.name.lower(), f"{factor}:{extra}")
            if marker in ident.tried:
                continue
            ident.tried.add(marker)
            result = await self._tool(
                "find_patient",
                c.FindPatientInput(call_id=self.call_id, name=ident.name, **extra),
                c.FindPatientOutput,
            )
            if isinstance(result.root, c.FindPatientOutput1):
                ident.verification_id = result.root.verification_id
                ident.patient_name = result.root.patient.name
                return True
        return False

    # ================================================================ slots

    async def _offer(self, service_id: str, resource_id: str | None) -> Reply:
        d = self.draft
        slots = await self._find_slots(service_id, resource_id, d.date_ref, d.time_ref)
        prefix = ""
        if not slots and d.date_ref is not None:
            # Nothing then: look at the following week instead of a dead end.
            later = DateRef(d.date_ref.end + timedelta(days=1), d.date_ref.end + timedelta(days=7))
            slots = await self._find_slots(service_id, resource_id, later, d.time_ref)
            prefix = line("nothing_then", self.lang) + " "
        if not slots:
            return await self._ask("when", line("no_slots", self.lang))

        want = d.time_ref.as_hhmm() if d.time_ref else None
        exact = next((s for s in slots if want and _hhmm(s.start) == want), None)
        if exact is not None and not prefix:
            d.chosen = exact
            d.offered = [exact]
            return await self._advance_with(
                line("exact_slot", self.lang, when=self._when(exact), doctor=exact.resource_name)
            )
        d.offered = self._spread(slots, want)
        return await self._ask("choice", prefix + self._offer_text())

    def _offer_text(self) -> str:
        """Read the offered slots; say the date once when they all fall on one day."""
        offered = self.draft.offered
        doctor = offered[0].resource_name
        days = {s.start[:10] for s in offered}
        if len(days) == 1 and len(offered) > 1:
            times = i18n.join_options(
                [i18n.say_time(_hhmm(s.start), self.lang) for s in offered], self.lang
            )
            day = i18n.say_date(_d(offered[0].start), self.lang)
            return line("offer_slots_same_day", self.lang, date=day, times=times, doctor=doctor)
        options = i18n.join_options([self._when(s) for s in offered], self.lang)
        return line("offer_slots", self.lang, options=options, doctor=doctor)

    async def _find_slots(
        self,
        service_id: str,
        resource_id: str | None,
        date_ref: DateRef | None,
        time_ref: TimeRef | None,
    ) -> list[c.Slot]:
        today = self._today()
        start = date_ref.start if date_ref else today
        end = date_ref.end if date_ref else today + timedelta(days=6)
        pod = time_ref.part_of_day if time_ref and time_ref.hour is None else None
        if time_ref and time_ref.hour is not None:
            pod = (
                "morning"
                if time_ref.hour < 12
                else "afternoon"
                if time_ref.hour < 17
                else "evening"
            )
        out = await self._tool(
            "find_slots",
            c.FindSlotsInput(
                service_id=service_id,
                resource_id=resource_id,
                date_from=start,
                date_to=end,
                part_of_day=c.PartOfDay(pod) if pod else None,
                limit=20,
            ),
            c.FindSlotsOutput,
        )
        return out.slots

    @staticmethod
    def _spread(slots: list[c.Slot], want: str | None) -> list[c.Slot]:
        """Up to 3 options: nearest to the wanted time, else spaced at least an hour apart."""
        if want:

            def gap(s: c.Slot) -> int:
                h, m = (int(x) for x in want.split(":"))
                sh, sm = (int(x) for x in _hhmm(s.start).split(":"))
                return abs((sh * 60 + sm) - (h * 60 + m)) + (
                    0 if s.start[:10] == slots[0].start[:10] else 10_000
                )

            return sorted(sorted(slots, key=gap)[:MAX_OFFERS], key=lambda s: s.start)
        picked: list[c.Slot] = []
        for s in slots:
            if (
                not picked
                or (s.start[:10] != picked[-1].start[:10])
                or _minutes(s.start) - _minutes(picked[-1].start) >= 60
            ):
                picked.append(s)
            if len(picked) == MAX_OFFERS:
                break
        return picked or slots[:MAX_OFFERS]

    async def _on_choice(self, u: Understanding, text: str) -> Reply:
        d = self.draft
        if not d.offered:  # a new date/time was given: search again
            return await self._advance()
        chosen: c.Slot | None = None
        if u.option_number and 1 <= u.option_number <= len(d.offered):
            chosen = d.offered[u.option_number - 1]
        if chosen is None and (t := parse_time(text)) and t.hour is not None:
            chosen = next((s for s in d.offered if _hhmm(s.start) == t.as_hhmm()), None)
        if chosen is None and u.intent == Intent.yes and len(d.offered) == 1:
            chosen = d.offered[0]
        if chosen is None:
            return await self._not_understood()
        d.chosen = chosen
        return await self._advance()

    # ================================================================ existing appointments

    async def _pick_appointment(self) -> Reply:
        d = self.draft
        if d.appointments is None:
            out = await self._tool(
                "list_appointments",
                c.ListAppointmentsInput(verification_id=self.identity.verification_id),
                c.ListAppointmentsOutput,
            )
            d.appointments = out.appointments
        name = self.identity.patient_name or ""
        if not d.appointments:
            self.draft = Draft()
            self._offer_booking_next = True
            return await self._ask("anything_else", line("no_appointments", self.lang, name=name))
        if len(d.appointments) == 1:
            d.target = d.appointments[0]
            found = line(
                "found_appointment",
                self.lang,
                item=self._item(d.target),
                doctor=d.target.resource_name,
            )
            return await self._advance_with(found)
        options = i18n.join_options([self._item(a) for a in d.appointments], self.lang)
        return await self._ask("appointment", line("which_appointment", self.lang, options=options))

    async def _on_appointment_choice(self, u: Understanding, text: str) -> Reply:
        d = self.draft
        appts = d.appointments or []
        target = None
        if u.option_number and 1 <= u.option_number <= len(appts):
            target = appts[u.option_number - 1]
        if target is None and (ref := parse_date(text, self._today())):
            target = next((a for a in appts if ref.start <= _d(a.start) <= ref.end), None)
        if target is None and u.service_id:
            target = next((a for a in appts if a.service_id == u.service_id), None)
        if target is None:
            return await self._not_understood()
        d.target = target
        # The date in this answer identified the OLD appointment, not the new time.
        d.date_ref, d.time_ref = None, None
        return await self._advance()

    # ================================================================ confirm & commit

    async def _confirm_booking(self) -> Reply:
        d, s = self.draft, self.draft.chosen
        assert s is not None
        d.idempotency_key = d.idempotency_key or f"book-{uuid.uuid4()}"
        name = self.identity.patient_name or self.identity.name or ""
        return await self._ask(
            "confirm",
            line(
                "confirm_book",
                self.lang,
                service=self._service_name(s.service_id),
                name=name,
                doctor=s.resource_name,
                date=i18n.say_date(_d(s.start), self.lang),
                time=i18n.say_time(_hhmm(s.start), self.lang),
            ),
            state=State.CONFIRM,
        )

    async def _confirm_reschedule(self) -> Reply:
        d = self.draft
        assert d.target is not None and d.chosen is not None
        d.idempotency_key = d.idempotency_key or f"resched-{uuid.uuid4()}"
        return await self._ask(
            "confirm",
            line(
                "confirm_reschedule",
                self.lang,
                name=self.identity.patient_name or "",
                service=self._service_name(d.target.service_id),
                doctor=d.chosen.resource_name,
                old_date=i18n.say_date(_d(d.target.start), self.lang),
                old_time=i18n.say_time(_hhmm(d.target.start), self.lang),
                date=i18n.say_date(_d(d.chosen.start), self.lang),
                time=i18n.say_time(_hhmm(d.chosen.start), self.lang),
            ),
            state=State.CONFIRM,
        )

    async def _confirm_cancel(self) -> Reply:
        d = self.draft
        assert d.target is not None
        d.idempotency_key = d.idempotency_key or f"cancel-{uuid.uuid4()}"
        return await self._ask(
            "confirm",
            line(
                "confirm_cancel",
                self.lang,
                name=self.identity.patient_name or "",
                service=self._service_name(d.target.service_id),
                doctor=d.target.resource_name,
                date=i18n.say_date(_d(d.target.start), self.lang),
                time=i18n.say_time(_hhmm(d.target.start), self.lang),
            ),
            state=State.CONFIRM,
        )

    async def _on_confirm(self, u: Understanding, text: str) -> Reply:
        d = self.draft
        changed_when = bool(parse_date(text, self._today()) or parse_time(text))
        if d.goal in ("book", "reschedule") and changed_when and u.intent != Intent.yes:
            # A correction ("Wednesday... nahi, Tuesday"): already absorbed; search again.
            d.offered, d.chosen, d.idempotency_key = [], None, None
            return await self._advance()
        if u.intent == Intent.yes:
            return await self._commit()
        if u.intent == Intent.no:
            if d.goal == "cancel" and self.mode == "outbound" and d.target is not None:
                target = d.target
                self.draft = Draft(target=target)
                return await self._ask("attendance", self._remind_text(target), state=State.REMIND)
            if d.goal == "cancel":
                self.draft = Draft()
                return await self._ask(
                    "anything_else", f"{line('kept', self.lang)} {line('anything_else', self.lang)}"
                )
            d.offered, d.chosen, d.idempotency_key = [], None, None
            d.date_ref, d.time_ref = None, None
            return await self._ask("when", line("change_what", self.lang))
        if u.intent == Intent.provide_info and d.chosen is None:
            return await self._advance()
        return await self._ask("confirm", line("confirm_yes_no", self.lang), state=State.CONFIRM)

    async def _commit(self) -> Reply:
        d = self.draft
        try:
            if d.goal == "book":
                return await self._commit_book()
            if d.goal == "reschedule":
                return await self._commit_reschedule()
            if d.goal == "cancel":
                return await self._commit_cancel()
        except ToolError as e:
            if e.code == "SLOT_UNAVAILABLE" and d.goal in ("book", "reschedule"):
                d.offered, d.chosen, d.idempotency_key = [], None, None
                taken = line("slot_taken", self.lang)
                reply = await self._advance()
                reply.text = f"{taken} {reply.text}"
                return reply
            log.warning("commit failed: %s", e)
            return await self._handoff("tool_failure", line("handoff", self.lang))
        return await self._ask("intent", line("ask_intent", self.lang))

    async def _commit_book(self) -> Reply:
        d, s, ident = self.draft, self.draft.chosen, self.identity
        if s is None or d.idempotency_key is None:  # nothing confirmed to commit: ask again
            return await self._advance()
        body = c.BookInput(
            idempotency_key=d.idempotency_key,
            call_id=self.call_id,
            service_id=s.service_id,
            resource_id=s.resource_id,
            start=s.start,
            verification_id=ident.verification_id,
            new_patient=None
            if ident.verified
            else c.NewPatient(
                name=ident.name or "",
                phone=ident.phone or self.caller_phone or "",
                dob=ident.dob,
            ),
        )
        out = await self._tool("book", body, c.BookOutput)
        if out.verification_id:
            ident.verification_id = out.verification_id
            ident.patient_name = ident.patient_name or ident.name
        await self._sms(out.appointment.id)
        self.outcomes.append("booked")
        name = ident.patient_name or ident.name or ""
        a = out.appointment
        done = line(
            "booked",
            self.lang,
            name=name,
            doctor=a.resource_name,
            date=i18n.say_date(_d(a.start), self.lang),
            time=i18n.say_time(_hhmm(a.start), self.lang),
        )
        self.draft = Draft()
        return await self._after_done(done)

    async def _commit_reschedule(self) -> Reply:
        d = self.draft
        if d.target is None or d.chosen is None or d.idempotency_key is None:
            return await self._advance()
        out = await self._tool(
            "reschedule",
            c.RescheduleInput(
                idempotency_key=d.idempotency_key,
                verification_id=self.identity.verification_id or "",
                appointment_id=d.target.id,
                new_start=d.chosen.start,
                new_resource_id=d.chosen.resource_id
                if d.chosen.resource_id != d.target.resource_id
                else None,
            ),
            c.RescheduleOutput,
        )
        await self._sms(out.appointment.id)
        self.outcomes.append("rescheduled")
        a = out.appointment
        done = line(
            "rescheduled",
            self.lang,
            doctor=a.resource_name,
            date=i18n.say_date(_d(a.start), self.lang),
            time=i18n.say_time(_hhmm(a.start), self.lang),
        )
        self.draft = Draft()
        return await self._after_done(done)

    async def _commit_cancel(self) -> Reply:
        d = self.draft
        if d.target is None or d.idempotency_key is None:
            return await self._advance()
        await self._tool(
            "cancel",
            c.CancelInput(
                idempotency_key=d.idempotency_key,
                verification_id=self.identity.verification_id or "",
                appointment_id=d.target.id,
            ),
            c.CancelOutput,
        )
        self.outcomes.append("cancelled")
        self.draft = Draft()
        return await self._after_done(line("cancelled", self.lang))

    async def _sms(self, appointment_id: str) -> None:
        if not self.identity.verification_id:
            return
        try:
            await self._tool(
                "send_sms_confirmation",
                c.SendSmsConfirmationInput(
                    verification_id=self.identity.verification_id,
                    appointment_id=appointment_id,
                    language=c.Language(self.lang),
                ),
                c.SendSmsConfirmationOutput,
            )
        except ToolError as e:  # an SMS failure must not undo a booking
            log.warning("sms not queued: %s", e)

    async def _after_done(self, done: str) -> Reply:
        """After a completed action: end a reminder call, take a pending message, or ask
        whether there's anything else."""
        if self.mode == "outbound":
            outcome = self.outcomes[-1] if self.outcomes else "confirmed"
            return await self._end_reminder(
                outcome, State.CLOSE, f"{done} {line('outbound_confirmed', self.lang)}"
            )
        if self.pending_message is not None:
            pending, self.pending_message = self.pending_message, None
            reply = await self._start_message(pending.category, pending.request)
            reply.text = f"{done} {line('also_message', self.lang)} {reply.text}"
            return reply
        return await self._ask(
            "anything_else", f"{done} {line('anything_else', self.lang)}", state=State.ANYTHING_ELSE
        )

    # ================================================================ flow (b): messages

    async def _start_message(self, category: str, request: str | None) -> Reply:
        self.draft = Draft()
        # "I want to leave a message" says nothing yet; "is my x-ray report ready?" does.
        self.message = MessageDraft(
            category=category, request=request if category != "other" else None
        )
        return await self._advance_message()

    async def _advance_message(self) -> Reply:
        m = self.message
        assert m is not None
        self.state = State.TAKE_MESSAGE
        ident = self.identity
        # 1. Who it's about. Verify if we can; an unverified caller still gets the message taken
        #    (flagged for staff, linked to no one, nothing disclosed).
        if not ident.verified:
            if ident.name is None:
                return await self._ask("name", line("ask_name", self.lang))
            if not await self._try_verify() and ident.dob is None and not m.asked_dob:
                m.asked_dob = True
                return await self._ask("dob", line("ask_dob_message", self.lang))
        # 2. What to pass on.
        if not m.request:
            return await self._ask("message", line("ask_message", self.lang))
        # 3. Where to call back, read back before it's saved.
        if m.callback_number is None:
            m.callback_number = ident.phone or self.caller_phone
        if m.callback_number is None:
            return await self._ask("phone", line("ask_callback_number", self.lang))
        if not m.number_confirmed:
            return await self._ask(
                "callback_confirm",
                line("confirm_callback_number", self.lang, last4=m.callback_number[-4:]),
            )
        return await self._create_task()

    async def _on_message_text(self, u: Understanding, text: str) -> Reply:
        m = self.message
        assert m is not None
        m.request = (u.summary or text).strip()[:200]
        if u.task_category and m.category == "other":
            m.category = u.task_category
        return await self._advance_message()

    async def _on_callback_confirm(self, u: Understanding) -> Reply:
        m = self.message
        assert m is not None
        if u.phone:  # "no, call 98111 00733 instead"
            m.callback_number, m.number_confirmed = u.phone, False
            return await self._advance_message()
        if u.intent == Intent.yes:
            m.number_confirmed = True
            return await self._advance_message()
        if u.intent == Intent.no:
            m.callback_number = None
            return await self._ask("phone", line("ask_callback_number", self.lang))
        return await self._not_understood()

    async def _create_task(self) -> Reply:
        m, ident = self.message, self.identity
        assert m is not None and m.request and m.callback_number
        try:
            out = await self._tool(
                "create_staff_task",
                c.CreateStaffTaskInput(
                    call_id=self.call_id,
                    verification_id=ident.verification_id,
                    caller_name=None if ident.verified else ident.name,
                    category=c.Category(m.category),
                    summary=m.request,
                    urgency=c.Urgency.today,
                    callback_number=m.callback_number,
                ),
                c.CreateStaffTaskOutput,
            )
        except ToolError as e:
            log.warning("task not created: %s", e)
            return await self._handoff("tool_failure", line("handoff", self.lang))
        self.message = None
        self.outcomes.append("message_taken")
        return await self._after_done(
            line("message_taken", self.lang, when=self._callback_when(out.callback_by))
        )

    def _callback_when(self, local_dt: str) -> str:
        day, time = _d(local_dt), i18n.say_time(_hhmm(local_dt), self.lang)
        today = self._today()
        if day == today:
            return line("callback_today", self.lang, time=time)
        if day == today + timedelta(days=1):
            return line("callback_tomorrow", self.lang, time=time)
        return line("callback_on", self.lang, date=i18n.say_date(day, self.lang), time=time)

    # ================================================================ flow (c): reminder calls

    async def start_outbound(self, reminder: c.DueReminder) -> Reply:
        return await self._finish(await self._start_outbound(reminder))

    async def _start_outbound(self, reminder: c.DueReminder) -> Reply:
        self.mode = "outbound"
        self.reminder = reminder
        self.state = State.DIAL
        self.expecting = "identity_who"
        recording = line("recording_on", self.lang) if self.config.record_calls else ""
        # The patient's first name is all that's said until identity is confirmed.
        return await self._say(self._reminder_line("outbound_opening", recording=recording))

    def _reminder_line(self, key: str, **extra: str) -> str:
        first = (self.reminder.patient_name if self.reminder else "").split(" ")[0]
        clinic = self.config.spoken_name.get(self.lang) or self.config.name
        return line(
            key,
            self.lang,
            clinic=clinic,
            first_name=first,
            phone=i18n.say_phone(self.config.phone),
            **extra,
        )

    async def _on_identity_who(self, u: Understanding) -> Reply:
        if u.intent == Intent.wrong_number:
            return await self._end_reminder(
                "wrong_number", State.CLOSE, line("outbound_wrong_number", self.lang)
            )
        if u.family_member or u.intent == Intent.no:
            # Someone else answered: ask for a call back, and say nothing about the visit.
            return await self._end_reminder(
                "reached_family", State.CLOSE, self._reminder_line("outbound_family")
            )
        if u.intent == Intent.yes:
            assert self.reminder is not None
            self.state = State.IDENTITY_CHECK
            self.identity.name = self.reminder.patient_name
            return await self._ask("dob", line("outbound_ask_dob", self.lang))
        return await self._not_understood()

    async def _outbound_verify(self, u: Understanding) -> Reply:
        """Name (confirmed) + full date of birth, checked by the API, before any detail."""
        reminder, ident = self.reminder, self.identity
        assert reminder is not None
        if u.dob is None:
            return await self._not_understood()
        result = await self._tool(
            "find_patient",
            c.FindPatientInput(call_id=self.call_id, name=reminder.patient_name, dob=u.dob),
            c.FindPatientOutput,
        )
        if not isinstance(result.root, c.FindPatientOutput1) or (
            result.root.patient.id != reminder.patient_id
        ):
            ident.failed_attempts += 1
            if ident.failed_attempts >= 2:
                return await self._end_reminder(
                    "not_verified", State.CLOSE, self._reminder_line("outbound_not_verified")
                )
            return await self._ask("dob", line("outbound_dob_retry", self.lang))

        ident.verification_id = result.root.verification_id
        ident.patient_name = result.root.patient.name
        listed = await self._tool(
            "list_appointments",
            c.ListAppointmentsInput(verification_id=ident.verification_id),
            c.ListAppointmentsOutput,
        )
        target = next((a for a in listed.appointments if a.id == reminder.appointment_id), None)
        if target is None:  # cancelled or moved since the list was built: nothing to remind
            return await self._close()
        self.draft = Draft(target=target)
        self.state = State.REMIND
        return await self._ask("attendance", self._remind_text(target))

    def _remind_text(self, a: c.Appointment) -> str:
        return line(
            "outbound_remind",
            self.lang,
            service=self._service_name(a.service_id),
            doctor=a.resource_name,
            date=i18n.say_date(_d(a.start), self.lang),
            time=i18n.say_time(_hhmm(a.start), self.lang),
        )

    async def _on_attendance(self, u: Understanding, text: str) -> Reply:
        target = self.draft.target
        assert target is not None
        if u.intent == Intent.yes:
            return await self._end_reminder(
                "confirmed", State.CONFIRM_ATTENDANCE, line("outbound_confirmed", self.lang)
            )
        # "Can't come, make it Thursday at 11" names a new time: that's a move, not a cancel.
        moving = parse_date(text, self._today()) or parse_time(text)
        if u.intent == Intent.reschedule or moving:
            self.draft = Draft(goal="reschedule", target=target)
            self._absorb(u, text)
            return await self._advance()
        if u.intent == Intent.cancel:
            self.draft = Draft(goal="cancel", target=target)
            return await self._advance()
        if u.intent == Intent.no:
            return await self._ask("attendance", line("outbound_move_or_cancel", self.lang))
        return await self._not_understood()

    async def _end_reminder(self, outcome: str, state: State, text: str) -> Reply:
        if self.reminder is not None:
            try:
                await self._tool(
                    "mark_reminder_outcome",
                    c.MarkReminderOutcomeInput(
                        call_id=self.call_id,
                        appointment_id=self.reminder.appointment_id,
                        outcome=c.Outcome(outcome),
                    ),
                    c.MarkReminderOutcomeOutput,
                )
            except ToolError as e:  # the call still ends politely; staff see the gap
                log.error("reminder outcome not recorded: %s", e)
        self.reminder_outcome = outcome
        self.state = state
        self.ended = True
        if f"reminder:{outcome}" not in self.outcomes:
            self.outcomes.append(f"reminder:{outcome}")
        self._pending_end = ",".join(self.outcomes)
        return Reply(text, state, self.lang, ended=True, expecting="")

    # ================================================================ FAQ, handoff, close

    async def _answer_faq(self, faq_id: str | None) -> Reply:
        self.state = State.FAQ
        entry = next((f for f in self.config.faq if f.id == faq_id), None)
        if entry is None or not entry.answer.strip():
            # Blank on purpose in the config: never guess.
            return await self._handoff("unanswered_question", line("faq_unknown", self.lang))
        return await self._after_done(entry.answer)

    async def _emergency(self, summary: str) -> Reply:
        return await self._handoff("emergency", line("emergency", self.lang), summary=summary)

    async def _handoff(self, reason: str, text: str, summary: str | None = None) -> Reply:
        self.state = State.HANDOFF
        self.handoff_reason = reason
        self.ended = True
        transfer_to = self.config.human_handoff_number
        try:
            out = await self._tool(
                "handoff_to_human",
                c.HandoffToHumanInput(
                    call_id=self.call_id,
                    reason=c.Reason(reason),
                    summary=(summary or self._summary())[:500],
                ),
                c.HandoffToHumanOutput,
            )
            transfer_to = out.transfer_to
        except ToolError as e:  # still transfer: the clinic number comes from config
            log.error("handoff tool failed: %s", e)
        self._pending_end = "handoff"
        return Reply(text, self.state, self.lang, ended=True, handoff_to=transfer_to)

    async def _close(self) -> Reply:
        self.state = State.CLOSE
        self.ended = True
        clinic = self.config.spoken_name.get(self.lang) or self.config.name
        text = line("goodbye", self.lang, clinic=clinic)
        self._pending_end = ",".join(self.outcomes) or "no_action"
        return Reply(text, self.state, self.lang, ended=True)

    # ================================================================ helpers

    async def _understand(self, text: str) -> Understanding | None:
        ctx = TurnContext(
            expecting=self.expecting,
            today=self._today(),
            facts=self.facts,
            language=self.lang,
            options_offered=len(self.draft.offered),
            history=tuple(self.transcript[-8:]),
        )
        try:
            return await self.nlu.understand(text, ctx)
        except Exception:  # a model outage counts as not understanding, never as a crash
            log.exception("NLU failed")
            return None

    async def _not_understood(self) -> Reply:
        self.failed_understanding += 1
        if self.failed_understanding >= MAX_FAILED_UNDERSTANDING:
            return await self._handoff(
                "repeated_misunderstanding", line("handoff_confused", self.lang)
            )
        return await self._say(line("not_understood", self.lang, reprompt=self._reprompt()))

    def _reprompt(self) -> str:
        d = self.draft
        match self.expecting:
            case "name":
                return line("ask_name", self.lang)
            case "dob" if self.mode == "outbound":
                return line("outbound_ask_dob", self.lang)
            case "dob" if self.message is not None:
                return line("ask_dob_message", self.lang)
            case "dob":
                return line("ask_dob", self.lang)
            case "phone":
                return line("ask_phone", self.lang)
            case "service":
                return self._ask_service()
            case "when":
                return line("ask_when", self.lang)
            case "choice" if d.offered:
                return self._offer_text()
            case "appointment" if d.appointments:
                options = i18n.join_options([self._item(a) for a in d.appointments], self.lang)
                return line("which_appointment", self.lang, options=options)
            case "confirm":
                return line("confirm_yes_no", self.lang)
            case "anything_else":
                return line("anything_else", self.lang)
            case "message":
                return line("ask_message", self.lang)
            case "callback_confirm" if self.message and self.message.callback_number:
                return line(
                    "confirm_callback_number",
                    self.lang,
                    last4=self.message.callback_number[-4:],
                )
            case "identity_who":
                return self._reminder_line("outbound_opening", recording="")
            case "attendance" if d.target is not None:
                return self._remind_text(d.target)
        if self.mode == "outbound" and self.state == State.IDENTITY_CHECK:
            return line("outbound_ask_dob", self.lang)
        return line("ask_intent", self.lang)

    async def _ask(self, expecting: Expecting, text: str, state: State | None = None) -> Reply:
        self.expecting = expecting
        if state is not None:
            self.state = state
        return await self._say(text)

    async def _advance_with(self, prefix: str) -> Reply:
        reply = await self._advance()
        reply.text = f"{prefix} {reply.text}"
        return reply

    async def _say(self, text: str) -> Reply:
        return Reply(text, self.state, self.lang, expecting=self.expecting)

    async def _tool(self, name: str, body: Any, out: Any) -> Any:
        return await self.api.tool(name, body, out, log=self)

    def _today(self) -> date:
        return self._now().date()

    def _update_language(self, text: str, candidate: str) -> None:
        """Follow the caller's language. A switch to English needs English words: a name, a
        date ("15 March 1992") or a number is Latin script but no language at all.
        (Findings: M1 #1 for names; Hawk run 2 for dates of birth.)"""
        if has_devanagari(text):
            # Script is a fact, not a judgement: Devanagari is Hindi, whatever the model labels
            # it (Hawk full run: the live model said "hinglish" and Myna answered in Hinglish).
            candidate = "hi"
        if candidate not in self._allowed_languages() or candidate == self.lang:
            return
        if candidate == "en":
            words = set(re.findall(r"[a-z']+", text.lower()))
            # The model sometimes labels "Nahi, bas. Thank you." as English (Hawk run 3): Hinglish
            # words in the caller's own text veto a switch to English.
            if (
                len(words) < 3
                or not words & _ENGLISH_FUNCTION_WORDS
                or detect_language(text) != "en"
            ):
                return
        self.lang = candidate  # type: ignore[assignment]

    def _allowed_languages(self) -> set[str]:
        return {lang.value for lang in self.config.languages}

    def _service_name(self, service_id: str) -> str:
        s = next(s for s in self.config.services if s.id == service_id)
        return s.spoken.get(self.lang) or s.name.lower()

    def _ask_service(self) -> str:
        names = [s.spoken.get(self.lang) or s.name for s in self.config.services[:3]]
        return line("ask_service", self.lang, services=i18n.join_options(names, self.lang))

    def _when(self, s: c.Slot) -> str:
        return (
            f"{i18n.say_date(_d(s.start), self.lang)}, {i18n.say_time(_hhmm(s.start), self.lang)}"
        )

    def _item(self, a: c.Appointment) -> str:
        return line(
            "appointment_item",
            self.lang,
            service=self._service_name(a.service_id),
            date=i18n.say_date(_d(a.start), self.lang),
            time=i18n.say_time(_hhmm(a.start), self.lang),
        )

    def _summary(self) -> str:
        last = [t for s, t in self.transcript if s == "caller"][-2:]
        return " / ".join(last) or "handoff"

    # ---------------------------------------------------------------- call log (never fatal)

    async def _log_turn(self, speaker: str, text: str) -> None:
        self.transcript.append((speaker, text))
        await self._event(
            {
                "type": "turn",
                "speaker": speaker,
                "text": text,
                "language": self.lang,
                "state": self.state.value,
            }
        )

    async def _log_end(self, outcome: str) -> None:
        event: dict[str, Any] = {"type": "end", "outcome": outcome}
        if self.handoff_reason:
            event["handoffReason"] = self.handoff_reason
        await self._event(event)

    async def tool_call(self, tool: str, ok: bool, error_code: str | None, latency_ms: int) -> None:
        event: dict[str, Any] = {
            "type": "tool_call",
            "tool": tool,
            "ok": ok,
            "latencyMs": latency_ms,
        }
        if error_code:
            event["errorCode"] = error_code
        await self._event(event)

    async def _event(self, event: dict[str, Any]) -> None:
        try:
            await self.api.call_event(self.call_id, event)
        except ToolError as e:
            log.warning("call log write failed: %s", e)


def _minutes(local_dt: str) -> int:
    h, m = (int(x) for x in _hhmm(local_dt).split(":"))
    return h * 60 + m
