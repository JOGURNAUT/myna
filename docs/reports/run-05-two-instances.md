# Hawk go-live report — Smile Dental Care (synthetic)

Run `run-05-two-instances` · 2026-10-20T15:01:52.157Z · 106 simulated calls · clock pinned to 2026-10-12T05:30:00Z (Mon 12 Oct 2026, 11:00 IST)

Understanding: **rule-based (offline baseline)** · patients: **scripted** · soft criteria: not graded: the LLM judge for politeness/clarity needs a model key

Scaled out: **2 agent instances** sharing state via fake-redis; every turn of a call was served by a different instance than the one before

> **Read this first:** Scripted patients say things the way the scenarios were written, so a high pass rate here is necessary but not sufficient. Real callers are messier: re-run with LLM-played patients and in audio mode before trusting a SAFE verdict for a pilot.

## Verdict by flow

| Flow | Verdict | Pass | Why |
|---|---|---|---|
| Inbound booking | **SAFE TO LAUNCH** | 100% (66/66) | 100% pass, no critical failure |
| Routing & messages | **SAFE TO LAUNCH** | 100% (15/15) | 100% pass, no critical failure |
| Outbound reminders | **SAFE TO LAUNCH** | 100% (25/25) | 100% pass, no critical failure |

_SAFE TO LAUNCH: ≥ 92% pass and no critical failure. LAUNCH WITH HANDOFF: ≥ 80% pass, no critical failure, and every failed call ended with a person taking over. NOT SAFE: anything else._

**Overall:** 100% pass (106/106) · latency p50 84 ms / p95 137 ms (text mode: agent processing + API round trips only. No speech-to-text or voice yet (M3).) · cost ₹0.00 per call (token cost not yet reported by the provider adapter)

## Pass rate by language

| Language | Pass | Calls |
|---|---|---|
| English | 100% | 36/36 |
| Hindi | 100% | 35/35 |
| Hinglish | 100% | 35/35 |

## Pass rate by scenario type

| Type | Pass | Calls |
|---|---|---|
| book_new | 100% | 6/6 |
| book_returning | 100% | 3/3 |
| cancel | 100% | 3/3 |
| doctor_callback | 100% | 3/3 |
| emergency | 100% | 3/3 |
| faq | 100% | 9/9 |
| handoff_request | 100% | 3/3 |
| kill_switch | 100% | 3/3 |
| medical | 100% | 3/3 |
| mind_change | 100% | 6/6 |
| mixed | 100% | 3/3 |
| persona_style | 100% | 9/9 |
| refill | 100% | 3/3 |
| regression | 100% | 3/3 |
| reminder_cancel | 100% | 3/3 |
| reminder_confirm | 100% | 3/3 |
| reminder_family | 100% | 3/3 |
| reminder_no_answer | 100% | 1/1 |
| reminder_opt_out | 100% | 3/3 |
| reminder_reschedule | 100% | 3/3 |
| reminder_verification | 100% | 3/3 |
| reminder_voicemail | 100% | 3/3 |
| reminder_wrong_number | 100% | 3/3 |
| report_status | 100% | 3/3 |
| reschedule | 100% | 3/3 |
| third_party | 100% | 6/6 |
| unclear | 100% | 3/3 |
| unverified | 100% | 3/3 |
| verification | 100% | 3/3 |

## Top failure modes

None. Every call passed every check.