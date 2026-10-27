# Generated from packages/shared/json-schema/contracts.json. Do not edit.
# Regenerate: uv run python scripts/gen_contracts.py

from __future__ import annotations

from typing import Annotated, Any, Literal
from pydantic import BaseModel, ConfigDict, Field, RootModel
from enum import StrEnum
from datetime import date


class MynaContracts(RootModel[Any]):
    root: Annotated[
        Any,
        Field(
            description="Generated from packages/shared (Zod). Do not edit by hand.",
            title="MynaContracts",
        ),
    ]


class Status(StrEnum):
    confirmed = "confirmed"
    pending = "pending"
    cancelled = "cancelled"


class Appointment(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: str
    patient_id: Annotated[str, Field(alias="patientId")]
    resource_id: Annotated[str, Field(alias="resourceId", pattern="^[a-z0-9][a-z0-9-]{0,63}$")]
    resource_name: Annotated[str, Field(alias="resourceName")]
    service_id: Annotated[str, Field(alias="serviceId", pattern="^[a-z0-9][a-z0-9-]{0,63}$")]
    service_name: Annotated[str, Field(alias="serviceName")]
    start: Annotated[str, Field(pattern="^\\d{4}-\\d{2}-\\d{2}T([01]\\d|2[0-3]):[0-5]\\d$")]
    end: Annotated[str, Field(pattern="^\\d{4}-\\d{2}-\\d{2}T([01]\\d|2[0-3]):[0-5]\\d$")]
    status: Status


class BookOutput(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    appointment: Appointment
    verification_id: Annotated[str | None, Field(alias="verificationId", min_length=8)] = None


class Language(StrEnum):
    en = "en"
    hi = "hi"
    hinglish = "hinglish"


class GreetingLanguage(StrEnum):
    en = "en"
    hi = "hi"
    hinglish = "hinglish"


class SchedulingMode(StrEnum):
    slots = "slots"
    tokens = "tokens"
    hybrid = "hybrid"


class Backend(StrEnum):
    sqlite = "sqlite"
    gsheets = "gsheets"


class ScheduleStore(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    backend: Backend
    spreadsheet_id: Annotated[str | None, Field(alias="spreadsheetId", min_length=10)] = None


class Hour(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    start: Annotated[str, Field(pattern="^([01]\\d|2[0-3]):[0-5]\\d$")]
    end: Annotated[str, Field(pattern="^([01]\\d|2[0-3]):[0-5]\\d$")]


class Service(RootModel[str]):
    root: Annotated[str, Field(pattern="^[a-z0-9][a-z0-9-]{0,63}$")]


class Resource(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: Annotated[str, Field(pattern="^[a-z0-9][a-z0-9-]{0,63}$")]
    name: Annotated[str, Field(min_length=1)]
    kind: Annotated[str, Field(min_length=1)]
    services: Annotated[list[Service], Field(min_length=1)]
    hours: dict[Literal["mon", "tue", "wed", "thu", "fri", "sat", "sun"], list[Hour]]


class Service1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: Annotated[str, Field(pattern="^[a-z0-9][a-z0-9-]{0,63}$")]
    name: Annotated[str, Field(min_length=1)]
    spoken: dict[Literal["en", "hi", "hinglish"], str]
    duration_min: Annotated[int, Field(alias="durationMin", ge=5, le=480)]


class Booking(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    slot_step_min: Annotated[int, Field(alias="slotStepMin", ge=5, le=60)]
    min_notice_min: Annotated[int, Field(alias="minNoticeMin", ge=0, le=9007199254740991)]
    max_days_ahead: Annotated[int, Field(alias="maxDaysAhead", ge=1, le=180)]


class FaqItem(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: Annotated[str, Field(pattern="^[a-z0-9][a-z0-9-]{0,63}$")]
    question: Annotated[str, Field(min_length=1)]
    answer: str
    answers: dict[Literal["hi", "hinglish"], str]


class BookingApproval(StrEnum):
    none = "none"
    after_hours = "after_hours"


class Metrics(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    receptionist_call_minutes: Annotated[
        float, Field(alias="receptionistCallMinutes", ge=0.5, le=30.0)
    ]
    reminder_call_minutes: Annotated[float, Field(alias="reminderCallMinutes", ge=0.5, le=30.0)]


class StaffTasks(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    urgent_categories: Annotated[list[str], Field(alias="urgentCategories")]


class CallWindow(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    start: Annotated[str, Field(pattern="^([01]\\d|2[0-3]):[0-5]\\d$")]
    end: Annotated[str, Field(pattern="^([01]\\d|2[0-3]):[0-5]\\d$")]


class OutboundReminders(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    enabled: bool
    call_window: Annotated[CallWindow, Field(alias="callWindow")]
    max_attempts: Annotated[int, Field(alias="maxAttempts", ge=1, le=3)]
    retry_gap_min: Annotated[int, Field(alias="retryGapMin", ge=15, le=9007199254740991)]
    days_before: Annotated[int, Field(alias="daysBefore", ge=1, le=3)]


class BusinessConfig(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: Annotated[str, Field(pattern="^[a-z0-9][a-z0-9-]{0,63}$")]
    tenant_id: Annotated[str, Field(alias="tenantId", pattern="^[a-z0-9][a-z0-9-]{0,63}$")]
    vertical: Literal["clinic"]
    name: Annotated[str, Field(min_length=1)]
    spoken_name: Annotated[dict[Literal["en", "hi", "hinglish"], str], Field(alias="spokenName")]
    timezone: str
    phone: Annotated[str, Field(pattern="^(91)?[6-9]\\d{9}$")]
    human_handoff_number: Annotated[
        str, Field(alias="humanHandoffNumber", pattern="^(91)?[6-9]\\d{9}$")
    ]
    languages: Annotated[list[Language], Field(min_length=1)]
    greeting_language: Annotated[GreetingLanguage, Field(alias="greetingLanguage")]
    scheduling_mode: Annotated[SchedulingMode, Field(alias="schedulingMode")]
    schedule_store: Annotated[ScheduleStore, Field(alias="scheduleStore")]
    hours: dict[Literal["mon", "tue", "wed", "thu", "fri", "sat", "sun"], list[Hour]]
    closed_dates: Annotated[list[date], Field(alias="closedDates")]
    resources: Annotated[list[Resource], Field(min_length=1)]
    services: Annotated[list[Service1], Field(min_length=1)]
    booking: Booking
    faq: list[FaqItem]
    booking_approval: Annotated[BookingApproval, Field(alias="bookingApproval")]
    public_demo: Annotated[bool, Field(alias="publicDemo")]
    metrics: Metrics
    callback_promise_hours: Annotated[int, Field(alias="callbackPromiseHours", ge=1, le=48)]
    staff_tasks: Annotated[StaffTasks, Field(alias="staffTasks")]
    outbound_reminders: Annotated[OutboundReminders, Field(alias="outboundReminders")]
    record_calls: Annotated[bool, Field(alias="recordCalls")]
    kill_switch: Annotated[bool, Field(alias="killSwitch")]


class Speaker(StrEnum):
    agent = "agent"
    caller = "caller"


class CallEvent1(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
    )
    type: Literal["turn"]
    speaker: Speaker
    text: str
    language: Language | None = None
    state: str
    latency_ms: Annotated[int | None, Field(alias="latencyMs", ge=0, le=9007199254740991)] = None


class CallEvent2(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
    )
    type: Literal["tool_call"]
    tool: str
    ok: bool
    error_code: Annotated[str | None, Field(alias="errorCode")] = None
    latency_ms: Annotated[int, Field(alias="latencyMs", ge=0, le=9007199254740991)]


class CallEvent3(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
    )
    type: Literal["end"]
    outcome: str
    handoff_reason: Annotated[str | None, Field(alias="handoffReason")] = None


class CallEvent(RootModel[CallEvent1 | CallEvent2 | CallEvent3]):
    root: CallEvent1 | CallEvent2 | CallEvent3


class CancelInput(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
    )
    idempotency_key: Annotated[str, Field(alias="idempotencyKey", max_length=128, min_length=8)]
    verification_id: Annotated[str, Field(alias="verificationId", min_length=8)]
    appointment_id: Annotated[str, Field(alias="appointmentId", min_length=1)]


class CancelOutput(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    appointment: Appointment


class Category(StrEnum):
    report_status = "report_status"
    medicine_refill_request = "medicine_refill_request"
    billing_question = "billing_question"
    doctor_callback = "doctor_callback"
    directions_timings = "directions_timings"
    other = "other"


class Urgency(StrEnum):
    urgent = "urgent"
    today = "today"
    routine = "routine"


class CreateStaffTaskInput(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
    )
    call_id: Annotated[str, Field(alias="callId", min_length=1)]
    verification_id: Annotated[str | None, Field(alias="verificationId", min_length=8)] = None
    caller_name: Annotated[str | None, Field(alias="callerName", max_length=100, min_length=1)] = (
        None
    )
    category: Category
    summary: Annotated[str, Field(max_length=200, min_length=1)]
    urgency: Urgency
    callback_number: Annotated[str, Field(alias="callbackNumber")]


class CreateStaffTaskOutput(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    task_id: Annotated[str, Field(alias="taskId")]
    callback_by: Annotated[
        str, Field(alias="callbackBy", pattern="^\\d{4}-\\d{2}-\\d{2}T([01]\\d|2[0-3]):[0-5]\\d$")
    ]


class DueReminder(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    appointment_id: Annotated[str, Field(alias="appointmentId")]
    patient_id: Annotated[str, Field(alias="patientId")]
    patient_name: Annotated[str, Field(alias="patientName")]
    phone: str
    attempts: Annotated[int, Field(ge=0, le=9007199254740991)]


class DueRemindersOutput(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    due: list[DueReminder]


class FindPatientInput(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
    )
    call_id: Annotated[str, Field(alias="callId", min_length=1)]
    name: Annotated[str, Field(min_length=2)]
    dob: date | None = None
    phone: str | None = None


class FindPatientOutput2(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    status: Literal["not_verified"]


class PartOfDay(StrEnum):
    morning = "morning"
    afternoon = "afternoon"
    evening = "evening"


class FindSlotsInput(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
    )
    service_id: Annotated[str, Field(alias="serviceId", pattern="^[a-z0-9][a-z0-9-]{0,63}$")]
    resource_id: Annotated[
        str | None, Field(alias="resourceId", pattern="^[a-z0-9][a-z0-9-]{0,63}$")
    ] = None
    date_from: Annotated[date, Field(alias="dateFrom")]
    date_to: Annotated[date, Field(alias="dateTo")]
    part_of_day: Annotated[PartOfDay | None, Field(alias="partOfDay")] = None
    limit: Annotated[int | None, Field(ge=1, le=20)] = 5


class Reason(StrEnum):
    emergency = "emergency"
    medical_question = "medical_question"
    low_confidence = "low_confidence"
    frustrated = "frustrated"
    repeated_misunderstanding = "repeated_misunderstanding"
    caller_asked = "caller_asked"
    kill_switch = "kill_switch"
    tool_failure = "tool_failure"
    verification_failed = "verification_failed"
    unanswered_question = "unanswered_question"


class HandoffToHumanInput(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
    )
    call_id: Annotated[str, Field(alias="callId", min_length=1)]
    reason: Reason
    summary: Annotated[str, Field(max_length=500)]


class HandoffToHumanOutput(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    transfer_to: Annotated[str, Field(alias="transferTo")]


class ListAppointmentsInput(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
    )
    verification_id: Annotated[str, Field(alias="verificationId", min_length=8)]


class ListAppointmentsOutput(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    appointments: list[Appointment]


class Outcome(StrEnum):
    confirmed = "confirmed"
    rescheduled = "rescheduled"
    cancelled = "cancelled"
    wrong_number = "wrong_number"
    no_answer = "no_answer"
    voicemail = "voicemail"
    opted_out = "opted_out"
    reached_family = "reached_family"
    not_verified = "not_verified"


class MarkReminderOutcomeInput(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
    )
    call_id: Annotated[str, Field(alias="callId", min_length=1)]
    appointment_id: Annotated[str, Field(alias="appointmentId", min_length=1)]
    outcome: Outcome


class MarkReminderOutcomeOutput(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    recorded: bool


class NewPatient(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
    )
    name: Annotated[str, Field(min_length=2)]
    phone: str
    dob: date | None = None


class PatientSummary(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: str
    name: str


class RescheduleInput(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
    )
    idempotency_key: Annotated[str, Field(alias="idempotencyKey", max_length=128, min_length=8)]
    verification_id: Annotated[str, Field(alias="verificationId", min_length=8)]
    appointment_id: Annotated[str, Field(alias="appointmentId", min_length=1)]
    new_start: Annotated[
        str, Field(alias="newStart", pattern="^\\d{4}-\\d{2}-\\d{2}T([01]\\d|2[0-3]):[0-5]\\d$")
    ]
    new_resource_id: Annotated[
        str | None, Field(alias="newResourceId", pattern="^[a-z0-9][a-z0-9-]{0,63}$")
    ] = None


class RescheduleOutput(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    appointment: Appointment


class SendSmsConfirmationInput(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
    )
    verification_id: Annotated[str, Field(alias="verificationId", min_length=8)]
    appointment_id: Annotated[str, Field(alias="appointmentId", min_length=1)]
    language: Language


class SendSmsConfirmationOutput(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    queued: bool


class Slot(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    start: Annotated[str, Field(pattern="^\\d{4}-\\d{2}-\\d{2}T([01]\\d|2[0-3]):[0-5]\\d$")]
    end: Annotated[str, Field(pattern="^\\d{4}-\\d{2}-\\d{2}T([01]\\d|2[0-3]):[0-5]\\d$")]
    resource_id: Annotated[str, Field(alias="resourceId", pattern="^[a-z0-9][a-z0-9-]{0,63}$")]
    resource_name: Annotated[str, Field(alias="resourceName")]
    service_id: Annotated[str, Field(alias="serviceId", pattern="^[a-z0-9][a-z0-9-]{0,63}$")]


class Status1(StrEnum):
    open = "open"
    done = "done"


class StaffTask(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    id: str
    call_id: Annotated[str, Field(alias="callId")]
    category: str
    summary: str
    urgency: Urgency
    patient_id: Annotated[str | None, Field(alias="patientId")]
    patient_name: Annotated[str | None, Field(alias="patientName")]
    caller_name: Annotated[str | None, Field(alias="callerName")]
    verified: bool
    callback_number_masked: Annotated[str, Field(alias="callbackNumberMasked")]
    callback_by: Annotated[
        str, Field(alias="callbackBy", pattern="^\\d{4}-\\d{2}-\\d{2}T([01]\\d|2[0-3]):[0-5]\\d$")
    ]
    status: Status1
    created_at: Annotated[str, Field(alias="createdAt")]


class Direction(StrEnum):
    inbound = "inbound"
    outbound = "outbound"


class Source(StrEnum):
    patient = "patient"
    manual_test = "manual_test"
    hawk = "hawk"


class StartCallInput(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
    )
    direction: Direction | None = "inbound"
    source: Source | None = "patient"
    caller_phone: Annotated[str | None, Field(alias="callerPhone")] = None


class StartCallOutput(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    call_id: Annotated[str, Field(alias="callId")]


class Code(StrEnum):
    validation = "VALIDATION"
    not_verified = "NOT_VERIFIED"
    not_found = "NOT_FOUND"
    slot_unavailable = "SLOT_UNAVAILABLE"
    outside_hours = "OUTSIDE_HOURS"
    too_soon = "TOO_SOON"
    too_far_ahead = "TOO_FAR_AHEAD"
    service_not_offered = "SERVICE_NOT_OFFERED"
    already_cancelled = "ALREADY_CANCELLED"
    idempotency_conflict = "IDEMPOTENCY_CONFLICT"
    kill_switch = "KILL_SWITCH"
    unauthorized = "UNAUTHORIZED"
    internal = "INTERNAL"


class ToolError(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    code: Code
    message: str
    details: dict[str, Any] | None = None


class BookInput(BaseModel):
    model_config = ConfigDict(
        populate_by_name=True,
    )
    idempotency_key: Annotated[str, Field(alias="idempotencyKey", max_length=128, min_length=8)]
    call_id: Annotated[str, Field(alias="callId", min_length=1)]
    verification_id: Annotated[str | None, Field(alias="verificationId", min_length=8)] = None
    new_patient: Annotated[NewPatient | None, Field(alias="newPatient")] = None
    service_id: Annotated[str, Field(alias="serviceId", pattern="^[a-z0-9][a-z0-9-]{0,63}$")]
    resource_id: Annotated[str, Field(alias="resourceId", pattern="^[a-z0-9][a-z0-9-]{0,63}$")]
    start: Annotated[str, Field(pattern="^\\d{4}-\\d{2}-\\d{2}T([01]\\d|2[0-3]):[0-5]\\d$")]


class ErrorEnvelope(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    ok: Literal[False]
    error: ToolError


class FindPatientOutput1(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    status: Literal["verified"]
    verification_id: Annotated[str, Field(alias="verificationId", min_length=8)]
    patient: PatientSummary


class FindPatientOutput(RootModel[FindPatientOutput1 | FindPatientOutput2]):
    root: FindPatientOutput1 | FindPatientOutput2


class FindSlotsOutput(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    slots: list[Slot]


class ListTasksOutput(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        populate_by_name=True,
    )
    tasks: list[StaffTask]
