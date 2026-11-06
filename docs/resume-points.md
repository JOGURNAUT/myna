# Resume points (every number checked against the repo on 2026-11-06)

Rules for this file: only claim what a report in `docs/reports/` shows, say what the test was, and
never round up. Framing: a general-purpose voice receptionist for businesses that take bookings
(restaurants shown first). Do not lead with clinics.

## Project line (one line, under the title)
**Myna + Hawk**: a multilingual (English / Hindi / Hinglish) AI phone receptionist for businesses
that take bookings, plus a test harness that checks it before go-live. One engine, one config file
per business. Python, TypeScript, Pipecat, Sarvam, Redis.

## Bullets (pick 4 or 5)

1. Built a Hinglish/Hindi/English **voice receptionist** for bookings (reserve, change, cancel,
   take a message) where the LLM only extracts intent and **code enforces the rules**: identity
   check and read-back before any change, answers only from the business's own config, and a human
   handoff when unsure. [`docs/decisions.md`]
2. Made the engine **config-driven**: a new business is one config file. Ran it on two business
   types, including restaurant reservations (party size, table fit, and a **waitlist that calls
   the guest back when a table opens**). [`docs/plan-generalise.md`]
3. Built **Hawk**, a test harness: simulated callers (text and spoken), grading on the final
   booking state, and a SAFE / NOT SAFE verdict per flow and language. Own suite of 145 scripted
   calls across two businesses, all passing. [`docs/reports/14-ask-day.md`]
4. Ran the Hinglish suite against the real Sarvam model: **9/34 passed at first contact, 33/34
   after** making the agent robust to a noisy model (closed-vocabulary decisions moved into code,
   a regression test per bug). Full suite on the real model: 102/103. [`run-03`, `run-04`,
   `docs/findings.md`]
5. Shipped **browser voice** (Pipecat WebRTC + Sarvam): about **0.95 s** felt pause after the
   caller stops (about 0.5 s of that is our own pipeline; measured with rule-based understanding),
   and added **Redis** (shared call state, reminder claims, rate limits); the 106-call suite also
   passed running across two agent instances. [`docs/plan-m3.md`, `run-05`]
6. Spoken smoke tests with the real model (24 calls each): **24/24 on one business type, 21/24 on
   the other**. The 3 misses were speech recognition on names and long numbers (nothing
   disclosed). [`run-15`, `run-16`]

## Three-line version
- Built a Hinglish voice receptionist for bookings: the LLM suggests, code decides.
- Config-driven: tested on two business types, restaurant reservations with a waitlist callback.
- Built a test harness (text + spoken) that grades the final booking state.

## What an interviewer may ask, and the honest answer
- **"Is 99% real?"** It is 102/103 on my own 103-call scripted suite against the real model. The
  callers are scripted, not live people, and I wrote the suite. The 26% to 97% jump is on the
  34 Hinglish calls. Most of that was my agent being brittle to model output, not the model.
- **"Is it deployed?"** No. No real clinic or restaurant uses it yet. It is pilot-ready.
- **"Spoken results?"** 24-call samples (one call is 4 points); the recogniser is not
  deterministic, so these are smoke tests, not rates.
- **"Latency?"** 0.95 s felt, measured in the browser demo with rule-based understanding; the real
  model adds about 0.4 s at p50. Not measured over a phone line.
- **"Phone number?"** Not built. LiveKit vs Pipecat and Plivo are researched from docs only.
- **"Known bug?"** The waitlist offer does not understand "haan daal do" (found 2026-11-06 by a
  manual call, not yet fixed). Do not demo the waitlist live.
- **"Judge?"** An LLM judge exists but its agreement with my labels has not been measured.
