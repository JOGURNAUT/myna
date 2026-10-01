# Project: Myna + Hawk — Go-Live Kit for Clinic Voice Agents (India-first)

**Myna** is the voice agent (named after the Indian bird that learns to talk).
**Hawk** is the test harness that watches Myna and decides if it's safe to launch.
Tagline: "Myna talks, Hawk watches."

## What we are building
A multilingual (English, Hindi, Hinglish; later one regional language) AI phone receptionist
for small Indian clinics (dental first), plus a pre-launch test harness that proves the agent
is safe to go live. It will be piloted at 2–3 real clinics and tested by me calling as a patient.

The project has 4 parts, built in this order:
1. **Agent core** — three flows, text-only first:
   (a) inbound booking / rescheduling / cancelling,
   (b) inbound routing + message-taking for non-booking calls,
   (c) outbound appointment-reminder calls (confirm / reschedule / cancel).
2. **Scheduling adapters** — one interface, multiple backends (real Indian clinics mostly use
   paper, Google Sheets or Practo-style tools, not FHIR EHRs).
3. **Voice layer** — Pipecat + Sarvam (STT: Saaras, TTS: Bulbul), browser first, phone later.
4. **Hawk: test harness + go-live report** — simulated patients, graded calls, pass rates by language.

The harness and the go-live report are the most important deliverables. Do not over-polish
the agent at the expense of the harness.

## Why these flows (modelled on Confido Health's product)
Confido's agents cover scheduling, outbound outreach, and call routing/triage, and they sell on
operational metrics (share of calls handled without staff, no-show rate, staff hours saved).
Myna mirrors the slice that fits a small clinic: inbound scheduling, routing + message-taking,
and outbound reminders. **Out of scope:** payment collections, pre-/post-op engagement, care-gap
outreach, prescriptions of any kind.

## Scope note
Build the architecture vertical-agnostic (a "business" has staff/resources, services, hours and
rules; a clinic is one kind of business), but ALL demos, configs, tests and the pilot are for
clinics only. Do not build other verticals. README should say: "Built vertical-agnostic; clinics
first because they're the hardest."

## Tech stack (TypeScript-first; Python only where Pipecat requires it)
Most of the codebase is TypeScript, because the target employer's stack and interviews are
JS/TS-heavy. Python is used ONLY for the realtime voice agent (Pipecat is a Python framework).

- **Web app** (`apps/web`): Next.js (App Router) + TypeScript + Tailwind. Public demo page,
  clinic dashboard, Hawk reports. Browser voice via Pipecat's JS client SDK (check the current
  package names/versions in Pipecat's docs).
- **API** (`services/api`): Node.js + TypeScript + Fastify, Zod for validation, Drizzle ORM,
  SQLite (dev) / Postgres (prod). Owns tenants/clinics, scheduling adapters, call logs, labels,
  and exposes the scheduling tools over HTTP for the agent to call.
- **Agent** (`services/agent`): Python 3.11+, Pipecat (`pipecat-ai[sarvam]`), Pydantic. Owns the
  conversation state machine and voice pipeline; calls the API for every schedule read/write.
  Read Sarvam's Pipecat guide and production guide before writing voice code; check class names
  in the installed package version rather than assuming.
- **Hawk** (`hawk/`): TypeScript (Node). Runs text-mode scenarios against the agent's text
  endpoint and audio-mode samples; grades and generates reports stored via the API.
- Shared types: `packages/shared` (TS types + Zod schemas). The agent's tool contracts are
  generated from / checked against these schemas (export JSON Schema for Python).
- LLM: behind a provider interface. Default Sarvam (sarvam-30b for speed), swappable.
- Telephony (Phase 4 only): an Indian provider with media streaming (evaluate Exotel / Plivo;
  confirm Pipecat transport/serializer support for the chosen one before committing).
- Monorepo with pnpm workspaces. Deploy: Docker + Google Cloud Run. Structured JSON logs.
- Tests: Vitest (TS), pytest (Python). Lint: ESLint + Prettier, ruff. TS `strict: true` everywhere.
- Write idiomatic modern TS: async/await done right, no floating promises, typed errors,
  no `any`. I want to be able to explain every line in an interview.

