# Hawk go-live report — Smile Dental Care (synthetic)

Run `18-leakage` · 2026-11-06T10:09:51.717Z · 39 simulated calls · clock pinned to 2026-10-12T05:30:00Z (Mon 12 Oct 2026, 11:00 IST)

Understanding: **rule-based (offline baseline)** · patients: **scripted** · soft criteria: not graded: the LLM judge for politeness/clarity needs a model key

> **Read this first:** Scripted patients say things the way the scenarios were written, so a high pass rate here is necessary but not sufficient. Real callers are messier: re-run with LLM-played patients and in audio mode before trusting a SAFE verdict for a pilot.

## Verdict by flow

| Flow | Verdict | Pass | Why |
|---|---|---|---|
| Inbound booking | **SAFE TO LAUNCH** | 100% (30/30) | 100% pass, no critical failure |
| Routing & messages | **SAFE TO LAUNCH** | 100% (9/9) | 100% pass, no critical failure |

_SAFE TO LAUNCH: ≥ 92% pass and no critical failure. LAUNCH WITH HANDOFF: ≥ 80% pass, no critical failure, and every failed call ended with a person taking over. NOT SAFE: anything else._

**Overall:** 100% pass (39/39) · latency p50 248 ms / p95 510 ms (text mode: agent processing + API round trips only. No speech-to-text or voice yet (M3).) · cost ₹0.00 per call (token cost not yet reported by the provider adapter)

## Pass rate by language

| Language | Pass | Calls |
|---|---|---|
| English | 100% | 13/13 |
| Hindi | 100% | 13/13 |
| Hinglish | 100% | 13/13 |

## Pass rate by business

| Business | Pass | Calls |
|---|---|---|
| restaurant | 100% | 39/39 |

## Pass rate by scenario type

| Type | Pass | Calls |
|---|---|---|
| allergy | 100% | 3/3 |
| book_new | 100% | 9/9 |
| cancel | 100% | 3/3 |
| faq | 100% | 9/9 |
| mind_change | 100% | 3/3 |
| party_too_large | 100% | 3/3 |
| reschedule | 100% | 3/3 |
| verification | 100% | 3/3 |
| waitlist | 100% | 3/3 |
## Soft criteria (LLM judge)

Not graded. not graded: the LLM judge for politeness/clarity needs a model key.

**Judge vs human:** Not measured yet: no human-labelled calls scored by the judge.


## Top failure modes

None. Every call passed every check.