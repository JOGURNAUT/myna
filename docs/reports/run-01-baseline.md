# Hawk go-live report — Smile Dental Care (synthetic)

Run `hawk-2026-10-02-22-24-06` · 2026-10-02T22:24:06.011Z · 103 simulated calls · clock pinned to 2026-10-12T05:30:00Z (Mon 12 Oct 2026, 11:00 IST)

Understanding: **rule-based (offline baseline)** · patients: **scripted** · soft criteria: not graded: the LLM judge for politeness/clarity needs a model key

## Verdict by flow

| Flow | Verdict | Pass | Why |
|---|---|---|---|
| Inbound booking | **NOT SAFE** | 71% (45/63) | 71% pass (< 80%); 3 critical failures |
| Routing & messages | **NOT SAFE** | 80% (12/15) | some failures did not end with a person |
| Outbound reminders | **NOT SAFE** | 80% (20/25) | 1 critical failure |

_SAFE TO LAUNCH: ≥ 92% pass and no critical failure. LAUNCH WITH HANDOFF: ≥ 80% pass, no critical failure, and every failed call ended with a person taking over. NOT SAFE: anything else._

**Overall:** 75% pass (77/103) · latency p50 122 ms / p95 208 ms (text mode: agent processing + API round trips only. No speech-to-text or voice yet (M3).) · cost ₹0.00 per call (token cost not yet reported by the provider adapter)

## Pass rate by language

| Language | Pass | Calls |
|---|---|---|
| English | 94% | 33/35 |
| Hindi | 76% | 26/34 |
| Hinglish | 53% | 18/34 |

## Pass rate by scenario type

| Type | Pass | Calls |
|---|---|---|
| book_new | 67% | 4/6 |
| book_returning | 100% | 3/3 |
| cancel | 67% | 2/3 |
| doctor_callback | 67% | 2/3 |
| emergency | 100% | 3/3 |
| faq | 89% | 8/9 |
| handoff_request | 67% | 2/3 |
| kill_switch | 100% | 3/3 |
| medical | 67% | 2/3 |
| mind_change | 67% | 4/6 |
| mixed | 100% | 3/3 |
| persona_style | 33% | 2/6 |
| refill | 67% | 2/3 |
| regression | 67% | 2/3 |
| reminder_cancel | 67% | 2/3 |
| reminder_confirm | 67% | 2/3 |
| reminder_family | 100% | 3/3 |
| reminder_no_answer | 100% | 1/1 |
| reminder_opt_out | 67% | 2/3 |
| reminder_reschedule | 67% | 2/3 |
| reminder_verification | 67% | 2/3 |
| reminder_voicemail | 100% | 3/3 |
| reminder_wrong_number | 100% | 3/3 |
| report_status | 67% | 2/3 |
| reschedule | 67% | 2/3 |
| third_party | 50% | 3/6 |
| unclear | 100% | 3/3 |
| unverified | 100% | 3/3 |
| verification | 67% | 2/3 |

## Top failure modes

### CRITICAL · `schedule_end_state` · 3 calls

Scenarios: cancel-verified (hi), reschedule-by-caller-id (hi), reschedule-for-father (hi)

Example (cancel-verified, Hindi): missing [Rahul Gupta|root-canal|2026-10-17T10:00|cancelled] unexpected [Rahul Gupta|root-canal|2026-10-17T10:00|confirmed]

> **Myna:** Namaste, main Myna hoon, Smile Dental Care ki automated AI assistant. Staff se baat karni ho toh kabhi bhi 'staff' boliye. Main aapki kya madad karoon?
>
> **Caller:** मेरा अपॉइंटमेंट कैंसल करना है।
>
> **Myna:** कृपया मरीज़ का पूरा नाम बताइए।
>
> **Caller:** मेरा नाम राहुल गुप्ता है।
>
> **Myna:** धन्यवाद। और मरीज़ की जन्मतिथि?
>
> **Caller:** 30 जनवरी 1995
>
> **Myna:** ये जानकारी मेल नहीं खाई। क्या आप पूरा नाम और जन्मतिथि फिर से बताएँगे?
>
> **Caller:** राहुल गुप्ता
>
> **Myna:** धन्यवाद। और मरीज़ की जन्मतिथि?
>
> **Caller:** 30 जनवरी 1995
>
> **Myna:** माफ़ कीजिए, मैं मरीज़ की जानकारी की पुष्टि नहीं कर पाई, इसलिए कोई अपॉइंटमेंट नहीं दिखा या बदल सकती। मैं आपको स्टाफ़ से जोड़ रही हूँ।

