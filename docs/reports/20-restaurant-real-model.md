# Hawk go-live report — Smile Dental Care (synthetic)

Run `20-restaurant-real-model` · 2026-11-06T10:14:41.785Z · 39 simulated calls · clock pinned to 2026-10-12T05:30:00Z (Mon 12 Oct 2026, 11:00 IST)

Understanding: **sarvam** · patients: **scripted** · soft criteria: not graded: the LLM judge for politeness/clarity needs a model key

Model: `sarvam-105b-conversations` · 145 understandings, **3 fell back to rules**, 37 rate-limit retries

> **Read this first:** Scripted patients say things the way the scenarios were written, so a high pass rate here is necessary but not sufficient. Real callers are messier: re-run with LLM-played patients and in audio mode before trusting a SAFE verdict for a pilot.

## Verdict by flow

| Flow | Verdict | Pass | Why |
|---|---|---|---|
| Inbound booking | **NOT SAFE** | 87% (26/30) | 3 critical failures |
| Routing & messages | **SAFE TO LAUNCH** | 100% (9/9) | 100% pass, no critical failure |

_SAFE TO LAUNCH: ≥ 92% pass and no critical failure. LAUNCH WITH HANDOFF: ≥ 80% pass, no critical failure, and every failed call ended with a person taking over. NOT SAFE: anything else._

**Overall:** 90% pass (35/39) · latency p50 386 ms / p95 1978 ms (text mode: agent processing + API round trips only. No speech-to-text or voice yet (M3).) · cost ₹0.00 per call (token cost not yet reported by the provider adapter)

## Pass rate by language

| Language | Pass | Calls |
|---|---|---|
| English | 92% | 12/13 |
| Hindi | 77% | 10/13 |
| Hinglish | 100% | 13/13 |

## Pass rate by business

| Business | Pass | Calls |
|---|---|---|
| restaurant | 90% | 35/39 |

## Pass rate by scenario type

| Type | Pass | Calls |
|---|---|---|
| allergy | 100% | 3/3 |
| book_new | 100% | 9/9 |
| cancel | 100% | 3/3 |
| faq | 100% | 9/9 |
| mind_change | 100% | 3/3 |
| party_too_large | 100% | 3/3 |
| reschedule | 67% | 2/3 |
| verification | 33% | 1/3 |
| waitlist | 67% | 2/3 |
## Soft criteria (LLM judge)

Not graded. not graded: the LLM judge for politeness/clarity needs a model key.

**Judge vs human:** Not measured yet: no human-labelled calls scored by the judge.


## Top failure modes

### CRITICAL · `handoff` · 2 calls

Scenarios: rest-wrong-phone-sees-nothing (en), rest-wrong-phone-sees-nothing (hi)

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
> **Caller:** 90000 00099
>
> **Myna:** I couldn't match that name and phone number. Could you say them again?
>
> **Caller:** Deepa Menon
>
> **Myna:** Sorry, I didn't catch that. May I have your name for the booking, please?
>
> **Caller:** Deepa Menon
>
> **Myna:** I'm sorry, I'm having trouble understanding. Let me connect you to our staff.

### CRITICAL · `schedule_end_state` · 1 call

Scenarios: rest-reschedule-reservation (hi)

Example (rest-reschedule-reservation, Hindi): missing [Imran Qureshi|table-4|2026-10-15T20:00|confirmed] unexpected [Imran Qureshi|table-4|2026-10-15T21:30|confirmed]

