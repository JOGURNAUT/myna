# Resume points (every number is in the repo; source in brackets)

Updated 2026-11-06. Framing: a general-purpose voice receptionist for businesses that take bookings
(restaurants shown first). Do not lead with clinics.

## Project line (one line, under the title)
**Myna + Hawk**: a multilingual (English / Hindi / Hinglish) AI phone receptionist for any business
that takes bookings, plus a test harness that decides if it is safe to go live. One engine, one
config file per business. Python, TypeScript, Pipecat, Sarvam, Redis.

## Bullets (pick 4 or 5)

1. Built a Hinglish/Hindi/English **voice receptionist** for bookings (reserve, change, cancel,
   take a message) where the LLM only extracts intent and **code enforces the rules**: identity
   check and read-back before any change, no guessing answers the business never gave, and a
   human handoff when unsure. [`docs/decisions.md`]
2. Made the engine **business-agnostic**: a new business is one config file (hours, tables or
   staff, services, rules). Proved it with restaurant reservations: party size, table fit, and a
   **waitlist that calls the guest back when a table opens**. [`docs/plan-generalise.md`]
3. Built **Hawk**, a test harness: simulated callers (text and spoken), grading on the final
   booking state, and a SAFE / NOT SAFE verdict per flow and language. 145 scripted calls across
   two businesses, all SAFE. [`docs/reports/run-14`]
4. Took the real-model pass rate from **26% to 99%** by moving fixed-answer decisions into code,
   with a regression test for every bug. [`run-03` to `run-04`, `docs/findings.md`]
5. Shipped **browser voice** (Pipecat + Sarvam), about 0.5 s from end of speech to first audio,
   and made it **scale out with Redis** (shared call state, no double calls, shared rate limits),
   proven by running Hawk across two agent instances. [`docs/plan-m3.md`, `docs/plan-redis.md`]
6. Ran spoken tests with the real model on both business types (**24/24 and 21/24**); the misses
   were speech recognition on names and long numbers, which the agent hands to staff safely.
   [`run-15`, `run-16`, `docs/findings.md`]

## Three-line version
- Built a Hinglish voice receptionist for bookings: the LLM suggests, code decides.
- Config-driven: new business, new file. Restaurant reservations with a waitlist callback.
- Built a test harness (text + spoken) that grades outcomes; real-model pass rate 26% to 99%.

## Do not claim
- Used by real businesses. There is no pilot yet. Say "pilot-ready".
- The spoken results as a pass rate. They are 24-call samples (4 points per call) and the
  recogniser is not deterministic. Say "spoken smoke tests".
- Latency with the real model. The 0.5 s figure was with rule-based understanding; the model adds
  about 0.4 s at p50.
- A phone number. Telephony (LiveKit vs Pipecat, Plivo) is researched, not built.
- A live waitlist demo: natural Hinglish "haan daal do" is not understood yet (found 2026-11-06).
