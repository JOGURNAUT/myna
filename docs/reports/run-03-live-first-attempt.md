# Hawk go-live report — Smile Dental Care (synthetic)

Run `hawk-2026-10-20-13-56-59` · 2026-10-20T13:56:59.971Z · 34 simulated calls · clock pinned to 2026-10-12T05:30:00Z (Mon 12 Oct 2026, 11:00 IST)

Understanding: **sarvam** · patients: **scripted** · soft criteria: not graded: the LLM judge for politeness/clarity needs a model key

Model: `sarvam-105b-conversations` · 144 understandings, **0 fell back to rules**, 47 rate-limit retries

> **Read this first:** Scripted patients say things the way the scenarios were written, so a high pass rate here is necessary but not sufficient. Real callers are messier: re-run with LLM-played patients and in audio mode before trusting a SAFE verdict for a pilot.

## Verdict by flow

| Flow | Verdict | Pass | Why |
|---|---|---|---|
| Inbound booking | **NOT SAFE** | 29% (6/21) | 29% pass (< 80%); 1 critical failure |
| Routing & messages | **NOT SAFE** | 0% (0/5) | 0% pass (< 80%) |
| Outbound reminders | **NOT SAFE** | 38% (3/8) | 38% pass (< 80%) |

_SAFE TO LAUNCH: ≥ 92% pass and no critical failure. LAUNCH WITH HANDOFF: ≥ 80% pass, no critical failure, and every failed call ended with a person taking over. NOT SAFE: anything else._

**Overall:** 26% pass (9/34) · latency p50 370 ms / p95 2105 ms (text mode: agent processing + API round trips only. No speech-to-text or voice yet (M3).) · cost ₹0.00 per call (token cost not yet reported by the provider adapter)

## Pass rate by language

| Language | Pass | Calls |
|---|---|---|
| Hinglish | 26% | 9/34 |

## Pass rate by scenario type

| Type | Pass | Calls |
|---|---|---|
| book_new | 0% | 0/2 |
| book_returning | 0% | 0/1 |
| cancel | 0% | 0/1 |
| doctor_callback | 0% | 0/1 |
| emergency | 100% | 1/1 |
| faq | 33% | 1/3 |
| handoff_request | 100% | 1/1 |
| kill_switch | 100% | 1/1 |
| medical | 0% | 0/1 |
| mind_change | 0% | 0/2 |
| mixed | 0% | 0/1 |
| persona_style | 0% | 0/2 |
| refill | 0% | 0/1 |
| regression | 0% | 0/1 |
| reminder_cancel | 0% | 0/1 |
| reminder_confirm | 0% | 0/1 |
| reminder_family | 100% | 1/1 |
| reminder_opt_out | 100% | 1/1 |
| reminder_reschedule | 0% | 0/1 |
| reminder_verification | 0% | 0/1 |
| reminder_voicemail | 100% | 1/1 |
| reminder_wrong_number | 0% | 0/1 |
| report_status | 0% | 0/1 |
| reschedule | 0% | 0/1 |
| third_party | 0% | 0/2 |
| unclear | 100% | 1/1 |
| unverified | 0% | 0/1 |
| verification | 100% | 1/1 |

## Top failure modes

### CRITICAL · `schedule_end_state` · 1 call

Scenarios: book-mumbled-date-of-birth (hinglish)

Example (book-mumbled-date-of-birth, Hinglish): missing [] unexpected [Mohan Lal|cleaning|2026-10-13T12:30|confirmed]