> **Myna:** Namaste, main Myna hoon, Spice Route Kitchen ki automated AI assistant. Staff se baat karni ho toh kabhi bhi 'staff' boliye. Main aapki kya madad karoon?
>
> **Caller:** मुझे अपना अपॉइंटमेंट बदलना है।
>
> **Myna:** कृपया बुकिंग के लिए अपना नाम बताइए।
>
> **Caller:** मेरा नाम इमरान क़ुरैशी है।
>
> **Myna:** मुझे Table 3 पर मंगलवार, 13 अक्टूबर को शाम 8 बजे चार लोगों की मेज़ दिख रहा है। इसकी जगह कौन सा दिन और समय चाहिए?
>
> **Caller:** गुरुवार शाम 8 बजे
>
> **Myna:** गुरुवार, 15 अक्टूबर, शाम 8 बजे को Table 3 खाली है। पुष्टि कर लूँ: Imran Qureshi की चार लोगों की मेज़, Table 3 पर, मंगलवार, 13 अक्टूबर शाम 8 बजे से बदलकर गुरुवार, 15 अक्टूबर को शाम 8 बजे। क्या मैं बदल दूँ?
>
> **Caller:** हाँ जी।
>
> **Myna:** हो गया। बुकिंग अब गुरुवार, 15 अक्टूबर को शाम 8 बजे Table 3 पर है। आपको SMS आ जाएगा। क्या मैं और कुछ मदद कर सकती हूँ?
>
> **Caller:** नहीं, बस। धन्यवाद।
>
> **Myna:** मुझे Table 3 पर गुरुवार, 15 अक्टूबर को शाम 8 बजे चार लोगों की मेज़ दिख रहा है। इसकी जगह कौन सा दिन और समय चाहिए?
>
> **Caller:** गुरुवार शाम 8 बजे
>
> **Myna:** Table 3 पर गुरुवार, 15 अक्टूबर, शाम 9:30 बजे खाली है। आपको कौन सा चाहिए?
>
> **Caller:** पहला वाला
>
> **Myna:** पुष्टि कर लूँ: Imran Qureshi की चार लोगों की मेज़, Table 3 पर, गुरुवार, 15 अक्टूबर शाम 8 बजे से बदलकर गुरुवार, 15 अक्टूबर को शाम 9:30 बजे। क्या मैं बदल दूँ?
>
> **Caller:** हाँ जी।
>
> **Myna:** हो गया। बुकिंग अब गुरुवार, 15 अक्टूबर को शाम 9:30 बजे Table 3 पर है। आपको SMS आ जाएगा। क्या मैं और कुछ मदद कर सकती हूँ?
>
> **Caller:** नहीं, बस। धन्यवाद।
>
> **Myna:** स्पाइस रूट किचन को कॉल करने के लिए धन्यवाद। नमस्ते!

### MEDIUM · `handoff` · 1 call

Scenarios: rest-full-evening-waitlist (hi)

Example (rest-full-evening-waitlist, Hindi): unexpected handoff: repeated_misunderstanding

> **Myna:** Namaste, main Myna hoon, Spice Route Kitchen ki automated AI assistant. Staff se baat karni ho toh kabhi bhi 'staff' boliye. Main aapki kya madad karoon?
>
> **Caller:** मुझे 2 लोगों के लिए टेबल बुक करनी है कल शाम 8 बजे।
>
> **Myna:** माफ़ कीजिए, उस समय कुछ खाली नहीं है। क्या मैं आपको वेटलिस्ट में डाल दूँ? मेज़ खाली होते ही हम आपको कॉल करेंगे।
>
> **Caller:** हाँ जी।
>
> **Myna:** माफ़ कीजिए, मैं समझ नहीं पाई। माफ़ कीजिए, उस समय कुछ खाली नहीं है। क्या मैं आपको वेटलिस्ट में डाल दूँ? मेज़ खाली होते ही हम आपको कॉल करेंगे।
>
> **Caller:** हाँ जी।
>
> **Myna:** माफ़ कीजिए, मैं समझ नहीं पाई। माफ़ कीजिए, उस समय कुछ खाली नहीं है। क्या मैं आपको वेटलिस्ट में डाल दूँ? मेज़ खाली होते ही हम आपको कॉल करेंगे।
>
> **Caller:** हाँ जी।
>
> **Myna:** माफ़ कीजिए, मुझे ठीक से समझ नहीं आ रहा। मैं आपको स्टाफ़ से जोड़ रही हूँ।

### LOW · `reply_language` · 1 call

Scenarios: rest-wrong-phone-sees-nothing (hi)

Example (rest-wrong-phone-sees-nothing, Hindi): 1 replies not in hi, e.g. "Yeh naam aur phone number match nahi hue. Kya aap phir se batayenge?"

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
> **Myna:** Yeh naam aur phone number match nahi hue. Kya aap phir se batayenge?
>
> **Caller:** दीपा मेनन
>
> **Myna:** माफ़ कीजिए, मैं समझ नहीं पाई। कृपया बुकिंग के लिए अपना नाम बताइए।
>
> **Caller:** दीपा मेनन
>
> **Myna:** माफ़ कीजिए, मुझे ठीक से समझ नहीं आ रहा। मैं आपको स्टाफ़ से जोड़ रही हूँ।
