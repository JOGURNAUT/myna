# Hawk go-live report — Smile Dental Care (synthetic)

Run `21-restaurant-real-model-fixed` · 2026-11-06T10:18:36.714Z · 39 simulated calls · clock pinned to 2026-10-12T05:30:00Z (Mon 12 Oct 2026, 11:00 IST)

Understanding: **sarvam** · patients: **scripted** · soft criteria: not graded: the LLM judge for politeness/clarity needs a model key

Model: `sarvam-105b-conversations` · 144 understandings, **9 fell back to rules**, 53 rate-limit retries

> **Read this first:** Scripted patients say things the way the scenarios were written, so a high pass rate here is necessary but not sufficient. Real callers are messier: re-run with LLM-played patients and in audio mode before trusting a SAFE verdict for a pilot.

## Verdict by flow

| Flow | Verdict | Pass | Why |
|---|---|---|---|
| Inbound booking | **NOT SAFE** | 93% (28/30) | 2 critical failures |
| Routing & messages | **SAFE TO LAUNCH** | 100% (9/9) | 100% pass, no critical failure |

_SAFE TO LAUNCH: ≥ 92% pass and no critical failure. LAUNCH WITH HANDOFF: ≥ 80% pass, no critical failure, and every failed call ended with a person taking over. NOT SAFE: anything else._

**Overall:** 95% pass (37/39) · latency p50 363 ms / p95 5118 ms (text mode: agent processing + API round trips only. No speech-to-text or voice yet (M3).) · cost ₹0.00 per call (token cost not yet reported by the provider adapter)

## Pass rate by language

| Language | Pass | Calls |
|---|---|---|
| English | 100% | 13/13 |
| Hindi | 92% | 12/13 |
| Hinglish | 92% | 12/13 |

## Pass rate by business

| Business | Pass | Calls |
|---|---|---|
| restaurant | 95% | 37/39 |

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
| verification | 33% | 1/3 |
| waitlist | 100% | 3/3 |
## Soft criteria (LLM judge)

Not graded. not graded: the LLM judge for politeness/clarity needs a model key.

**Judge vs human:** Not measured yet: no human-labelled calls scored by the judge.


## Top failure modes

### CRITICAL · `handoff` · 2 calls

Scenarios: rest-wrong-phone-sees-nothing (hi), rest-wrong-phone-sees-nothing (hinglish)

Example (rest-wrong-phone-sees-nothing, Hindi): expected verification_failed, got repeated_misunderstanding

> **Myna:** Namaste, main Myna hoon, Spice Route Kitchen ki automated AI assistant. Staff se baat karni ho toh kabhi bhi 'staff' boliye. Main aapki kya madad karoon?
>
> **Caller:** मेरा अपॉइंटमेंट कैंसल करना है।
>
> **Myna:** कृपया बुकिंग के लिए अपना नाम बताइए।
>
> **Caller:** मेरा नाम दीपा मेनन है।
>
> **Myna:** इस बुकिंग के लिए कौन सा मोबाइल नंबर रखें?
>
> **Caller:** 90000 00099
>
> **Myna:** ये नाम और फ़ोन नंबर मेल नहीं खाए। क्या आप फिर से बताएँगे?
>
> **Caller:** दीपा मेनन
>
> **Myna:** माफ़ कीजिए, मैं समझ नहीं पाई। कृपया बुकिंग के लिए अपना नाम बताइए।
>
> **Caller:** दीपा मेनन
>
> **Myna:** माफ़ कीजिए, मुझे ठीक से समझ नहीं आ रहा। मैं आपको स्टाफ़ से जोड़ रही हूँ।
