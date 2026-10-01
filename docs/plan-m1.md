# Plan — Milestone 1: scaffold, API + SQLite adapter, text agent (flow a), safety tests

Status: **draft, waiting for OK**

## Done when
- `pnpm test` and `pytest` pass from a clean clone, on Windows and in Docker.
- A scripted text conversation (EN and Hinglish) books, reschedules and cancels an appointment
  through the agent → API → SQLite, and the final DB state is asserted. This is a small preview of Hawk.
- Every hard safety rule (CLAUDE.md §"Hard safety rules" 1–6) has at least one passing test
  that fails if the rule is removed.

## Out of scope for M1
Voice, telephony, flows (b) and (c) beyond their schemas, Hawk, web app, Google Sheets adapter.

## Steps (each one is one or two small commits)

1. **Repo scaffold**
   - `git init`; rename `CLAUDE (2).md` → `CLAUDE.md`.
   - pnpm workspace (`apps/*`, `services/api`, `hawk`, `packages/*`), `tsconfig.base.json` with
     `strict: true`, ESLint (incl. `no-floating-promises`, `no-explicit-any`) + Prettier, Vitest.
   - `services/agent`: `pyproject.toml`, ruff, pytest, Pydantic.
   - `.gitignore`, `.env.example`, README stub ("Built vertical-agnostic; clinics first because they're the hardest.").
   - `docs/decisions.md`, `docs/findings.md` started.

2. **`packages/shared`: one source of truth for types**
   - Zod schemas: business/clinic config (hours, doctors, visit types, rules, kill switch,
     callback promise), patient, slot, appointment, and every tool's input/output:
     `find_patient`, `find_slots`, `book`, `reschedule`, `cancel`, `handoff_to_human`,
     `send_sms_confirmation`, plus schemas only for `create_staff_task` and `mark_reminder_outcome`.
   - A script exports JSON Schema, and the agent's Pydantic models are generated from it.
     A test fails if the generated models are stale (drift check).

3. **Clinic config**: `clinics/smile-dental.yaml` (synthetic), validated by the shared schema on load.

4. **`services/api`: Fastify + Drizzle + SQLite**
   - Tables: tenants, clinics, doctors, patients, appointments, idempotency_keys, calls,
     call_turns, tool_calls. `tenant_id` on every row; every query goes through a tenant-scoped helper.
   - `SchedulingAdapter` interface + `SqliteAdapter`.
   - **Adapter contract test suite**: written against the interface, so the Google Sheets
     adapter in M4 runs the same tests.
   - Tool endpoints: `POST /v1/clinics/:clinicId/tools/:tool`, Zod-validated in and out.
   - Rules enforced **in the API**, not just the agent:
     - slot must be inside clinic hours and the doctor's sessions;
     - no double booking (unique index + idempotency key on book/reschedule);
     - patient data only with a `verification_id`. `find_patient` issues one only when
       full name + DOB, or name + registered phone, match.
   - Seed script with synthetic patients only.

5. **`services/agent`: Python text agent, flow (a)**
   - Explicit state machine:
     GREETING → IDENTIFY_INTENT → VERIFY_PATIENT → BOOK | RESCHEDULE | CANCEL | FAQ | HANDOFF → CONFIRM → CLOSE.
   - The LLM sits behind a provider interface: Sarvam by default, plus a scripted `FakeLLM` for tests.
     It only returns structured intent + extracted fields (Pydantic-validated). Code picks the
     next state and makes every tool call.
   - Read-back before commit: name, doctor, time, and the date as an absolute date in the
     caller's language. Mind changes ("Wednesday… nahi, Tuesday") overwrite the draft, so a
     confirm always commits exactly one booking.
   - Text endpoint: `POST /v1/calls` (start) and `POST /v1/calls/:id/turns`. Every turn and
     tool call is logged to the API.

6. **Safety rules: code + tests**
   1. The AI + recording disclosure is the first utterance of every call. A test asserts it.
   2. Medical advice guard: the intent "medical question" or medicine/dose keywords (EN/HI/Hinglish)
      → fixed redirect line; the LLM never writes the reply.
   3. Emergency: keyword list (EN/HI/Hinglish, e.g. "bahut khoon", "saans nahi", "chest pain")
      **or** LLM intent → 112/108 line + `handoff_to_human`, and the call can't return to booking.
      Checked on every turn, before anything else.
   4. Verification: the agent can't disclose without a `verification_id`, and the API refuses
      without one. Tests cover third-party callers ("calling for my mother").
   5. Handoff after 2 failed understandings, low confidence or frustration.
   6. Kill switch in clinic config → greeting + immediate handoff.

7. **Tests**
   - Vitest: schemas, the adapter contract suite, API rules (hours, double booking, idempotency,
     verification, tenant isolation).
   - pytest: state machine transitions, each safety rule, and EN + Hinglish conversation scripts on `FakeLLM`.
   - One end-to-end test: agent ↔ API ↔ SQLite, with final schedule state asserted.

## Decisions I need from you
1. **Python version.** Only Python 3.14 is installed. Pipecat (needed in M3) may not support 3.14
   yet. I propose installing **uv** and pinning the agent to **Python 3.12** now, so M3
   doesn't force a redo. I'll confirm Pipecat's supported versions and record them in `decisions.md`.
2. **SQLite driver.** `better-sqlite3` is the usual Drizzle choice, but it's a native module on
   Node 24/Windows. If it won't install from a prebuilt binary, I'll fall back to `@libsql/client`.
3. **Sarvam API key.** All tests run offline on `FakeLLM`. You'll need `SARVAM_API_KEY` in `.env`
   only to try the agent against the real model.
4. **OK to `git init` and rename the spec to `CLAUDE.md`?**

## Risks
- Sarvam LLM API shape (structured output / JSON mode). I'll read their docs before writing the
  provider, and fall back to prompt + Pydantic validation with one retry.
- Hindi/Hinglish date and time parsing ("pehli tareekh", "saade chaar") is hard. In M1 I'll
  build a small tested parser for the common forms, and log misses to `findings.md`.