## Repo layout
```
myna/
  apps/
    web/                 # Next.js: demo page, dashboard, Hawk reports
  services/
    api/                 # Fastify + Drizzle: clinics, adapters, calls, labels, tool endpoints
      src/adapters/      # SchedulingAdapter interface + sqlite, gsheets, fhir (stretch)
    agent/               # Python + Pipecat: state machine, voice pipelines, text endpoint
  hawk/                  # TS test harness
    personas/            # YAML persona definitions
    scenarios/           # YAML scenarios with expected end-state
    src/                 # runner (text + audio mode), grader, report
  packages/
    shared/              # shared TS types + Zod schemas
  clinics/               # one YAML config per clinic (hours, doctors, visit types, rules)
  docs/                  # plans, decisions, findings, demo script
```

## Web app screens (design)
Clean, calm, trustworthy healthcare look; mobile-friendly (clinic staff use phones); light/dark.
1. **Talk to Myna** (public demo): big mic button, live transcript with a language badge per turn
   (EN / HI / Hinglish), live latency readout, and the booking appearing in a mini schedule
   beside it as it's confirmed.
2. **Clinic dashboard**: top-line metrics (share of calls handled without staff, missed calls,
   no-show rate, reminder outcomes, estimated staff hours saved — each with its formula shown on hover),
   staff task queue (from routing/message-taking), today's calls, "pending confirmation" queue for after-hours bookings
   (one-tap approve/reject), handoff alerts, kill-switch toggle.
3. **Call detail**: transcript, extracted fields, tool calls made, per-turn latency, and my
   manual labels (correct? failure type, notes).
4. **Hawk report**: overall verdict per flow (SAFE / WITH HANDOFF / NOT SAFE), pass rates by
   language and scenario, top failure modes with example transcripts, judge-vs-human agreement,
   latency p50/p95, cost per call. Shareable read-only link.
5. **Clinic setup** (stretch): scheduling mode (slots / tokens / hybrid), hours, doctors,
   visit types; validates against the schema.
6. **Token queue** (stretch, token mode only): staff view with "now serving" number, waiting list
   (phone tokens vs walk-ins), call next / skip / pause with delay message; plus a public
   patient view (no names) showing current number and approximate wait.
Simple auth for the dashboard (one login per clinic); demo page and shared reports are public.

## Part 1 — Agent core (text-only)
- Model the call as an explicit state machine, not one giant prompt:
  Inbound: GREETING → IDENTIFY_INTENT → VERIFY_PATIENT → (BOOK | RESCHEDULE | CANCEL | FAQ | TAKE_MESSAGE | HANDOFF) → CONFIRM → CLOSE.
  Outbound reminder: DIAL → IDENTITY_CHECK (am I speaking to the patient / a family member?) →
  REMIND → (CONFIRM_ATTENDANCE | RESCHEDULE | CANCEL | NO_ANSWER / VOICEMAIL) → CLOSE.
- The LLM decides intent and extracts fields; **code** enforces rules (verification, slot
  validity, clinic hours). Never let the LLM write to the schedule without a validated tool call.
- Tools: `find_patient`, `find_slots`, `book`, `reschedule`, `cancel`, `handoff_to_human`,
  `send_sms_confirmation`, `create_staff_task`, `mark_reminder_outcome`.

### Flow (b): routing + message-taking
- Classify non-booking calls into a small fixed set of categories configured per clinic, e.g.
  `report_status`, `medicine_refill_request`, `billing_question`, `doctor_callback`, `directions_timings`, `other`.
- FAQ-type questions answered ONLY from the clinic's config (timings, address, fees list if the
  clinic provides one). Anything else → `create_staff_task` with category, verified patient,
  caller's request summarised in one line, urgency, callback number. Tell the caller when to expect
  a callback (from clinic config). Never answer report contents, never approve or discuss medicines.
- Tasks appear in the dashboard task queue; staff mark them done.

### Flow (c): outbound appointment reminders
- A scheduler (in the API) builds the next day's reminder list from the schedule; call window and
  max attempts come from clinic config (default: 2 attempts, daytime hours only, never late evening).
- Opening line states the clinic name and that it's an automated assistant. Disclose appointment
  details only after confirming the right person (name + one identifier); if a family member
  answers, only ask them to have the patient call back — no details.
- Outcomes: confirmed / rescheduled / cancelled / wrong number / no answer / voicemail.
  Cancelled slots are released back to the schedule. Every outcome is logged via `mark_reminder_outcome`.