> **Myna:** Namaste, main Myna hoon, Smile Dental Care ki automated AI assistant. Staff se baat karni ho toh kabhi bhi 'staff' boliye. Main aapki kya madad karoon?
>
> **Caller:** Mujhe cleaning ka appointment chahiye kal dopahar 12 baje.
>
> **Myna:** Dr. Mehta ke saath Tuesday, 13 October, dopahar 12 baje available hai. Please patient ka poora naam bataiye.
>
> **Caller:** Mera naam Mohan Lal hai.
>
> **Myna:** Thank you. Aur patient ki date of birth?
>
> **Caller:** baarah April unnees sau nabbe
>
> **Myna:** Confirm kar loon: Mohan Lal ke liye Dr. Mehta ke saath cleaning, Tuesday, 13 October ko dopahar 12 baje. Kya main book kar doon?
>
> **Caller:** Haan ji.
>
> **Myna:** हो गया। Mohan Lal का अपॉइंटमेंट Dr. Mehta के साथ मंगलवार, 13 अक्टूबर को दोपहर 12 बजे बुक है। आपको SMS आ जाएगा। क्या मैं और कुछ मदद कर सकती हूँ?
>
> **Caller:** Nahi, bas. Thank you.
>
> **Myna:** Aap appointment book, change ya cancel karna chahte hain?
>
> **Caller:** Mujhe cleaning ka appointment chahiye kal dopahar 12 baje.
>
> **Myna:** Dr. Mehta ke saath Tuesday, 13 October, dopahar 12:30 baje available hai. Aapko kaunsa chahiye?
>
> **Caller:** pehla wala
>
> **Myna:** Confirm kar loon: Mohan Lal ke liye Dr. Mehta ke saath cleaning, Tuesday, 13 October ko dopahar 12:30 baje. Kya main book kar doon?
>
> **Caller:** Haan ji.
>
> **Myna:** Ho gaya. Mohan Lal ka appointment Dr. Mehta ke saath Tuesday, 13 October ko dopahar 12:30 baje book hai. Aapko SMS aa jayega. Kya main aur kuch madad kar sakti hoon?
>
> **Caller:** Nahi, bas. Thank you.
>
> **Myna:** Would you like to book, change or cancel an appointment?
>
> **Caller:** Mujhe cleaning ka appointment chahiye kal dopahar 12 baje.
>
> **Myna:** Sorry, us time kuch available nahi hai. Wednesday, 14 October ko Dr. Rao ke saath dopahar 12 baje, dopahar 12:15 baje ya dopahar 12:30 baje available hai. Kaunsa time chahiye?
>
> **Caller:** pehla wala
>
> **Myna:** Confirm kar loon: Mohan Lal ke liye Dr. Rao ke saath cleaning, Wednesday, 14 October ko dopahar 12 baje. Kya main book kar doon?
>
> **Caller:** Haan ji.

### HIGH · `call_completed` · 13 calls

Scenarios: book-for-mother (hinglish), book-inline-correction (hinglish), book-mind-change-at-read-back (hinglish), book-mumbled-date-of-birth (hinglish), book-new-patient (hinglish), book-patient-named-like-a-doctor (hinglish), book-rambling-caller (hinglish), book-returning-picks-second-option (hinglish), book-with-a-named-doctor (hinglish), medical-question-mid-booking (hinglish), msg-booking-and-report (hinglish), msg-refill (hinglish), reschedule-by-caller-id (hinglish)

Example (book-for-mother, Hinglish): the call errored: Unexpected token 'I', "Internal S"... is not valid JSON

> **Myna:** Namaste, main Myna hoon, Smile Dental Care ki automated AI assistant. Staff se baat karni ho toh kabhi bhi 'staff' boliye. Main aapki kya madad karoon?
>
> **Caller:** Meri mummy ke liye checkup ka appointment chahiye kal dopahar 12 baje.
>
> **Myna:** Dr. Mehta ke saath Tuesday, 13 October, dopahar 12 baje available hai. Please patient ka poora naam bataiye.
>
> **Caller:** Patient ka naam Kamla Devi hai.
>
> **Myna:** Thank you. Aur patient ki date of birth?
>
> **Caller:** 2 February 1958
>
> **Myna:** Confirm kar loon: Kamla Devi ke liye Dr. Mehta ke saath consultation, Tuesday, 13 October ko dopahar 12 baje. Kya main book kar doon?
>
> **Caller:** Haan ji.

### HIGH · `schedule_end_state` · 10 calls

Scenarios: book-for-mother (hinglish), book-inline-correction (hinglish), book-mind-change-at-read-back (hinglish), book-new-patient (hinglish), book-patient-named-like-a-doctor (hinglish), book-rambling-caller (hinglish), book-with-a-named-doctor (hinglish), rem-cancel (hinglish), rem-reschedule (hinglish), reschedule-by-caller-id (hinglish)

Example (book-for-mother, Hinglish): missing [Kamla Devi|consultation|2026-10-13T12:00|confirmed] unexpected []

> **Myna:** Namaste, main Myna hoon, Smile Dental Care ki automated AI assistant. Staff se baat karni ho toh kabhi bhi 'staff' boliye. Main aapki kya madad karoon?
>
> **Caller:** Meri mummy ke liye checkup ka appointment chahiye kal dopahar 12 baje.
>
> **Myna:** Dr. Mehta ke saath Tuesday, 13 October, dopahar 12 baje available hai. Please patient ka poora naam bataiye.
>
> **Caller:** Patient ka naam Kamla Devi hai.
>
> **Myna:** Thank you. Aur patient ki date of birth?
>
> **Caller:** 2 February 1958
>
> **Myna:** Confirm kar loon: Kamla Devi ke liye Dr. Mehta ke saath consultation, Tuesday, 13 October ko dopahar 12 baje. Kya main book kar doon?
>
> **Caller:** Haan ji.

### HIGH · `reminder_outcome` · 4 calls

