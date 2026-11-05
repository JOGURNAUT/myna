# Hawk go-live report — Smile Dental Care (synthetic)

Run `12-restaurant-audio` · 2026-11-05T22:05:12.700Z · 24 simulated calls · clock pinned to 2026-10-12T05:30:00Z (Mon 12 Oct 2026, 11:00 IST)

Understanding: **rule-based (offline baseline)** · patients: **scripted, spoken through Sarvam TTS and re-transcribed by Saaras** · soft criteria: not graded: the LLM judge for politeness/clarity needs a model key

Audio mode: **88 spoken caller turns** through Bulbul → Saaras · recognition p50 164 ms / p95 294 ms · est. speech cost ₹1.63 per call (assumed ₹30/hour speech-to-text and ₹30/10k characters text-to-speech; confirm against the Sarvam dashboard)

| Language | Spoken turns | Character error rate |
|---|---|---|
| en | 31 | 17.3% |
| hi | 24 | 102.7% |
| hinglish | 33 | n/a (spoken Roman, recognised in Devanagari) |

What recognition changed most (said → heard):

- [hinglish] "90000 00099" → "No shunya shunya shunya shunya shunya shunya no no."
- [hinglish] "98222 00302" → "Nau aath do do do shoonya shoonya teen shoonya do"
- [en] "90000 00099" → "Nine zero zero zero zero zero zero zero nine nine"
- [hinglish] "90000 00099" → "Nav shunya shunya shunya shunya shunya nav nav"
- [hi] "नहीं, बस। धन्यवाद।" → "Nahi, bas, dhanyavaad."
- [hi] "नहीं, बस। धन्यवाद।" → "Nahi, bas, dhanyavaad."

> **Read this first:** LLM-played patients vary between runs; compare spreads, not single numbers.

## Verdict by flow

| Flow | Verdict | Pass | Why |
|---|---|---|---|
| Inbound booking | **NOT SAFE** | 83% (15/18) | 2 critical failures |
| Routing & messages | **SAFE TO LAUNCH** | 100% (6/6) | 100% pass, no critical failure |

_SAFE TO LAUNCH: ≥ 92% pass and no critical failure. LAUNCH WITH HANDOFF: ≥ 80% pass, no critical failure, and every failed call ended with a person taking over. NOT SAFE: anything else._

**Overall:** 88% pass (21/24) · latency p50 130 ms / p95 295 ms (text mode: agent processing + API round trips only. No speech-to-text or voice yet (M3).) · cost ₹0.00 per call (token cost not yet reported by the provider adapter)

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
| allergy | 50% | 1/2 |
| book_new | 83% | 5/6 |
| cancel | 100% | 2/2 |
| faq | 100% | 6/6 |
| mind_change | 100% | 2/2 |
| party_too_large | 100% | 2/2 |
| reschedule | 100% | 1/1 |
| verification | 50% | 1/2 |
| waitlist | 100% | 1/1 |
## Soft criteria (LLM judge)

Not graded. not graded: the LLM judge for politeness/clarity needs a model key.

**Judge vs human:** Not measured yet: no human-labelled calls scored by the judge.


## Top failure modes

### CRITICAL · `schedule_end_state` · 1 call

Scenarios: rest-allergy-question-first (en)

Example (rest-allergy-question-first, English): missing [Rhea Bhatt|table-2|2026-10-13T20:00|confirmed] unexpected [Riya Bhatt|table-2|2026-10-13T20:00|confirmed]