- Respect opt-out: if the patient says don't call, set `do_not_call` and never call again.
- In the pilot, outbound calls start only after the clinic owner explicitly enables them.
- Read back every critical field before committing: name, date, time, doctor. Dates must be
  read back in the caller's language AND as an absolute date ("Tuesday, 14 October").
- Handle mind-changes ("Wednesday... nahi, Tuesday") — the final state must have exactly one booking.
- Clinic rules come from `clinics/<clinic>.yaml` (loaded via the API), never hardcoded.

### Hard safety rules (enforce in code, cover with tests)
1. At call start, disclose: this is an AI assistant, and the call may be recorded (if it is).
2. No medical advice, ever. No diagnosis, no medicine names/doses. Redirect to the doctor.
3. Emergency keywords/intents (bleeding heavily, chest pain, can't breathe, accident, unconscious,
   self-harm statements, in any supported language) → immediately tell the caller to call 112 /
   108 or go to the nearest emergency, and trigger human handoff. Do not continue the booking flow.
4. Never reveal any appointment or patient detail before verification (full name + date of birth,
   or name + registered phone number match). Third-party callers ("calling for my mother") must
   still verify the patient's details.
5. If confidence is low, the caller is frustrated, or after 2 failed understanding attempts → handoff.
6. Global kill switch per clinic (env/config flag) that routes all calls to the human number.

## Part 2 — Scheduling adapters
- `SchedulingAdapter` abstract interface: `find_patient`, `list_slots`, `book`, `reschedule`,
  `cancel`, `get_appointment`. All methods typed, idempotent where possible (idempotency keys
  for book/reschedule to prevent double bookings on retries).
- Implementations: SQLite (dev + harness), Google Sheets (what real pilot clinics will likely use),
  FHIR/Medplum (stretch, shows US-EHR readiness).
- Contract test suite that every adapter must pass — same tests, different backends.

## Part 3 — Voice layer
- Phase 3a: browser (Pipecat WebRTC) so testing costs nothing for telephony.
- Sarvam STT in code-mix mode where supported; language detection per turn; reply in the
  caller's current language; support switching mid-call.
- Track and log per-turn latency (STT, LLM, TTS, total). Target: total < 1.5s p50.
- Barge-in / interruption must work.
- Keep cost visible: log audio seconds and TTS characters per call and estimated INR cost.