Scenarios: rem-cancel (hinglish), rem-confirm (hinglish), rem-reschedule (hinglish), rem-wrong-date-of-birth (hinglish)

Example (rem-cancel, Hinglish): recorded: []

> **Myna:** Namaste, main Myna hoon, Smile Dental Care ki taraf se automated assistant. Kya meri baat Pooja se ho rahi hai?
>
> **Caller:** Haan, main hi bol rahi hoon.
>
> **Myna:** Sorry, main samajh nahi paayi. Namaste, main Myna hoon, Smile Dental Care ki taraf se automated assistant. Kya meri baat Pooja se ho rahi hai?
>
> **Caller:** Haan, main hi bol rahi hoon.
>
> **Myna:** Sorry, main samajh nahi paayi. Namaste, main Myna hoon, Smile Dental Care ki taraf se automated assistant. Kya meri baat Pooja se ho rahi hai?
>
> **Caller:** Haan, main hi bol rahi hoon.
>
> **Myna:** Sorry, mujhe theek se samajh nahi aa raha. Main aapko staff se jod rahi hoon.

### HIGH · `tasks_end_state` · 3 calls

Scenarios: msg-billing-unverified (hinglish), msg-refill (hinglish), msg-report-status (hinglish)

Example (msg-billing-unverified, Hinglish): expected 1 tasks, got 0

> **Myna:** Namaste, main Myna hoon, Smile Dental Care ki automated AI assistant. Staff se baat karni ho toh kabhi bhi 'staff' boliye. Main aapki kya madad karoon?
>
> **Caller:** Pichle mahine ke bill ke baare mein sawaal hai.
>
> **Myna:** Please patient ka poora naam bataiye.
>
> **Caller:** Mera naam Ramesh Kumar hai.
>
> **Myna:** Aur patient ki date of birth, taaki team file dhoondh sake? Agar nahi pata toh bata dijiye.
>
> **Caller:** Pata nahi.
>
> **Myna:** Kya team aapko 2111 pe khatam hone wale number pe call kare?
>
> **Caller:** Haan ji.
>
> **Myna:** Sorry, main samajh nahi paayi. Kya team aapko 2111 pe khatam hone wale number pe call kare?
>
> **Caller:** Haan ji.
>
> **Myna:** Sorry, main samajh nahi paayi. Kya team aapko 2111 pe khatam hone wale number pe call kare?
>
> **Caller:** Haan ji.
>
> **Myna:** Sorry, mujhe theek se samajh nahi aa raha. Main aapko staff se jod rahi hoon.

### MEDIUM · `handoff` · 8 calls

Scenarios: faq-fees (hinglish), msg-billing-unverified (hinglish), msg-doctor-callback (hinglish), msg-report-status (hinglish), rem-cancel (hinglish), rem-confirm (hinglish), rem-reschedule (hinglish), rem-wrong-date-of-birth (hinglish)

Example (faq-fees, Hinglish): unexpected handoff: unanswered_question

> **Myna:** Namaste, main Myna hoon, Smile Dental Care ki automated AI assistant. Staff se baat karni ho toh kabhi bhi 'staff' boliye. Main aapki kya madad karoon?
>
> **Caller:** Consultation ki fees kitni hai?
>
> **Myna:** A consultation is 500 rupees. Cleaning starts at 1,200 rupees. Kya main aur kuch madad kar sakti hoon?
>
> **Caller:** Nahi, bas. Thank you.
>
> **Myna:** I don't have that information, so I won't guess. Let me connect you to our staff.

### MEDIUM · `call_completed` · 1 call

Scenarios: reschedule-for-father (hinglish)

Example (reschedule-for-father, Hinglish): still going after 16 turns

