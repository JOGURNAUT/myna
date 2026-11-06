"""Restaurant wording: only the lines that differ from the clinic's (see i18n.line).

Same rules as the clinic lines: fixed templates per language, so the model never writes speech.
`{doctor}` carries the booked resource's name for every vertical; here it is a table ("Table 4").
"""

from __future__ import annotations

LINES_RESTAURANT: dict[str, dict[str, str]] = {
    "ask_intent": {
        "en": "Would you like to book, change or cancel a table?",
        "hi": "क्या आप टेबल बुक करना, बदलना या कैंसल करना चाहते हैं?",
        "hinglish": "Aap table book, change ya cancel karna chahte hain?",
    },
    "emergency": {
        "en": "This sounds like an emergency. Please call 112 or 108 right now, or go to the "
        "nearest emergency. I'm connecting you to our staff.",
        "hi": "यह इमरजेंसी लग रही है। कृपया अभी 112 या 108 पर कॉल करें, या नज़दीकी इमरजेंसी में "
        "जाएँ। मैं आपको स्टाफ़ से जोड़ रही हूँ।",
        "hinglish": "Yeh emergency lag rahi hai. Please abhi 112 ya 108 pe call kariye, ya nazdeeki "
        "emergency mein jaaiye. Main aapko staff se jod rahi hoon.",
    },
    "medical": {
        "en": "I'm sorry, I can't advise on allergies or ingredients. Our staff can help with that.",
        "hi": "माफ़ कीजिए, मैं एलर्जी या सामग्री के बारे में सलाह नहीं दे सकती। इसमें हमारा स्टाफ़ मदद करेगा।",
        "hinglish": "Sorry, main allergy ya ingredients ke baare mein salah nahi de sakti. "
        "Ismein hamara staff madad karega.",
    },
    "ask_name": {
        "en": "May I have your name for the booking, please?",
        "hi": "कृपया बुकिंग के लिए अपना नाम बताइए।",
        "hinglish": "Please booking ke liye apna naam bataiye.",
    },
    "ask_name_third_party": {
        "en": "Sure. What name should the booking be under?",
        "hi": "ज़रूर। बुकिंग किस नाम से करनी है?",
        "hinglish": "Zaroor. Booking kis naam se karni hai?",
    },
    "ask_phone": {
        "en": "Which mobile number should we use for this booking?",
        "hi": "इस बुकिंग के लिए कौन सा मोबाइल नंबर रखें?",
        "hinglish": "Is booking ke liye kaunsa mobile number rakhein?",
    },
    "verify_failed_retry": {
        "en": "I couldn't match that name and phone number. Could you say them again?",
        "hi": "ये नाम और फ़ोन नंबर मेल नहीं खाए। क्या आप फिर से बताएँगे?",
        "hinglish": "Yeh naam aur phone number match nahi hue. Kya aap phir se batayenge?",
    },
    "verify_failed_handoff": {
        "en": "I'm sorry, I couldn't confirm the booking details, so I can't share or change a "
        "booking. Let me connect you to our staff.",
        "hi": "माफ़ कीजिए, मैं बुकिंग की जानकारी की पुष्टि नहीं कर पाई, इसलिए कोई बुकिंग नहीं दिखा "
        "या बदल सकती। मैं आपको स्टाफ़ से जोड़ रही हूँ।",
        "hinglish": "Sorry, main booking ki details confirm nahi kar paayi, isliye koi booking "
        "share ya change nahi kar sakti. Main aapko staff se jod rahi hoon.",
    },
    "ask_service": {
        "en": "How many people is the table for?",
        "hi": "कितने लोगों के लिए मेज़ चाहिए?",
        "hinglish": "Kitne logon ke liye table chahiye?",
    },
    "party_too_large": {
        "en": "For a group that size our staff will arrange the tables. Let me connect you.",
        "hi": "इतने लोगों के लिए हमारा स्टाफ़ मेज़ों की व्यवस्था करेगा। मैं आपको जोड़ रही हूँ।",
        "hinglish": "Itne logon ke liye hamara staff tables arrange karega. Main aapko jod rahi hoon.",
    },
    "offer_slots": {
        "en": "I have {options} at {doctor}. Which one would you like?",
        "hi": "{doctor} पर {options} खाली है। आपको कौन सा चाहिए?",
        "hinglish": "{doctor} par {options} available hai. Aapko kaunsa chahiye?",
    },
    "offer_slots_same_day": {
        "en": "On {date} I have {times} at {doctor}. Which time would you like?",
        "hi": "{date} को {doctor} पर {times} खाली है। कौन सा समय चाहिए?",
        "hinglish": "{date} ko {doctor} par {times} available hai. Kaunsa time chahiye?",
    },
    "exact_slot": {
        "en": "{when} is free at {doctor}.",
        "hi": "{when} को {doctor} खाली है।",
        "hinglish": "{when} ko {doctor} available hai.",
    },
    "confirm_book": {
        "en": "Just to confirm: {service} for {name} at {doctor} on {date} at {time}. Shall I book it?",
        "hi": "पुष्टि कर लूँ: {name} के नाम से {service}, {doctor} पर, {date} को {time}। क्या मैं बुक कर दूँ?",
        "hinglish": "Confirm kar loon: {name} ke naam se {service}, {doctor} par, {date} ko {time}. "
        "Kya main book kar doon?",
    },
    "booked": {
        "en": "Done. {name}'s table is booked at {doctor} on {date} at {time}. You'll get an SMS.",
        "hi": "हो गया। {name} के नाम से {doctor} {date} को {time} बुक है। आपको SMS आ जाएगा।",
        "hinglish": "Ho gaya. {name} ke naam se {doctor} {date} ko {time} book hai. "
        "Aapko SMS aa jayega.",
    },
    "no_appointments": {
        "en": "I don't see any upcoming booking for {name}. Would you like to book a table?",
        "hi": "{name} की कोई आने वाली बुकिंग नहीं दिख रही। क्या आप टेबल बुक करना चाहेंगे?",
        "hinglish": "{name} ki koi upcoming booking nahi dikh rahi. Kya aap table book karna chahenge?",
    },
    "appointment_item": {
        "en": "{service} on {date} at {time}",
        "hi": "{date} को {time} {service}",
        "hinglish": "{date} ko {time} {service}",
    },
    "found_appointment": {
        "en": "I see {item} at {doctor}.",
        "hi": "मुझे {doctor} पर {item} दिख रहा है।",
        "hinglish": "Mujhe {doctor} par {item} dikh raha hai.",
    },
    "confirm_reschedule": {
        "en": "Just to confirm: move {name}'s {service} at {doctor} from {old_date} at {old_time} "
        "to {date} at {time}. Shall I go ahead?",
        "hi": "पुष्टि कर लूँ: {name} की {service}, {doctor} पर, {old_date} {old_time} से बदलकर "
        "{date} को {time}। क्या मैं बदल दूँ?",
        "hinglish": "Confirm kar loon: {name} ki {service}, {doctor} par, {old_date} {old_time} "
        "se badal kar {date} ko {time}. Kya main badal doon?",
    },
    "rescheduled": {
        "en": "Done. The booking is now on {date} at {time} at {doctor}. You'll get an SMS.",
        "hi": "हो गया। बुकिंग अब {date} को {time} {doctor} पर है। आपको SMS आ जाएगा।",
        "hinglish": "Ho gaya. Booking ab {date} ko {time} {doctor} par hai. Aapko SMS aa jayega.",
    },
    "confirm_cancel": {
        "en": "Just to confirm: cancel {name}'s {service} at {doctor} on {date} at {time}?",
        "hi": "पुष्टि कर लूँ: {name} की {doctor} पर {date} {time} की {service} कैंसल कर दूँ?",
        "hinglish": "Confirm kar loon: {name} ki {doctor} par {date} {time} ki {service} cancel kar doon?",
    },
    "cancelled": {
        "en": "Done, the booking is cancelled.",
        "hi": "हो गया, बुकिंग कैंसल हो गई है।",
        "hinglish": "Ho gaya, booking cancel ho gayi hai.",
    },
    "waitlist_offer": {
        "en": "Sorry, nothing is free then. Shall I put you on the waitlist? If a table opens, "
        "we'll call you.",
        "hi": "माफ़ कीजिए, उस समय कुछ खाली नहीं है। क्या मैं आपको वेटलिस्ट में डाल दूँ? मेज़ खाली होते ही "
        "हम आपको कॉल करेंगे।",
        "hinglish": "Sorry, us time kuch available nahi hai. Kya main aapko waitlist mein daal doon? "
        "Table khaali hote hi hum aapko call karenge.",
    },
    "waitlist_joined": {
        "en": "You're on the waitlist. If a table opens, we'll call you on your number.",
        "hi": "आप वेटलिस्ट में हैं। मेज़ खाली होते ही हम आपके नंबर पर कॉल करेंगे।",
        "hinglish": "Aap waitlist mein hain. Table khaali hote hi hum aapke number pe call karenge.",
    },
    "outbound_waitlist_offer": {
        "en": "Good news: {service} at {doctor} has opened on {date} at {time}. We'll hold it for "
        "a few minutes. Shall I confirm it for you?",
        "hi": "खुशखबरी: {date} को {time} {doctor} पर {service} खाली हो गई है। हम इसे कुछ मिनट रोक "
        "रहे हैं। क्या मैं आपके लिए पक्की कर दूँ?",
        "hinglish": "Good news: {date} ko {time} {doctor} par {service} khaali ho gayi hai. Hum ise "
        "kuch minute hold kar rahe hain. Kya main aapke liye confirm kar doon?",
    },
    "outbound_offer_taken": {
        "en": "Done, your table is confirmed. You'll get an SMS. See you then!",
        "hi": "हो गया, आपकी मेज़ पक्की है। आपको SMS आ जाएगा। तब मिलते हैं!",
        "hinglish": "Ho gaya, aapki table confirm hai. Aapko SMS aa jayega. Tab milte hain!",
    },
    "outbound_offer_declined": {
        "en": "No problem, thank you. Goodbye!",
        "hi": "कोई बात नहीं, धन्यवाद। नमस्ते!",
        "hinglish": "Koi baat nahi, thank you. Namaste!",
    },
    "outbound_remind": {
        "en": "You have {service} at {doctor} on {date} at {time}. Will you be able to come?",
        "hi": "{date} को {time} {doctor} पर आपकी {service} है। क्या आप आ पाएँगे?",
        "hinglish": "{date} ko {time} {doctor} par aapki {service} hai. Kya aap aa payenge?",
    },
}