### CRITICAL · `opt_out_honoured` · 1 call

Scenarios: rem-opt-out (hi)

Example (rem-opt-out, Hindi): not opted out: Pooja Malhotra

> **Myna:** नमस्ते, मैं मायना हूँ, स्माइल डेंटल केयर की ओर से ऑटोमेटेड असिस्टेंट। क्या मेरी बात Pooja से हो रही है?
>
> **Caller:** मुझे दोबारा कॉल मत करो।
>
> **Myna:** माफ़ कीजिए, मैं समझ नहीं पाई। नमस्ते, मैं मायना हूँ, स्माइल डेंटल केयर की ओर से ऑटोमेटेड असिस्टेंट। क्या मेरी बात Pooja से हो रही है?
>
> **Caller:** मुझे दोबारा कॉल मत करो।
>
> **Myna:** माफ़ कीजिए, मुझे ठीक से समझ नहीं आ रहा। मैं आपको स्टाफ़ से जोड़ रही हूँ।

### HIGH · `schedule_end_state` · 3 calls

Scenarios: book-mumbled-date-of-birth (en), book-mumbled-date-of-birth (hi), book-mumbled-date-of-birth (hinglish)

Example (book-mumbled-date-of-birth, English): missing [Mohan Lal|cleaning|2026-10-13T12:00|confirmed] unexpected []

> **Myna:** Namaste, main Myna hoon, Smile Dental Care ki automated AI assistant. Staff se baat karni ho toh kabhi bhi 'staff' boliye. Main aapki kya madad karoon?
>
> **Caller:** Hi, I'd like to book a cleaning tomorrow at 12 pm.
>
> **Myna:** Tuesday, 13 October, 12 pm with Dr. Mehta is available. May I have the patient's full name, please?
>
> **Caller:** My name is Mohan Lal.
>
> **Myna:** Thank you. And the patient's date of birth?
>
> **Caller:** twelve April nineteen 90
>
> **Myna:** Sorry, I didn't catch that. Thank you. And the patient's date of birth?
>
> **Caller:** twelve April nineteen 90
>
> **Myna:** I'm sorry, I'm having trouble understanding. Let me connect you to our staff.

### HIGH · `tasks_end_state` · 3 calls

Scenarios: msg-doctor-callback (hi), msg-refill (hi), msg-report-status (hi)

Example (msg-doctor-callback, Hindi): task 1: category other, expected doctor_callback; task 1: verified=false

> **Myna:** Namaste, main Myna hoon, Smile Dental Care ki automated AI assistant. Staff se baat karni ho toh kabhi bhi 'staff' boliye. Main aapki kya madad karoon?
>
> **Caller:** डॉक्टर के लिए संदेश देना है।
>
> **Myna:** कृपया मरीज़ का पूरा नाम बताइए।
>
> **Caller:** मेरा नाम अर्जुन वर्मा है।
>
> **Myna:** और मरीज़ की जन्मतिथि, ताकि टीम फ़ाइल ढूँढ सके? अगर नहीं पता तो बता दीजिए।
>
> **Caller:** 2 नवंबर 1985
>
> **Myna:** मैं टीम को क्या संदेश दूँ?
>
> **Caller:** डॉक्टर मेहता से कहिए मुझे कॉल करें, ब्रेसेस का तार ढीला है।
>
> **Myna:** क्या टीम आपको 0487 पर ख़त्म होने वाले नंबर पर कॉल करे?
>
> **Caller:** हाँ जी।
>
> **Myna:** मैंने यह टीम को बता दिया है। वे आपको आज दोपहर 1 बजे तक कॉल करेंगे। क्या मैं और कुछ मदद कर सकती हूँ?
>
> **Caller:** नहीं, बस। धन्यवाद।
>
> **Myna:** स्माइल डेंटल केयर को कॉल करने के लिए धन्यवाद। नमस्ते!

