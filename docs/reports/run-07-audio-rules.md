# Hawk go-live report — Smile Dental Care (synthetic)

Run `run-07-audio-rules` · 2026-10-27T10:39:26.023Z · 24 simulated calls · clock pinned to 2026-10-12T05:30:00Z (Mon 12 Oct 2026, 11:00 IST)

Understanding: **rule-based (offline baseline)** · patients: **scripted, spoken through Sarvam TTS and re-transcribed by Saaras** · soft criteria: not graded: the LLM judge for politeness/clarity needs a model key

Audio mode: **101 spoken caller turns** through Bulbul → Saaras · recognition p50 249 ms / p95 496 ms · est. speech cost ₹1.56 per call (assumed ₹30/hour speech-to-text and ₹30/10k characters text-to-speech; confirm against the Sarvam dashboard)

| Language | Spoken turns | Character error rate |
|---|---|---|
| hi | 34 | 30.1% |
| hinglish | 34 | n/a (spoken Roman, recognised in Devanagari) |
| en | 33 | 4.1% |

What recognition changed most (said → heard):

- [hi] "नहीं, बस। धन्यवाद।" → "No, bas dhanyawad."
- [hi] "हाँ जी।" → "Yes."
- [hinglish] "Haan ji." → "ਹਾਂਜੀ।"
- [hinglish] "Haan ji." → "ਹਾਂਜੀ।"
- [hi] "हाँ जी।" → "Yes."
- [hi] "पहला वाला" → "First one."

> **Read this first:** LLM-played patients vary between runs; compare spreads, not single numbers.

## Verdict by flow

| Flow | Verdict | Pass | Why |
|---|---|---|---|
| Inbound booking | **NOT SAFE** | 80% (12/15) | some failures did not end with a person |
| Routing & messages | **NOT SAFE** | 75% (3/4) | 75% pass (< 80%) |
| Outbound reminders | **SAFE TO LAUNCH** | 100% (5/5) | 100% pass, no critical failure |

_SAFE TO LAUNCH: ≥ 92% pass and no critical failure. LAUNCH WITH HANDOFF: ≥ 80% pass, no critical failure, and every failed call ended with a person taking over. NOT SAFE: anything else._

**Overall:** 83% pass (20/24) · latency p50 85 ms / p95 225 ms (text mode: agent processing + API round trips only. No speech-to-text or voice yet (M3).) · cost ₹0.00 per call (token cost not yet reported by the provider adapter)

## Pass rate by language

| Language | Pass | Calls |
|---|---|---|
| Hindi | 78% | 7/9 |
| Hinglish | 88% | 7/8 |
| English | 86% | 6/7 |

## Pass rate by scenario type

| Type | Pass | Calls |
|---|---|---|
| book_new | 50% | 1/2 |
| book_returning | 100% | 1/1 |
| doctor_callback | 0% | 0/1 |
| faq | 100% | 2/2 |
| handoff_request | 100% | 1/1 |
| kill_switch | 100% | 1/1 |
| medical | 100% | 1/1 |
| mind_change | 0% | 0/1 |
| mixed | 100% | 1/1 |
| persona_style | 50% | 1/2 |
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

### HIGH · `schedule_end_state` · 1 call

Scenarios: book-inline-correction (hinglish)

Example (book-inline-correction, Hinglish): missing [Asha Pillai|cleaning|2026-10-13T10:00|confirmed] unexpected []

