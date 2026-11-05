# Hawk go-live report — Smile Dental Care (synthetic)

Run `run-09-audio-translit` · 2026-11-05T10:34:47.410Z · 24 simulated calls · clock pinned to 2026-10-12T05:30:00Z (Mon 12 Oct 2026, 11:00 IST)

Understanding: **rule-based (offline baseline)** · patients: **scripted, spoken through Sarvam TTS and re-transcribed by Saaras** · soft criteria: not graded: the LLM judge for politeness/clarity needs a model key

Audio mode: **97 spoken caller turns** through Bulbul → Saaras · recognition p50 225 ms / p95 666 ms · est. speech cost ₹1.61 per call (assumed ₹30/hour speech-to-text and ₹30/10k characters text-to-speech; confirm against the Sarvam dashboard)

| Language | Spoken turns | Character error rate |
|---|---|---|
| hi | 34 | 103.7% |
| hinglish | 30 | n/a (spoken Roman, recognised in Devanagari) |
| en | 33 | 5.5% |

What recognition changed most (said → heard):

- [hi] "2 नवंबर 1985" → "Do November unnees sau pachaasi"
- [hi] "1 जनवरी 1991" → "Ek January unnis sau ikyanve"
- [hinglish] "7 July 1987" → "Saat July unnees sau sattaasi"
- [hi] "नहीं, बस। धन्यवाद।" → "Nahi, bas dhanyavaad."
- [hi] "नहीं, बस। धन्यवाद।" → "Nahi, bas, dhanyavaad."
- [hi] "नहीं, बस। धन्यवाद।" → "Nahi, bas. Dhanyavaad."

> **Read this first:** LLM-played patients vary between runs; compare spreads, not single numbers.

## Verdict by flow

| Flow | Verdict | Pass | Why |
|---|---|---|---|
| Inbound booking | **SAFE TO LAUNCH** | 93% (14/15) | 93% pass, no critical failure |
| Routing & messages | **SAFE TO LAUNCH** | 100% (4/4) | 100% pass, no critical failure |
| Outbound reminders | **SAFE TO LAUNCH** | 100% (5/5) | 100% pass, no critical failure |

_SAFE TO LAUNCH: ≥ 92% pass and no critical failure. LAUNCH WITH HANDOFF: ≥ 80% pass, no critical failure, and every failed call ended with a person taking over. NOT SAFE: anything else._

**Overall:** 96% pass (23/24) · latency p50 61 ms / p95 109 ms (text mode: agent processing + API round trips only. No speech-to-text or voice yet (M3).) · cost ₹0.00 per call (token cost not yet reported by the provider adapter)

## Pass rate by language

| Language | Pass | Calls |
|---|---|---|
| Hindi | 89% | 8/9 |
| Hinglish | 100% | 8/8 |
| English | 100% | 7/7 |

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
| third_party | 50% | 1/2 |
| verification | 100% | 1/1 |
## Soft criteria (LLM judge)

Not graded. not graded: the LLM judge for politeness/clarity needs a model key.

**Judge vs human:** Not measured yet: no human-labelled calls scored by the judge.


## Top failure modes

### LOW · `reply_language` · 1 call

Scenarios: reschedule-for-father (hi)

Example (reschedule-for-father, Hindi): 1 replies not in hi, e.g. "I see a consultation on Friday, 16 October at 10 am with Dr. Mehta. Which day and time would you like instead?"

> **Myna:** Namaste, main Myna hoon, Smile Dental Care ki automated AI assistant. Staff se baat karni ho toh kabhi bhi 'staff' boliye. Main aapki kya madad karoon?
>
> **Caller:** Papa ka appointment badalna hai.
>
> **Myna:** Zaroor. Patient ka poora naam kya hai? Mujhe unki details chahiye, aapki nahi.
>
> **Caller:** Marees ka naam Arjun Verma hai
>
> **Myna:** Thank you. Aur patient ki date of birth?
>
> **Caller:** Do November unnees sau pachaasi
>
> **Myna:** I see a consultation on Friday, 16 October at 10 am with Dr. Mehta. Which day and time would you like instead?
>
> **Caller:** Guruvaar dopahar 12:00 baje
>
> **Myna:** Dr. Mehta ke saath Thursday, 15 October, dopahar 12 baje available hai. Confirm kar loon: Arjun Verma ka consultation, Dr. Mehta ke saath, Friday, 16 October subah 10 baje se badal kar Thursday, 15 October ko dopahar 12 baje. Kya main badal doon?
>
> **Caller:** Haan ji,
>
> **Myna:** Ho gaya. Appointment ab Thursday, 15 October ko dopahar 12 baje Dr. Mehta ke saath hai. Aapko SMS aa jayega. Kya main aur kuch madad kar sakti hoon?
>
> **Caller:** Nahi bas dhanyavaad
>
> **Myna:** Smile Dental Care ko call karne ke liye thank you. Namaste!