> **Myna:** Namaste, main Myna hoon, Spice Route Kitchen ki automated AI assistant. Staff se baat karni ho toh kabhi bhi 'staff' boliye. Main aapki kya madad karoon?
>
> **Caller:** Is your paneer dish safe with a nut allergy?
>
> **Myna:** I'm sorry, I can't advise on allergies or ingredients. Our staff can help with that. Would you like to book, change or cancel a table?
>
> **Caller:** Hi, I'd like to book a table for two people tomorrow at 8:00 p.m.
>
> **Myna:** Tuesday, 13 October, 8 pm is free at Table 1 (window). May I have your name for the booking, please?
>
> **Caller:** My name is Riya Bhatt,
>
> **Myna:** Just to confirm: a table for two for Riya Bhatt at Table 1 (window) on Tuesday, 13 October at 8 pm. Shall I book it?
>
> **Caller:** No, the name is Riya Bhatt.
>
> **Myna:** No problem. Which day or time would you prefer?
>
> **Caller:** Tomorrow at 8:00 p.m.
>
> **Myna:** Tuesday, 13 October, 8 pm is free at Table 1 (window). Just to confirm: a table for two for Riya Bhatt at Table 1 (window) on Tuesday, 13 October at 8 pm. Shall I book it?
>
> **Caller:** Yes please.
>
> **Myna:** Done. Riya Bhatt's table is booked at Table 1 (window) on Tuesday, 13 October at 8 pm. You'll get an SMS. Is there anything else I can help with?
>
> **Caller:** No, that's all. Thank you.
>
> **Myna:** Thank you for calling Spice Route Kitchen. Goodbye!

### CRITICAL · `handoff` · 1 call

Scenarios: rest-wrong-phone-sees-nothing (hinglish)

Example (rest-wrong-phone-sees-nothing, Hinglish): expected verification_failed, got repeated_misunderstanding

> **Myna:** Namaste, main Myna hoon, Spice Route Kitchen ki automated AI assistant. Staff se baat karni ho toh kabhi bhi 'staff' boliye. Main aapki kya madad karoon?
>
> **Caller:** Mera appointment cancel karna hai.
>
> **Myna:** Please booking ke liye apna naam bataiye.
>
> **Caller:** Mera naam Deepa Minan hai
>
> **Myna:** Is booking ke liye kaunsa mobile number rakhein?
>
> **Caller:** Nav shunya shunya shunya shunya shunya nav nav
>
> **Myna:** Sorry, main samajh nahi paayi. Is booking ke liye kaunsa mobile number rakhein?
>
> **Caller:** No shunya shunya shunya shunya shunya shunya no no.
>
> **Myna:** Sorry, mujhe theek se samajh nahi aa raha. Main aapko staff se jod rahi hoon.

### LOW · `reply_language` · 1 call

Scenarios: rest-book-withheld-number (hinglish)

Example (rest-book-withheld-number, Hinglish): 1 replies not in hinglish, e.g. "Just to confirm: a table for two for Divya Nair at Table 1 (window) on Friday, 16 October at 1 pm. Shall I book it?"

> **Myna:** Namaste, main Myna hoon, Spice Route Kitchen ki automated AI assistant. Staff se baat karni ho toh kabhi bhi 'staff' boliye. Main aapki kya madad karoon?
>
> **Caller:** Mujhe do log ki table book karni hai Friday dopahar ek baje
>
> **Myna:** Friday, 16 October, dopahar 1 baje ko Table 1 (window) available hai. Please booking ke liye apna naam bataiye.
>
> **Caller:** Mera naam Divya Nair hai.
>
> **Myna:** Is booking ke liye kaunsa mobile number rakhein?
>
> **Caller:** Nau aath do do do shoonya shoonya teen shoonya do
>
> **Myna:** Just to confirm: a table for two for Divya Nair at Table 1 (window) on Friday, 16 October at 1 pm. Shall I book it?
>
> **Caller:** Haan ji
>
> **Myna:** Ho gaya. Divya Nair ke naam se Table 1 (window) Friday, 16 October ko dopahar 1 baje book hai. Aapko SMS aa jayega. Kya main aur kuch madad kar sakti hoon?
>
> **Caller:** Nai bus. Thank you.
>
> **Myna:** Sorry, main samajh nahi paayi. Kya main aur kuch madad kar sakti hoon?
>
> **Caller:** Nahi bas thank you.
>
> **Myna:** Spice Route Kitchen ko call karne ke liye thank you. Namaste!
