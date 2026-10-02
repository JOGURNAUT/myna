# Decisions

Newest first. Each entry: what, why, and what would make us revisit it.

## 2026-10-03 — The model understands; code speaks
The LLM's only job is to fill an `Understanding` (intent, language, extracted fields,
confidence). Every reply Myna says is a fixed template per language (`i18n.py`), chosen and
filled by the state machine. Consequences: the model cannot give medical advice, invent a fee,
or read out details before verification, even if prompted to. Replies sound templated; Hawk's
soft-criteria judge will tell us whether that costs us with callers. Revisit only with a
judge-graded reason, and even then let the model rephrase a chosen template, never free-write.

## 2026-10-03 — Code parses dates; the model only points at them
`dates.py` resolves days and times (Hinglish ordinals, saade/sawa/paune, "agle hafte",
mind changes = last mention). The model copies the caller's words into `date_text`/`time_text`;
code parses those only if parsing the raw utterance failed. Dates are where agents fail, and a
tested parser fails the same way every time, which Hawk can measure and we can fix.

## 2026-10-03 — Rule-based NLU stays, as offline mode, fallback and baseline
`RuleBasedNLU` (keywords + patterns) runs the agent with no API key, makes the e2e tests
deterministic, and catches Sarvam outages (`WithFallback`). It is also the baseline Hawk compares
the LLM against: if Sarvam doesn't beat rules on a scenario type, that's a finding.

## 2026-10-03 — Sarvam model: `sarvam-105b`, not `sarvam-30b`
The spec says sarvam-30b, but Sarvam's docs now list it as deprecated. Chat completions:
`POST https://api.sarvam.ai/v1/chat/completions`, header `api-subscription-key`,
`response_format: json_schema`, `reasoning_effort: low` (for latency). Configurable via
`SARVAM_MODEL`; `sarvam-105b-conversations` (32K context) is worth a latency test in M3.

## 2026-10-03 — Language follows the caller, but not on short answers
Myna replies in the caller's language each turn, except that a short Latin-script answer
(a name, "yes", fewer than 3 words) does not switch a Hinglish call to English. Found by the
e2e tests (see findings).

## 2026-10-03 — SQLite writes are queued in-process
libsql opens a fresh connection per transaction, which doesn't inherit `busy_timeout`, so
concurrent bookings got raw `SQLITE_BUSY` instead of a typed `SLOT_UNAVAILABLE`. Writes now go
through `writeTransaction` (one in-process queue + short retry for other processes). Data was
never at risk (a partial unique index backs up the overlap check). Postgres won't need the queue.

## 2026-10-03 — Pinned clock for reproducible runs
The API honours `MYNA_FAKE_NOW` (refused when `NODE_ENV=production`); the agent takes a `now`
function. Tests use Monday 12 Oct 2026, 09:00 IST, so slot offers are identical every run.
Hawk will use the same mechanism so a scenario's expected end-state never drifts with the date.

## 2026-10-02 — Toolchain versions (M1)
- **Node 24.17, pnpm 12.6.** pnpm 12 blocks dependency build scripts by default; allowed ones
  are listed under `allowBuilds` in `pnpm-workspace.yaml` (esbuild).
- **TypeScript pinned to 6.0.x, not 7.** TS 7 (native compiler) has no JS API, and
  typescript-eslint 8.71 needs `typescript >=4.8.4 <6.1`. Type-aware lint rules
  (`no-floating-promises`, `no-misused-promises`) matter more to us than the faster compiler.
  Revisit when typescript-eslint supports TS 7.
- **Python 3.12 for the agent via uv.** The machine has 3.14. Pipecat 1.12.0 needs `>=3.11`
  with no upper bound, but its native dependencies lag new Python releases; 3.12 is the safe
  middle. Revisit at M3 when Pipecat is actually installed.
- **Zod 4.** Built-in `z.toJSONSchema` exports the contracts for Python, so no extra converter.
- **SQLite via `@libsql/client`, not `better-sqlite3`.** better-sqlite3 13 had no prebuilt
  binary that installed here, and the source build needs the Windows SDK (not installed).
  Node 24's built-in `node:sqlite` would be ideal, but Drizzle only supports it in the 1.0
  betas. libsql ships prebuilt binaries, works with Drizzle 0.45 (`drizzle-orm/libsql`), and
  supports in-memory databases for tests. Its API is async, which matches Postgres later.
  Revisit when Drizzle 1.0 is stable (`node:sqlite` driver).

## 2026-10-02 — Schedule times are business-local wall-clock strings
All schedule times on the wire and in the DB are `YYYY-MM-DDTHH:mm` in the clinic's time zone,
with no offset. India has no DST, slot maths stays simple, and lexicographic order equals time
order (SQL `<` and `>` work on TEXT). The zone is in the clinic config. If we ever onboard
a business in a DST zone, switch storage to UTC instants + zone.

## 2026-10-02 — Vertical-agnostic naming
Config uses `BusinessConfig`, `resources` (doctors) and `services` (visit types), so another
vertical needs no schema change. Tool and table names that the spec fixes stay clinic-flavoured
(`find_patient`, `patients`), because "customer" would only add indirection today.

## 2026-10-02 — One JSON Schema document is the contract with Python
`packages/shared` exports every tool input/output, the clinic config and the call-log events
into `packages/shared/json-schema/contracts.json`, with shared types as named `$defs`.
A Vitest test fails if the file is stale; the agent's Pydantic models are generated from it,
and a pytest test fails if they are stale. One source of truth, two drift alarms.

## 2026-10-02 — Verification is enforced by the API, not only by the agent
`find_patient` returns a short-lived `verificationId` only when name + DOB or name + registered
phone match. Every patient-specific tool requires it, and the API refuses without it. A prompt
bug in the agent therefore cannot leak appointment details. `find_patient` returns the same
`not_verified` answer for every failure, so it can't be used to probe whether a name exists.