> **Myna:** Namaste, main Myna hoon, Smile Dental Care ki automated AI assistant. Staff se baat karni ho toh kabhi bhi 'staff' boliye. Main aapki kya madad karoon?
>
> **Caller:** Papa ka appointment change karna hai.
>
> **Myna:** Please patient ka poora naam bataiye.
>
> **Caller:** Patient ka naam Arjun Verma hai.
>
> **Myna:** Thank you. Aur patient ki date of birth?
>
> **Caller:** 2 November 1985
>
> **Myna:** Mujhe Dr. Mehta ke saath Friday, 16 October ko subah 10 baje consultation dikh raha hai. Iski jagah kaunsa din aur time chahiye?
>
> **Caller:** Thursday dopahar 12 baje
>
> **Myna:** Dr. Mehta ke saath Thursday, 15 October, dopahar 12 baje available hai. Confirm kar loon: Arjun Verma ka consultation, Dr. Mehta ke saath, Friday, 16 October subah 10 baje se badal kar Thursday, 15 October ko dopahar 12 baje. Kya main badal doon?
>
> **Caller:** Haan ji.
>
> **Myna:** Ho gaya. Appointment ab Thursday, 15 October ko dopahar 12 baje Dr. Mehta ke saath hai. Aapko SMS aa jayega. Kya main aur kuch madad kar sakti hoon?
>
> **Caller:** Nahi, bas. Thank you.
>
> **Myna:** Would you like to book, change or cancel an appointment?
>
> **Caller:** Papa ka appointment change karna hai.
>
> **Myna:** Mujhe Dr. Mehta ke saath Thursday, 15 October ko dopahar 12 baje consultation dikh raha hai. Iski jagah kaunsa din aur time chahiye?
>
> **Caller:** Thursday dopahar 12 baje
>
> **Myna:** Thursday, 15 October ko Dr. Mehta ke saath dopahar 12:15 baje, dopahar 12:30 baje ya dopahar 12:45 baje available hai. Kaunsa time chahiye?
>
> **Caller:** pehla wala
>
> **Myna:** Confirm kar loon: Arjun Verma ka consultation, Dr. Mehta ke saath, Thursday, 15 October dopahar 12 baje se badal kar Thursday, 15 October ko dopahar 12:15 baje. Kya main badal doon?
>
> **Caller:** Haan ji.
>
> **Myna:** Ho gaya. Appointment ab Thursday, 15 October ko dopahar 12:15 baje Dr. Mehta ke saath hai. Aapko SMS aa jayega. Kya main aur kuch madad kar sakti hoon?
>
> **Caller:** Nahi, bas. Thank you.
>
> **Myna:** Aap appointment book, change ya cancel karna chahte hain?
>
> **Caller:** Papa ka appointment change karna hai.
>
> **Myna:** Mujhe Dr. Mehta ke saath Thursday, 15 October ko dopahar 12:15 baje consultation dikh raha hai. Iski jagah kaunsa din aur time chahiye?
>
> **Caller:** Thursday dopahar 12 baje
>
> **Myna:** Dr. Mehta ke saath Thursday, 15 October, dopahar 12 baje available hai. Confirm kar loon: Arjun Verma ka consultation, Dr. Mehta ke saath, Thursday, 15 October dopahar 12:15 baje se badal kar Thursday, 15 October ko dopahar 12 baje. Kya main badal doon?
>
> **Caller:** Haan ji.
>
> **Myna:** Ho gaya. Appointment ab Thursday, 15 October ko dopahar 12 baje Dr. Mehta ke saath hai. Aapko SMS aa jayega. Kya main aur kuch madad kar sakti hoon?
>
> **Caller:** Nahi, bas. Thank you.
>
> **Myna:** Would you like to book, change or cancel an appointment?
>
> **Caller:** Papa ka appointment change karna hai.
>
> **Myna:** Mujhe Dr. Mehta ke saath Thursday, 15 October ko dopahar 12 baje consultation dikh raha hai. Iski jagah kaunsa din aur time chahiye?

### LOW · `reply_language` · 8 calls

Scenarios: book-mind-change-at-read-back (hinglish), book-mumbled-date-of-birth (hinglish), cancel-verified (hinglish), faq-fees (hinglish), faq-timings (hinglish), medical-question-mid-booking (hinglish), rem-wrong-number (hinglish), reschedule-for-father (hinglish)

Example (book-mind-change-at-read-back, Hinglish): 1 replies not in hinglish, e.g. "Friday, 16 October, 12 pm with Dr. Mehta is available. Just to confirm: a filling for Sana Shaikh with Dr. Mehta on Friday, 16 October at 12 pm. Shall I book it?"

> **Myna:** Namaste, main Myna hoon, Smile Dental Care ki automated AI assistant. Staff se baat karni ho toh kabhi bhi 'staff' boliye. Main aapki kya madad karoon?
>
> **Caller:** Mujhe filling ka appointment chahiye Thursday subah 11 baje.
>
> **Myna:** Dr. Mehta ke saath Thursday, 15 October, subah 11 baje available hai. Please patient ka poora naam bataiye.
>
> **Caller:** Mera naam Sana Shaikh hai.
>
> **Myna:** Thank you. Aur patient ki date of birth?
>
> **Caller:** 5 May 1991
>
> **Myna:** Confirm kar loon: Sana Shaikh ke liye Dr. Mehta ke saath filling, Thursday, 15 October ko subah 11 baje. Kya main book kar doon?
>
> **Caller:** Nahi, Friday dopahar 12 baje kar do.
>
> **Myna:** Friday, 16 October, 12 pm with Dr. Mehta is available. Just to confirm: a filling for Sana Shaikh with Dr. Mehta on Friday, 16 October at 12 pm. Shall I book it?
>
> **Caller:** Haan ji.