## Part 4 — Hawk (test harness)
- Personas (YAML): language (en / hi / hinglish / later one regional), age, patience, speaking
  style (interrupts, rambles, changes mind, mumbles numbers), goal, and adversarial traits
  (tries to get someone else's info, asks for medical advice, emergency mid-call).
- Scenarios (YAML): persona + goal + **expected end-state of the schedule (and task queue)** +
  must/must-not rules. Cover all three flows, including: outbound call answered by a family member,
  patient reschedules during a reminder, wrong number, opt-out request, refill request that must
  become a task (not an answer), report-status question, caller who mixes a booking and a question.
- Two run modes:
  - **text mode**: simulated patient LLM ↔ agent over text. Cheap; run hundreds.
  - **audio mode**: patient text → TTS → agent's real STT pipeline. Run a small sample (20–30)
    to measure ASR errors and latency.
- Grader:
  - Deterministic checks first: final DB state vs expected, double bookings, verification
    happened before disclosure, emergency → handoff, no medical advice keywords.
  - LLM judge only for soft criteria (politeness, language consistency, clarity), with a rubric.
  - Validate the LLM judge against my human labels (see "Manual test calls"); report agreement %.
- Report: pass rate overall and **by language and by scenario type**, top failure modes with
  example transcripts, latency p50/p95, cost per call, and a clear verdict per flow:
  SAFE TO LAUNCH / LAUNCH WITH HANDOFF / NOT SAFE.
- Every bug found in real calls becomes a new regression scenario.

## Manual test calls (me calling as a patient)
- Calls I make are tagged `source=manual_test` and shown in the dashboard.
- Dashboard lets me label each call: outcome correct? (y/n), failure type, notes.
- These labels are the ground truth used to check the LLM judge.
- Keep a script list of my test calls in `docs/manual_test_plan.md` (personas I'll act out).

## Real clinic pilot (Phase 5 — only after harness shows SAFE TO LAUNCH for the pilot flows)
Pilot rollout ladder; do not skip steps:
1. **Shadow mode**: agent listens to/receives a copy of nothing real — instead the clinic staff
   make test calls to it for a few days.
2. **After-hours only**: agent answers only when the clinic is closed; everything is confirmed
   by staff next morning before it becomes final ("pending" status in the schedule).
3. **Limited live**: daytime overflow only, with one-tap transfer to staff.

Pilot data rules (India DPDP Act–conscious):
- Written permission from each clinic owner, describing exactly what the agent does.
- AI + recording disclosure at the start of every call; offer "press 0 / say 'staff'" for a human.
- Store the minimum: no recordings by default (opt-in per clinic), transcripts with phone numbers
  masked in logs, retention limit configurable (default 30 days), delete-on-request.
- Secrets in env/Secret Manager only. No patient data in git, in test fixtures, or in prompts sent
  to the harness. Harness uses only synthetic patients.
- Per-clinic data isolation (tenant id on every row and every query).

## Stretch: token mode (for GP / pediatric clinics)
Many Indian GP and pediatric clinics don't run appointment slots; they run a same-day token queue
(walk-in, first come first served). Phone calls there are mostly: "Is the doctor sitting today?",
"Till what time?", "Which number is running now?", "Can I get a token?". Build this ONLY after
milestones 1–4 are done. The core demo stays slot-based dental.

- Clinic config gets `scheduling_mode: slots | tokens | hybrid` (hybrid = some slots pre-booked,
  walk-in tokens interleaved by a configured rule). Same `SchedulingAdapter` idea: add a
  `QueueAdapter` interface (`issue_token`, `current_token`, `estimated_wait`, `skip`, `close_session`).
- Sessions per doctor (e.g. morning 10–1, evening 6–9), max tokens per session, average consult
  minutes (used for the wait estimate, always phrased as approximate).
- Phone flows: doctor availability today, issue a token by phone (name + phone number), "which
  number is running now / how long for me", cancel my token.
- Staff side: add walk-in tokens in two taps, call next, mark skipped / no-show, pause queue
  ("doctor on emergency, delay 30 min" → notify waiting phone-token holders).
- Outbound: optional SMS or short call when the patient is ~3 tokens away (configurable).
- Hawk scenarios for token mode: session full, doctor not sitting today, caller asks for a
  specific time (explain it's a queue), queue paused, patient arrives after their number passed.

## Clinic discovery
Before onboarding any clinic, run the visit questionnaire in `docs/clinic-discovery-questions.md`
and record answers in the deployment playbook. Use real answers (call volume, top call reasons,
languages, slots vs tokens) to set the clinic config and to write new Hawk personas/scenarios.

## Deployment playbook (`docs/deployment-playbook.md`)
For every clinic onboarded, keep a dated section with: who I met, how the clinic currently handles
calls (volume, peak times, languages, top call reasons), workflow map, config decisions and why,
what Hawk flagged before launch, rollout stage dates, what broke in the real world and the fix,
and before/after metrics. Also keep a reusable onboarding checklist and a clinic-config template
that gets better with each clinic. Track "hours from first meeting to go-live" per clinic.
This document is a primary deliverable, not an afterthought.

## Working style for Claude Code
- Start each phase by writing a short plan in `docs/plan-<phase>.md` and wait for my OK.
- Small commits with clear messages. Write tests alongside code.
- When unsure about a library API (Pipecat, Sarvam, telephony provider), read the installed
  package source or official docs instead of guessing; note the version in `docs/decisions.md`.
- Log every significant design decision and every real-world finding in `docs/decisions.md`
  and `docs/findings.md` — I will use these in my writeup.
- Prefer simple and finished over clever and half-done. If a phase is taking too long, propose a cut.

## Milestones
1. Monorepo scaffold + API with SQLite adapter + text agent (flow a) + safety-rule tests passing.
2. Flows (b) routing/message-taking and (c) outbound reminders in text mode + Hawk text mode +
   first go-live report (English vs Hinglish, all three flows).
3. Browser voice agent with Sarvam; audio-mode harness sample; latency numbers.
4. Web app (demo page, dashboard, call detail, Hawk report) + Google Sheets adapter + manual-test labeling + judge-vs-human agreement.
5. Indian telephony number + clinic pilot (shadow → after-hours → reminders enabled), playbook kept up to date.
6. Final report + 3-minute demo script in `docs/demo.md`.
7. Stretch: token mode (config, QueueAdapter, phone flows, staff queue screen, Hawk scenarios).
