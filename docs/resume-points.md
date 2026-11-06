# Resume points (every number is in the repo; source in brackets)

Updated 2026-11-06.

## Project line (one line, under the title)
**Myna + Hawk**: a multilingual (English / Hindi / Hinglish) AI phone receptionist for Indian
businesses, with a test harness that decides if it is safe to go live. Built on clinics and
restaurant reservations, one engine, config-driven. TypeScript, Python, Pipecat, Sarvam, Redis.

## Bullets (pick 4 or 5)

1. Built a Hinglish/Hindi/English **voice receptionist** where the LLM only extracts intent and
   **code enforces the rules** (emergency handoff, no medical advice, identity check and read-back
   before any booking change). [`docs/decisions.md`]
2. Built **Hawk**, a test harness: simulated callers (text and spoken), grading on the final
   schedule state, and a SAFE / NOT SAFE verdict per flow and language. 145 scripted calls across
   two businesses, all three flows SAFE. [`docs/reports/run-14`]
3. Took the real-model pass rate from **26% to 99%** by moving fixed-answer decisions into code,
   with a regression test for every bug. [`run-03` to `run-04`, `docs/findings.md`]
4. Generalised the engine from clinics to **restaurant reservations** (party size, name + phone
   check, **waitlist with a "table opened" callback**) with the same code and one config file per
   business. [`docs/plan-generalise.md`]
5. Shipped **browser voice** (Pipecat + Sarvam), about 0.5 s from end of speech to first audio,
   and made it **scale out with Redis** (shared call state, no double calls, shared rate limits),
   proven by running Hawk across two agent instances. [`docs/plan-m3.md`, `docs/plan-redis.md`]
6. Ran spoken tests with the real model: **24/24 on clinics, 21/24 on restaurants**; the misses
   were speech recognition on names and long numbers, which the agent hands to staff safely.
   [`run-15`, `run-16`, `docs/findings.md`]

## Three-line version
- Built a Hinglish voice receptionist: the LLM suggests, code decides; safety rules live in code.
- Built a test harness (text + spoken) that grades outcomes; real-model pass rate 26% to 99%.
- Works for clinics and restaurants from config alone; browser voice with Pipecat + Sarvam; Redis
  for scale-out.

## Do not claim
- Used by real clinics or restaurants. There is no pilot yet. Say "pilot-ready".
- The spoken results as a pass rate. They are 24-call samples (4 points per call) and the
  recogniser is not deterministic. Say "spoken smoke tests".
- Latency with the real model. The 0.5 s figure was with rule-based understanding; the model adds
  about 0.4 s at p50.
- A phone number. Telephony (LiveKit vs Pipecat, Plivo) is researched, not built.