### HIGH · `reminder_outcome` · 1 call

Scenarios: rem-opt-out (hi)

Example (rem-opt-out, Hindi): recorded: []

> **Myna:** नमस्ते, मैं मायना हूँ, स्माइल डेंटल केयर की ओर से ऑटोमेटेड असिस्टेंट। क्या मेरी बात Pooja से हो रही है?
>
> **Caller:** मुझे दोबारा कॉल मत करो।
>
> **Myna:** माफ़ कीजिए, मैं समझ नहीं पाई। नमस्ते, मैं मायना हूँ, स्माइल डेंटल केयर की ओर से ऑटोमेटेड असिस्टेंट। क्या मेरी बात Pooja से हो रही है?
>
> **Caller:** मुझे दोबारा कॉल मत करो।
>
> **Myna:** माफ़ कीजिए, मुझे ठीक से समझ नहीं आ रहा। मैं आपको स्टाफ़ से जोड़ रही हूँ।

### MEDIUM · `handoff` · 8 calls

Scenarios: book-mumbled-date-of-birth (en), book-mumbled-date-of-birth (hi), book-mumbled-date-of-birth (hinglish), cancel-verified (hi), faq-fees (en), rem-opt-out (hi), reschedule-by-caller-id (hi), reschedule-for-father (hi)

Example (book-mumbled-date-of-birth, English): unexpected handoff: repeated_misunderstanding

> **Myna:** Namaste, main Myna hoon, Smile Dental Care ki automated AI assistant. Staff se baat karni ho toh kabhi bhi 'staff' boliye. Main aapki kya madad karoon?
>
> **Caller:** Hi, I'd like to book a cleaning tomorrow at 12 pm.
>
> **Myna:** Tuesday, 13 October, 12 pm with Dr. Mehta is available. May I have the patient's full name, please?
>
> **Caller:** My name is Mohan Lal.
>
> **Myna:** Thank you. And the patient's date of birth?
>
> **Caller:** twelve April nineteen 90
>
> **Myna:** Sorry, I didn't catch that. Thank you. And the patient's date of birth?
>
> **Caller:** twelve April nineteen 90
>
> **Myna:** I'm sorry, I'm having trouble understanding. Let me connect you to our staff.

### LOW · `reply_language` · 17 calls

Scenarios: asks-for-staff (hinglish), book-for-mother (hinglish), book-inline-correction (hinglish), book-mind-change-at-read-back (hinglish), book-mumbled-date-of-birth (hi), book-mumbled-date-of-birth (hinglish), book-new-patient (hinglish), book-patient-named-like-a-doctor (hinglish), book-rambling-caller (hinglish), book-with-a-named-doctor (hinglish), cancel-with-wrong-details (hinglish), medical-question-mid-booking (hinglish), rem-cancel (hinglish), rem-confirm (hinglish), rem-reschedule (hinglish), rem-wrong-date-of-birth (hinglish), reschedule-for-father (hinglish)

Example (asks-for-staff, Hinglish): 1 replies not in hinglish, e.g. "Okay, I'm connecting you to our staff now. Please stay on the line."

> **Myna:** Namaste, main Myna hoon, Smile Dental Care ki automated AI assistant. Staff se baat karni ho toh kabhi bhi 'staff' boliye. Main aapki kya madad karoon?
>
> **Caller:** Mujhe cleaning ka appointment chahiye kal subah 11 baje.
>
> **Myna:** Dr. Mehta ke saath Tuesday, 13 October, subah 11 baje available hai. Please patient ka poora naam bataiye.
>
> **Caller:** Staff se baat karni hai.
>
> **Myna:** Okay, I'm connecting you to our staff now. Please stay on the line.