> **Myna:** Namaste, main Myna hoon, Smile Dental Care ki automated AI assistant. Staff se baat karni ho toh kabhi bhi 'staff' boliye. Main aapki kya madad karoon?
>
> **Caller:** मुझे क्लीनिंग का अपॉइंटमेंट चाहिए।
>
> **Myna:** आपके लिए कौन सा दिन और समय ठीक रहेगा?
>
> **Caller:** वेडनेसडे नहीं, ट्यूसडे सुबह 10 बजे।
>
> **Myna:** Dr. Mehta के साथ मंगलवार, 13 अक्टूबर, सुबह 10 बजे खाली है। कृपया मरीज़ का पूरा नाम बताइए।
>
> **Caller:** मेरा नाम आशा पिल्लई है।
>
> **Myna:** धन्यवाद। और मरीज़ की जन्मतिथि?
>
> **Caller:** 7 July 1987.
>
> **Myna:** पुष्टि कर लूँ: आशा पिल्लई के लिए Dr. Mehta के साथ सफ़ाई, मंगलवार, 13 अक्टूबर को सुबह 10 बजे। क्या मैं बुक कर दूँ?
>
> **Caller:** Hi,
>
> **Myna:** आपकी आवाज़ साफ़ नहीं आई। पुष्टि के लिए हाँ बोलिए, बदलने के लिए ना।
>
> **Caller:** नहीं, नाम आशा पिल्लई है।
>
> **Myna:** कोई बात नहीं। कौन सा दिन या समय चाहिए?
>
> **Caller:** वेडनेसडे नहीं, ट्यूसडे सुबह 10 बजे।
>
> **Myna:** Dr. Mehta के साथ मंगलवार, 13 अक्टूबर, सुबह 10 बजे खाली है। पुष्टि कर लूँ: आशा पिल्लई के लिए Dr. Mehta के साथ सफ़ाई, मंगलवार, 13 अक्टूबर को सुबह 10 बजे। क्या मैं बुक कर दूँ?
>
> **Caller:** ਹਾਂਜੀ।
>
> **Myna:** माफ़ कीजिए, मैं समझ नहीं पाई। पुष्टि के लिए हाँ बोलिए, बदलने के लिए ना।
>
> **Caller:** ਹਾਂਜੀ।
>
> **Myna:** माफ़ कीजिए, मुझे ठीक से समझ नहीं आ रहा। मैं आपको स्टाफ़ से जोड़ रही हूँ।

### HIGH · `tasks_end_state` · 1 call

Scenarios: msg-doctor-callback (en)

Example (msg-doctor-callback, English): task 1: verified=false

> **Myna:** Namaste, main Myna hoon, Smile Dental Care ki automated AI assistant. Staff se baat karni ho toh kabhi bhi 'staff' boliye. Main aapki kya madad karoon?
>
> **Caller:** I'd like to leave a message for the doctor.
>
> **Myna:** May I have the patient's full name, please?
>
> **Caller:** My name is Arjun Vama.
>
> **Myna:** And the patient's date of birth, so the team can find the file? If you don't know it, just say so.
>
> **Caller:** Second November 1985.
>
> **Myna:** What would you like me to pass on to the team?
>
> **Caller:** Please ask Dr. Mehta to call me back about my braces wire.
>
> **Myna:** Shall the team call you back on the number ending 0487?
>
> **Caller:** Yes, please.
>
> **Myna:** I've passed this on to the team. They'll call you back today by 1 pm. Is there anything else I can help with?
>
> **Caller:** No, that's all. Thank you.
>
> **Myna:** Thank you for calling Smile Dental Care. Goodbye!

### MEDIUM · `handoff` · 1 call

Scenarios: book-inline-correction (hinglish)

Example (book-inline-correction, Hinglish): unexpected handoff: repeated_misunderstanding

