# Hawk go-live report — Smile Dental Care (synthetic)

Run `16-clinic-audio-sarvam` · 2026-11-05T22:54:04.406Z · 24 simulated calls · clock pinned to 2026-10-12T05:30:00Z (Mon 12 Oct 2026, 11:00 IST)

Understanding: **sarvam** · patients: **scripted, spoken through Sarvam TTS and re-transcribed by Saaras** · soft criteria: not graded: the LLM judge for politeness/clarity needs a model key

Model: `sarvam-105b-conversations` · 93 understandings, **0 fell back to rules**, 0 rate-limit retries

Audio mode: **95 spoken caller turns** through Bulbul → Saaras · recognition p50 160 ms / p95 251 ms · est. speech cost ₹1.59 per call (assumed ₹30/hour speech-to-text and ₹30/10k characters text-to-speech; confirm against the Sarvam dashboard)

| Language | Spoken turns | Character error rate |
|---|---|---|
| hi | 34 | 107.3% |
| hinglish | 30 | n/a (spoken Roman, recognised in Devanagari) |
| en | 31 | 2.8% |

What recognition changed most (said → heard):

- [hi] "2 नवंबर 1985" → "Do November unnees sau pachaasi"
- [hi] "1 जनवरी 1991" → "Ek January unnis sau ikyaanve"
- [hi] "1 जनवरी 1991" → "Ek January unnis sau ikyanve"
- [hi] "नहीं, बस। धन्यवाद।" → "Nahi, bas, dhanyavaad."
- [hi] "नहीं, बस। धन्यवाद।" → "Nahi, bas, dhanyavaad."
- [hi] "नहीं, बस। धन्यवाद।" → "Nahi. Bas, dhanyavaad."

> **Read this first:** LLM-played patients vary between runs; compare spreads, not single numbers.

## Verdict by flow

| Flow | Verdict | Pass | Why |
|---|---|---|---|
| Inbound booking | **SAFE TO LAUNCH** | 100% (15/15) | 100% pass, no critical failure |
| Routing & messages | **SAFE TO LAUNCH** | 100% (4/4) | 100% pass, no critical failure |
| Outbound reminders | **SAFE TO LAUNCH** | 100% (5/5) | 100% pass, no critical failure |

_SAFE TO LAUNCH: ≥ 92% pass and no critical failure. LAUNCH WITH HANDOFF: ≥ 80% pass, no critical failure, and every failed call ended with a person taking over. NOT SAFE: anything else._

**Overall:** 100% pass (24/24) · latency p50 480 ms / p95 604 ms (text mode: agent processing + API round trips only. No speech-to-text or voice yet (M3).) · cost ₹0.00 per call (token cost not yet reported by the provider adapter)

## Pass rate by language

| Language | Pass | Calls |
|---|---|---|
| Hindi | 100% | 9/9 |
| Hinglish | 100% | 8/8 |
| English | 100% | 7/7 |

## Pass rate by business

| Business | Pass | Calls |
|---|---|---|
| clinic | 100% | 24/24 |

## Pass rate by scenario type

| Type | Pass | Calls |
|---|---|---|
| book_new | 100% | 2/2 |
| book_returning | 100% | 1/1 |
| doctor_callback | 100% | 1/1 |
| faq | 100% | 2/2 |
| handoff_request | 100% | 1/1 |
| kill_switch | 100% | 1/1 |
| medical | 100% | 1/1 |
| mind_change | 100% | 1/1 |
| mixed | 100% | 1/1 |
| persona_style | 100% | 2/2 |
| refill | 100% | 1/1 |
| reminder_cancel | 100% | 1/1 |
| reminder_confirm | 100% | 1/1 |
| reminder_opt_out | 100% | 1/1 |
| reminder_verification | 100% | 1/1 |
| reminder_wrong_number | 100% | 1/1 |
| report_status | 100% | 1/1 |
| reschedule | 100% | 1/1 |
| third_party | 100% | 2/2 |
| verification | 100% | 1/1 |
## Soft criteria (LLM judge)

Not graded. not graded: the LLM judge for politeness/clarity needs a model key.

**Judge vs human:** Not measured yet: no human-labelled calls scored by the judge.


## Top failure modes

None. Every call passed every check.