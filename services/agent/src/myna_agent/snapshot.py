"""Conversation <-> JSON, so any agent instance can serve any turn of a call.

The snapshot holds only what a live call needs. The clinic config and the model client are NOT in
it: they are rebuilt from the API, so a deploy that changes either takes effect on the next turn.
`SNAPSHOT_VERSION` guards against resurrecting a state an older/newer build can't read.
"""

from __future__ import annotations

from dataclasses import asdict
from datetime import date
from typing import Any, cast

from . import contracts as c
from .conversation import Conversation, Draft, Identity, MessageDraft, State
from .dates import DateRef, TimeRef

SNAPSHOT_VERSION = 1

Json = dict[str, Any]


class IncompatibleSnapshot(Exception):
    """The stored state was written by an incompatible build. Callers must start over, not crash."""


def _model(m: Any) -> Json | None:
    return None if m is None else cast("Json", m.model_dump(mode="json", by_alias=True))


def _date_ref(r: DateRef | None) -> Json | None:
    return None if r is None else {"start": r.start.isoformat(), "end": r.end.isoformat()}


def _time_ref(r: TimeRef | None) -> Json | None:
    return None if r is None else asdict(r)


def snapshot(conv: Conversation, *, clinic_id: str, rev: int) -> Json:
    d, i = conv.draft, conv.identity
    return {
        "v": SNAPSHOT_VERSION,
        "rev": rev,
        "clinicId": clinic_id,
        "callId": conv.call_id,
        "callerPhone": conv.caller_phone,
        "mode": conv.mode,
        "reminder": _model(conv.reminder),
        "reminderOutcome": conv.reminder_outcome,
        "message": None if conv.message is None else asdict(conv.message),
        "pendingMessage": None if conv.pending_message is None else asdict(conv.pending_message),
        "lang": conv.lang,
        "state": conv.state.value,
        "expecting": conv.expecting,
        "identity": {
            "name": i.name,
            "dob": i.dob.isoformat() if i.dob else None,
            "phone": i.phone,
            "thirdParty": i.third_party,
            "verificationId": i.verification_id,
            "patientName": i.patient_name,
            "failedAttempts": i.failed_attempts,
            "tried": sorted([list(t) for t in i.tried]),
        },
        "draft": {
            "goal": d.goal,
            "serviceId": d.service_id,
            "resourceId": d.resource_id,
            "dateRef": _date_ref(d.date_ref),
            "timeRef": _time_ref(d.time_ref),
            "offered": [_model(s) for s in d.offered],
            "chosen": _model(d.chosen),
            "appointments": None if d.appointments is None else [_model(a) for a in d.appointments],
            "target": _model(d.target),
            "idempotencyKey": d.idempotency_key,
            "newPatient": d.new_patient,
        },
        "failedUnderstanding": conv.failed_understanding,
        "noiseStreak": conv.noise_streak,
        "ended": conv.ended,
        "outcomes": list(conv.outcomes),
        "handoffReason": conv.handoff_reason,
        "transcript": [list(t) for t in conv.transcript],
        "offerBookingNext": conv._offer_booking_next,
        "pendingEnd": conv._pending_end,
        "sameQuestion": conv._same_question,
    }


def restore(conv: Conversation, data: Json) -> None:
    """Overwrite `conv`'s mutable state with `data` (which `snapshot()` produced)."""
    if data.get("v") != SNAPSHOT_VERSION:
        raise IncompatibleSnapshot(
            f"snapshot v{data.get('v')!r}, this build reads v{SNAPSHOT_VERSION}"
        )
    try:
        _apply(conv, data)
    except (KeyError, TypeError, ValueError) as e:  # a corrupt/foreign payload, never a crash
        raise IncompatibleSnapshot(str(e)) from e


def _apply(conv: Conversation, data: Json) -> None:
    conv.mode = data["mode"]
    conv.reminder = c.DueReminder.model_validate(data["reminder"]) if data["reminder"] else None
    conv.reminder_outcome = data["reminderOutcome"]
    conv.message = MessageDraft(**data["message"]) if data["message"] else None
    conv.pending_message = (
        MessageDraft(**data["pendingMessage"]) if data["pendingMessage"] else None
    )
    conv.lang = data["lang"]
    conv.state = State(data["state"])
    conv.expecting = data["expecting"]
    i = data["identity"]
    conv.identity = Identity(
        name=i["name"],
        dob=date.fromisoformat(i["dob"]) if i["dob"] else None,
        phone=i["phone"],
        third_party=i["thirdParty"],
        verification_id=i["verificationId"],
        patient_name=i["patientName"],
        failed_attempts=i["failedAttempts"],
        tried={(a, b) for a, b in i["tried"]},
    )
    d = data["draft"]
    dr, tr = d["dateRef"], d["timeRef"]
    conv.draft = Draft(
        goal=d["goal"],
        service_id=d["serviceId"],
        resource_id=d["resourceId"],
        date_ref=DateRef(date.fromisoformat(dr["start"]), date.fromisoformat(dr["end"]))
        if dr
        else None,
        time_ref=TimeRef(**tr) if tr else None,
        offered=[c.Slot.model_validate(s) for s in d["offered"]],
        chosen=c.Slot.model_validate(d["chosen"]) if d["chosen"] else None,
        appointments=None
        if d["appointments"] is None
        else [c.Appointment.model_validate(a) for a in d["appointments"]],
        target=c.Appointment.model_validate(d["target"]) if d["target"] else None,
        idempotency_key=d["idempotencyKey"],
        new_patient=d["newPatient"],
    )
    conv.failed_understanding = data["failedUnderstanding"]
    conv.noise_streak = data.get("noiseStreak", 0)
    conv.ended = data["ended"]
    conv.outcomes = list(data["outcomes"])
    conv.handoff_reason = data["handoffReason"]
    conv.transcript = [(a, b) for a, b in data["transcript"]]
    conv._offer_booking_next = data["offerBookingNext"]
    conv._pending_end = data["pendingEnd"]
    conv._same_question = data["sameQuestion"]
