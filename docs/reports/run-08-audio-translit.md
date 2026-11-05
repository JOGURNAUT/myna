# Hawk go-live report — Smile Dental Care (synthetic)

Run `run-08-audio-translit` · 2026-11-05T10:28:21.667Z · 24 simulated calls · clock pinned to 2026-10-12T05:30:00Z (Mon 12 Oct 2026, 11:00 IST)

Understanding: **rule-based (offline baseline)** · patients: **scripted, spoken through Sarvam TTS and re-transcribed by Saaras** · soft criteria: not graded: the LLM judge for politeness/clarity needs a model key

Audio mode: **96 spoken caller turns** through Bulbul → Saaras · recognition p50 202 ms / p95 302 ms · est. speech cost ₹1.57 per call (assumed ₹30/hour speech-to-text and ₹30/10k characters text-to-speech; confirm against the Sarvam dashboard)

| Language | Spoken turns | Character error rate |
|---|---|---|
| hi | 33 | 98.1% |
| hinglish | 29 | n/a (spoken Roman, recognised in Devanagari) |
| en | 34 | 6.8% |

What recognition changed most (said → heard):

- [hi] "1 जनवरी 1991" → "Ek January unnis sau ikyaanve"
- [hi] "नहीं, बस। धन्यवाद।" → "Nahi bas dhanyavaad"
- [hi] "नहीं, बस। धन्यवाद।" → "Nahi bas dhanyavaad"
- [hi] "नहीं, बस। धन्यवाद।" → "Nahi, bas. Dhanyavaad."
- [hi] "नहीं, बस। धन्यवाद।" → "Nahi bas dhanyavaad"
- [hi] "मुझे सफ़ाई का अपॉइंटमेंट चाहिए कल दोपहर 12 बजे।" → "Mujhe safai ka appointment chahiye kal dopahar baarah baje"

> **Read this first:** LLM-played patients vary between runs; compare spreads, not single numbers.

## Verdict by flow

| Flow | Verdict | Pass | Why |
|---|---|---|---|
| Inbound booking | **NOT SAFE** | 87% (13/15) | 1 critical failure |
| Routing & messages | **NOT SAFE** | 75% (3/4) | 75% pass (< 80%) |
| Outbound reminders | **NOT SAFE** | 80% (4/5) | some failures did not end with a person |

_SAFE TO LAUNCH: ≥ 92% pass and no critical failure. LAUNCH WITH HANDOFF: ≥ 80% pass, no critical failure, and every failed call ended with a person taking over. NOT SAFE: anything else._

**Overall:** 83% pass (20/24) · latency p50 54 ms / p95 173 ms (text mode: agent processing + API round trips only. No speech-to-text or voice yet (M3).) · cost ₹0.00 per call (token cost not yet reported by the provider adapter)

## Pass rate by language

| Language | Pass | Calls |
|---|---|---|
| Hindi | 78% | 7/9 |
| Hinglish | 75% | 6/8 |
| English | 100% | 7/7 |

## Pass rate by scenario type

| Type | Pass | Calls |
|---|---|---|
| book_new | 100% | 2/2 |
| book_returning | 100% | 1/1 |
| doctor_callback | 100% | 1/1 |
| faq | 50% | 1/2 |
| handoff_request | 100% | 1/1 |
| kill_switch | 100% | 1/1 |
| medical | 100% | 1/1 |
| mind_change | 100% | 1/1 |
| mixed | 0% | 0/1 |
| persona_style | 100% | 2/2 |
| refill | 100% | 1/1 |
| reminder_cancel | 100% | 1/1 |
| reminder_confirm | 100% | 1/1 |
| reminder_opt_out | 100% | 1/1 |
| reminder_verification | 100% | 1/1 |
| reminder_wrong_number | 0% | 0/1 |
| report_status | 100% | 1/1 |
| reschedule | 100% | 1/1 |
| third_party | 50% | 1/2 |
| verification | 100% | 1/1 |
## Soft criteria (LLM judge)

Not graded. not graded: the LLM judge for politeness/clarity needs a model key.

**Judge vs human:** Not measured yet: no human-labelled calls scored by the judge.


## Top failure modes

### CRITICAL · `schedule_end_state` · 1 call

Scenarios: reschedule-for-father (hi)

Example (reschedule-for-father, Hindi): missing [Arjun Verma|consultation|2026-10-15T12:00|confirmed] unexpected [Arjun Verma|consultation|2026-10-12T12:00|confirmed]