> **Myna:** Namaste, main Myna hoon, Smile Dental Care ki automated AI assistant. Staff se baat karni ho toh kabhi bhi 'staff' boliye. Main aapki kya madad karoon?
>
> **Caller:** मुझे क्लीनिंग का अपॉइंटमेंट चाहिए।
>
> **Myna:** आपके लिए कौन सा दिन और समय ठीक रहेगा?
>
> **Caller:** वेडनेसडे नहीं, ट्यूसडे सुबह 10 बजे।
>
> **Myna:** Dr. Mehta के साथ मंगलवार, 13 अक्टूबर, सुबह 10 बजे खाली है। कृपया मरीज़ का पूरा नाम बताइए।
>
> **Caller:** मेरा नाम आशा पिल्लई है।
>
> **Myna:** धन्यवाद। और मरीज़ की जन्मतिथि?
>
> **Caller:** 7 July 1987.
>
> **Myna:** पुष्टि कर लूँ: आशा पिल्लई के लिए Dr. Mehta के साथ सफ़ाई, मंगलवार, 13 अक्टूबर को सुबह 10 बजे। क्या मैं बुक कर दूँ?
>
> **Caller:** Hi,
>
> **Myna:** आपकी आवाज़ साफ़ नहीं आई। पुष्टि के लिए हाँ बोलिए, बदलने के लिए ना।
>
> **Caller:** नहीं, नाम आशा पिल्लई है।
>
> **Myna:** कोई बात नहीं। कौन सा दिन या समय चाहिए?
>
> **Caller:** वेडनेसडे नहीं, ट्यूसडे सुबह 10 बजे।
>
> **Myna:** Dr. Mehta के साथ मंगलवार, 13 अक्टूबर, सुबह 10 बजे खाली है। पुष्टि कर लूँ: आशा पिल्लई के लिए Dr. Mehta के साथ सफ़ाई, मंगलवार, 13 अक्टूबर को सुबह 10 बजे। क्या मैं बुक कर दूँ?
>
> **Caller:** ਹਾਂਜੀ।
>
> **Myna:** माफ़ कीजिए, मैं समझ नहीं पाई। पुष्टि के लिए हाँ बोलिए, बदलने के लिए ना।
>
> **Caller:** ਹਾਂਜੀ।
>
> **Myna:** माफ़ कीजिए, मुझे ठीक से समझ नहीं आ रहा। मैं आपको स्टाफ़ से जोड़ रही हूँ।

### LOW · `reply_language` · 2 calls

Scenarios: book-mumbled-date-of-birth (hi), book-with-a-named-doctor (hi)

Example (book-mumbled-date-of-birth, Hindi): 2 replies not in hi, e.g. "Thank you. And the patient's date of birth?"

> **Myna:** Namaste, main Myna hoon, Smile Dental Care ki automated AI assistant. Staff se baat karni ho toh kabhi bhi 'staff' boliye. Main aapki kya madad karoon?
>
> **Caller:** मुझे सफ़ाई का अपॉइंटमेंट चाहिए कल दोपहर 12 बजे।
>
> **Myna:** Dr. Mehta के साथ मंगलवार, 13 अक्टूबर, दोपहर 12 बजे खाली है। कृपया मरीज़ का पूरा नाम बताइए।
>
> **Caller:** My name is Mohan Nan.
>
> **Myna:** Thank you. And the patient's date of birth?
>
> **Caller:** 12 April 1990.
>
> **Myna:** Just to confirm: a cleaning for Mohan Nan with Dr. Mehta on Tuesday, 13 October at 12 pm. Shall I book it?
>
> **Caller:** नहीं, नाम मोहनलाल है।
>
> **Myna:** पुष्टि कर लूँ: मोहनलाल के लिए Dr. Mehta के साथ सफ़ाई, मंगलवार, 13 अक्टूबर को दोपहर 12 बजे। क्या मैं बुक कर दूँ?
>
> **Caller:** Yes.
>
> **Myna:** हो गया। मोहनलाल का अपॉइंटमेंट Dr. Mehta के साथ मंगलवार, 13 अक्टूबर को दोपहर 12 बजे बुक है। आपको SMS आ जाएगा। क्या मैं और कुछ मदद कर सकती हूँ?
>
> **Caller:** No, bas dhanyawad.
>
> **Myna:** स्माइल डेंटल केयर को कॉल करने के लिए धन्यवाद। नमस्ते!
