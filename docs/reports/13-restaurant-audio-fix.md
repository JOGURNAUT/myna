# Hawk go-live report — Smile Dental Care (synthetic)

Run `13-restaurant-audio-fix` · 2026-11-05T22:10:53.076Z · 24 simulated calls · clock pinned to 2026-10-12T05:30:00Z (Mon 12 Oct 2026, 11:00 IST)

Understanding: **rule-based (offline baseline)** · patients: **scripted, spoken through Sarvam TTS and re-transcribed by Saaras** · soft criteria: not graded: the LLM judge for politeness/clarity needs a model key

Audio mode: **85 spoken caller turns** through Bulbul → Saaras · recognition p50 168 ms / p95 251 ms · est. speech cost ₹1.59 per call (assumed ₹30/hour speech-to-text and ₹30/10k characters text-to-speech; confirm against the Sarvam dashboard)

| Language | Spoken turns | Character error rate |
|---|---|---|
| en | 27 | 2.5% |
| hi | 24 | 103.4% |
| hinglish | 34 | n/a (spoken Roman, recognised in Devanagari) |

What recognition changed most (said → heard):

- [hinglish] "90000 00099" → "Nav shunya shunya shunya shunya shunya shunya shunya nav nav"
- [hinglish] "98222 00302" → "Nau aath do do do shunya shunya teen shunya do"
- [hinglish] "90000 00099" → "Nav shunya shunya shunya shunya shunya nav nav"
- [hinglish] "90000 00099" → "Nav, shunya shunya shunya shunya shunya no nav."
- [hi] "नहीं, बस। धन्यवाद।" → "Nahi, bas, dhanyavaad."
- [hi] "नहीं, बस। धन्यवाद।" → "Nahi, bas, dhanyavaad."

> **Read this first:** LLM-played patients vary between runs; compare spreads, not single numbers.

## Verdict by flow

| Flow | Verdict | Pass | Why |
|---|---|---|---|
| Inbound booking | **NOT SAFE** | 83% (15/18) | 3 critical failures |
| Routing & messages | **SAFE TO LAUNCH** | 100% (6/6) | 100% pass, no critical failure |

_SAFE TO LAUNCH: ≥ 92% pass and no critical failure. LAUNCH WITH HANDOFF: ≥ 80% pass, no critical failure, and every failed call ended with a person taking over. NOT SAFE: anything else._

**Overall:** 88% pass (21/24) · latency p50 128 ms / p95 249 ms (text mode: agent processing + API round trips only. No speech-to-text or voice yet (M3).) · cost ₹0.00 per call (token cost not yet reported by the provider adapter)

## Pass rate by language

| Language | Pass | Calls |
|---|---|---|
| English | 88% | 7/8 |
| Hindi | 100% | 8/8 |
| Hinglish | 75% | 6/8 |

## Pass rate by business

| Business | Pass | Calls |
|---|---|---|
| restaurant | 88% | 21/24 |

## Pass rate by scenario type

| Type | Pass | Calls |
|---|---|---|
| allergy | 100% | 2/2 |
| book_new | 100% | 6/6 |
| cancel | 100% | 2/2 |
| faq | 100% | 6/6 |
| mind_change | 100% | 2/2 |
| party_too_large | 100% | 2/2 |
| reschedule | 0% | 0/1 |
| verification | 0% | 0/2 |
| waitlist | 100% | 1/1 |
## Soft criteria (LLM judge)

Not graded. not graded: the LLM judge for politeness/clarity needs a model key.

**Judge vs human:** Not measured yet: no human-labelled calls scored by the judge.


## Top failure modes

### CRITICAL · `handoff` · 2 calls

Scenarios: rest-wrong-phone-sees-nothing (en), rest-wrong-phone-sees-nothing (hinglish)

Example (rest-wrong-phone-sees-nothing, English): expected verification_failed, got repeated_misunderstanding

> **Myna:** Namaste, main Myna hoon, Spice Route Kitchen ki automated AI assistant. Staff se baat karni ho toh kabhi bhi 'staff' boliye. Main aapki kya madad karoon?
>
> **Caller:** I want to cancel my appointment.
>
> **Myna:** May I have your name for the booking, please?
>
> **Caller:** My name is Deepa Menon.
>
> **Myna:** Which mobile number should we use for this booking?
>
> **Caller:** 900000099
>
> **Myna:** Sorry, I didn't catch that. Which mobile number should we use for this booking?
>
> **Caller:** 900000099
>
> **Myna:** I'm sorry, I'm having trouble understanding. Let me connect you to our staff.

### CRITICAL · `schedule_end_state` · 1 call

Scenarios: rest-reschedule-reservation (hinglish)

Example (rest-reschedule-reservation, Hinglish): missing [Imran Qureshi|table-4|2026-10-15T20:00|confirmed] unexpected [Imran Qureshi|table-4|2026-10-12T20:00|confirmed]

> **Myna:** Namaste, main Myna hoon, Spice Route Kitchen ki automated AI assistant. Staff se baat karni ho toh kabhi bhi 'staff' boliye. Main aapki kya madad karoon?
>
> **Caller:** Mera appointment change karna hai.
>
> **Myna:** Please booking ke liye apna naam bataiye.
>
> **Caller:** Mera naam Imran Qureshi hai
>
> **Myna:** Mujhe Table 3 par Tuesday, 13 October ko shaam 8 baje 4 logon ki table dikh raha hai. Iski jagah kaunsa din aur time chahiye?
>
> **Caller:** Karsade shaam 8:00 baji
>
> **Myna:** Monday, 12 October, shaam 8 baje ko Table 3 available hai. Confirm kar loon: Imran Qureshi ki 4 logon ki table, Table 3 par, Tuesday, 13 October shaam 8 baje se badal kar Monday, 12 October ko shaam 8 baje. Kya main badal doon?
>
> **Caller:** Haan ji.
>
> **Myna:** Ho gaya. Booking ab Monday, 12 October ko shaam 8 baje Table 3 par hai. Aapko SMS aa jayega. Kya main aur kuch madad kar sakti hoon?
>
> **Caller:** Nahi bas. Thank you.
>
> **Myna:** Spice Route Kitchen ko call karne ke liye thank you. Namaste!