> **Myna:** Namaste, main Myna hoon, Smile Dental Care ki automated AI assistant. Staff se baat karni ho toh kabhi bhi 'staff' boliye. Main aapki kya madad karoon?
>
> **Caller:** Papa ka appointment badalna hai.
>
> **Myna:** Zaroor. Patient ka poora naam kya hai? Mujhe unki details chahiye, aapki nahi.
>
> **Caller:** Mariz ka naam Arjun Verma hai.
>
> **Myna:** Thank you. Aur patient ki date of birth?
>
> **Caller:** 2 November 1985
>
> **Myna:** Mujhe Dr. Mehta ke saath Friday, 16 October ko subah 10 baje consultation dikh raha hai. Iski jagah kaunsa din aur time chahiye?
>
> **Caller:** Guruvaar dopahar 12:00 baje
>
> **Myna:** Dr. Mehta ke saath Monday, 12 October, dopahar 12 baje available hai. Confirm kar loon: Arjun Verma ka consultation, Dr. Mehta ke saath, Friday, 16 October subah 10 baje se badal kar Monday, 12 October ko dopahar 12 baje. Kya main badal doon?
>
> **Caller:** Haan ji.
>
> **Myna:** Ho gaya. Appointment ab Monday, 12 October ko dopahar 12 baje Dr. Mehta ke saath hai. Aapko SMS aa jayega. Kya main aur kuch madad kar sakti hoon?
>
> **Caller:** Nahi bas dhanyavaad
>
> **Myna:** Smile Dental Care ko call karne ke liye thank you. Namaste!

### HIGH · `schedule_end_state` · 1 call

Scenarios: msg-booking-and-report (hinglish)

Example (msg-booking-and-report, Hinglish): missing [Pooja Malhotra|cleaning|2026-10-13T12:00|confirmed] unexpected []

> **Myna:** Namaste, main Myna hoon, Smile Dental Care ki automated AI assistant. Staff se baat karni ho toh kabhi bhi 'staff' boliye. Main aapki kya madad karoon?
>
> **Caller:** Mujhe clinic ka appointment chahiye kal dobhar 12:00 baje aur ek baat meri report aa gayi kya?
>
> **Myna:** Visit kis liye hai? Jaise consultation, cleaning ya filling.
>
> **Caller:** Haan ji,
>
> **Myna:** Sorry, main samajh nahi paayi. Visit kis liye hai? Jaise consultation, cleaning ya filling.
>
> **Caller:** Haan ji,
>
> **Myna:** Sorry, mujhe theek se samajh nahi aa raha. Main aapko staff se jod rahi hoon.

### HIGH · `tasks_end_state` · 1 call

Scenarios: msg-booking-and-report (hinglish)

Example (msg-booking-and-report, Hinglish): expected 1 tasks, got 0

> **Myna:** Namaste, main Myna hoon, Smile Dental Care ki automated AI assistant. Staff se baat karni ho toh kabhi bhi 'staff' boliye. Main aapki kya madad karoon?
>
> **Caller:** Mujhe clinic ka appointment chahiye kal dobhar 12:00 baje aur ek baat meri report aa gayi kya?
>
> **Myna:** Visit kis liye hai? Jaise consultation, cleaning ya filling.
>
> **Caller:** Haan ji,
>
> **Myna:** Sorry, main samajh nahi paayi. Visit kis liye hai? Jaise consultation, cleaning ya filling.
>
> **Caller:** Haan ji,
>
> **Myna:** Sorry, mujhe theek se samajh nahi aa raha. Main aapko staff se jod rahi hoon.

### HIGH · `reminder_outcome` · 1 call

Scenarios: rem-wrong-number (hinglish)

Example (rem-wrong-number, Hinglish): recorded: [reached_family]

> **Myna:** Namaste, main Myna hoon, Smile Dental Care ki taraf se automated assistant. Kya meri baat Pooja se ho rahi hai?
>
> **Caller:** Gallup number hai, iss naam ka koi nahi hai.
>
> **Myna:** Koi baat nahi. Kya aap Pooja ko Smile Dental Care ko 98000 00001 pe call karne ko kahenge? Thank you, namaste.

### MEDIUM · `handoff` · 2 calls

Scenarios: faq-timings (hi), msg-booking-and-report (hinglish)

Example (faq-timings, Hindi): unexpected handoff: repeated_misunderstanding

> **Myna:** Namaste, main Myna hoon, Smile Dental Care ki automated AI assistant. Staff se baat karni ho toh kabhi bhi 'staff' boliye. Main aapki kya madad karoon?
>
> **Caller:** Clinic ka samay kya hai?
>
> **Myna:** Sorry, main samajh nahi paayi. Aap appointment book, change ya cancel karna chahte hain?
>
> **Caller:** Clinic ka samay kya hai
>
> **Myna:** Sorry, mujhe theek se samajh nahi aa raha. Main aapko staff se jod rahi hoon.
