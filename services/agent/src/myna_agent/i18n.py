"""Everything Myna says, per language. Code picks the line; the LLM never writes replies.

Keeping replies as templates means the LLM cannot give medical advice, invent clinic facts or
read out details it shouldn't. Hawk's soft-criteria judge grades how natural these sound.
"""

from __future__ import annotations

from datetime import date
from typing import Literal

Lang = Literal["en", "hi", "hinglish"]

_WEEKDAYS = {
    "en": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
    "hi": ["सोमवार", "मंगलवार", "बुधवार", "गुरुवार", "शुक्रवार", "शनिवार", "रविवार"],
}
_MONTHS = {
    "en": [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
    ],
    "hi": [
        "जनवरी",
        "फ़रवरी",
        "मार्च",
        "अप्रैल",
        "मई",
        "जून",
        "जुलाई",
        "अगस्त",
        "सितंबर",
        "अक्टूबर",
        "नवंबर",
        "दिसंबर",
    ],
}


def say_date(d: date, lang: Lang) -> str:
    """Absolute date, always with the weekday: 'Tuesday, 14 October' / 'मंगलवार, 14 अक्टूबर'."""
    table = "hi" if lang == "hi" else "en"
    return f"{_WEEKDAYS[table][d.weekday()]}, {d.day} {_MONTHS[table][d.month - 1]}"


def say_time(hhmm: str, lang: Lang) -> str:
    h, m = (int(x) for x in hhmm.split(":"))
    h12 = h % 12 or 12
    clock = f"{h12}:{m:02d}" if m else f"{h12}"
    if lang == "en":
        return f"{clock} {'am' if h < 12 else 'pm'}"
    part = ("subah", "सुबह") if h < 12 else ("dopahar", "दोपहर") if h < 17 else ("shaam", "शाम")
    return f"{part[1]} {clock} बजे" if lang == "hi" else f"{part[0]} {clock} baje"


LINES: dict[str, dict[Lang, str]] = {
    # --- opening (rule 1: AI disclosure, recording disclosure only if recorded)
    "greeting": {
        "en": "Hello, this is Myna, the automated AI assistant for {clinic}.{recording} "
        "You can say 'staff' at any time to talk to a person. How can I help you?",
        "hi": "नमस्ते, मैं मायना हूँ, {clinic} की ऑटोमेटेड AI असिस्टेंट।{recording} "
        "किसी इंसान से बात करनी हो तो कभी भी 'स्टाफ' बोलिए। मैं आपकी क्या मदद करूँ?",
        "hinglish": "Namaste, main Myna hoon, {clinic} ki automated AI assistant.{recording} "
        "Staff se baat karni ho toh kabhi bhi 'staff' boliye. Main aapki kya madad karoon?",
    },
    "recording_on": {
        "en": " This call is recorded.",
        "hi": " यह कॉल रिकॉर्ड की जा रही है।",
        "hinglish": " Yeh call record ho rahi hai.",
    },
    "kill_switch": {
        "en": "Hello, this is {clinic}'s automated assistant. Let me connect you to our staff.",
        "hi": "नमस्ते, यह {clinic} की ऑटोमेटेड असिस्टेंट है। मैं आपको स्टाफ़ से जोड़ रही हूँ।",
        "hinglish": "Namaste, yeh {clinic} ki automated assistant hai. Main aapko staff se jod rahi hoon.",
    },
    # --- safety
    "emergency": {
        "en": "This sounds like an emergency. Please call 112 or 108 for an ambulance right now, "
        "or go to the nearest emergency. I'm connecting you to the clinic staff.",
        "hi": "यह इमरजेंसी लग रही है। कृपया अभी 112 या 108 पर कॉल करें, या नज़दीकी इमरजेंसी में "
        "जाएँ। मैं आपको क्लिनिक स्टाफ़ से जोड़ रही हूँ।",
        "hinglish": "Yeh emergency lag rahi hai. Please abhi 112 ya 108 pe call kariye, ya nazdeeki "
        "emergency mein jaaiye. Main aapko clinic staff se jod rahi hoon.",
    },
    "medical": {
        "en": "I'm sorry, I can't give medical advice or talk about medicines. The doctor can help "
        "with that. I can book you an appointment, or connect you to our staff.",
        "hi": "माफ़ कीजिए, मैं मेडिकल सलाह या दवाइयों के बारे में नहीं बता सकती। इसमें डॉक्टर मदद "
        "करेंगे। मैं आपका अपॉइंटमेंट बुक कर सकती हूँ, या आपको स्टाफ़ से जोड़ सकती हूँ।",
        "hinglish": "Sorry, main medical advice ya dawaiyon ke baare mein nahi bata sakti. Ismein "
        "doctor madad karenge. Main aapka appointment book kar sakti hoon, ya aapko staff "
        "se jod sakti hoon.",
    },
    "handoff": {
        "en": "Okay, I'm connecting you to our staff now. Please stay on the line.",
        "hi": "ठीक है, मैं आपको अभी स्टाफ़ से जोड़ रही हूँ। कृपया लाइन पर बने रहिए।",
        "hinglish": "Theek hai, main aapko abhi staff se jod rahi hoon. Please line pe rahiye.",
    },
    "handoff_confused": {
        "en": "I'm sorry, I'm having trouble understanding. Let me connect you to our staff.",
        "hi": "माफ़ कीजिए, मुझे ठीक से समझ नहीं आ रहा। मैं आपको स्टाफ़ से जोड़ रही हूँ।",
        "hinglish": "Sorry, mujhe theek se samajh nahi aa raha. Main aapko staff se jod rahi hoon.",
    },
    "not_understood": {
        "en": "Sorry, I didn't catch that. {reprompt}",
        "hi": "माफ़ कीजिए, मैं समझ नहीं पाई। {reprompt}",
        "hinglish": "Sorry, main samajh nahi paayi. {reprompt}",
    },
    # --- intent
    "ask_intent": {
        "en": "Would you like to book, change or cancel an appointment?",
        "hi": "क्या आप अपॉइंटमेंट बुक करना, बदलना या कैंसल करना चाहते हैं?",
        "hinglish": "Aap appointment book, change ya cancel karna chahte hain?",
    },
    "other_request": {
        "en": "For that, our staff can help you. Let me connect you.",
        "hi": "इसमें हमारा स्टाफ़ आपकी मदद करेगा। मैं आपको जोड़ रही हूँ।",
        "hinglish": "Iske liye hamara staff aapki madad karega. Main aapko jod rahi hoon.",
    },
    # --- verification (rule 4)
    "ask_name": {
        "en": "May I have the patient's full name, please?",
        "hi": "कृपया मरीज़ का पूरा नाम बताइए।",
        "hinglish": "Please patient ka poora naam bataiye.",
    },
    "ask_name_third_party": {
        "en": "Sure. What is the patient's full name? I'll need their details, not yours.",
        "hi": "ज़रूर। मरीज़ का पूरा नाम क्या है? मुझे उनकी जानकारी चाहिए, आपकी नहीं।",
        "hinglish": "Zaroor. Patient ka poora naam kya hai? Mujhe unki details chahiye, aapki nahi.",
    },
    "ask_dob": {
        "en": "Thank you. And the patient's date of birth?",
        "hi": "धन्यवाद। और मरीज़ की जन्मतिथि?",
        "hinglish": "Thank you. Aur patient ki date of birth?",
    },
    "ask_phone": {
        "en": "Which mobile number should we use for this booking?",
        "hi": "इस बुकिंग के लिए कौन सा मोबाइल नंबर रखें?",
        "hinglish": "Is booking ke liye kaunsa mobile number rakhein?",
    },
    "verify_failed_retry": {
        "en": "I couldn't match those details. Could you say the full name and date of birth again?",
        "hi": "ये जानकारी मेल नहीं खाई। क्या आप पूरा नाम और जन्मतिथि फिर से बताएँगे?",
        "hinglish": "Yeh details match nahi hui. Kya aap poora naam aur date of birth phir se batayenge?",
    },
    "verify_failed_handoff": {
        "en": "I'm sorry, I couldn't confirm the patient's details, so I can't share or change any "
        "appointment. Let me connect you to our staff.",
        "hi": "माफ़ कीजिए, मैं मरीज़ की जानकारी की पुष्टि नहीं कर पाई, इसलिए कोई अपॉइंटमेंट नहीं दिखा "
        "या बदल सकती। मैं आपको स्टाफ़ से जोड़ रही हूँ।",
        "hinglish": "Sorry, main patient ki details confirm nahi kar paayi, isliye koi appointment "
        "share ya change nahi kar sakti. Main aapko staff se jod rahi hoon.",
    },
    "verified": {
        "en": "Thank you, {name}.",
        "hi": "धन्यवाद, {name}।",
        "hinglish": "Thank you, {name}.",
    },
    # --- booking
    "ask_service": {
        "en": "What is the visit for? For example {services}.",
        "hi": "विज़िट किस लिए है? जैसे {services}।",
        "hinglish": "Visit kis liye hai? Jaise {services}.",
    },
    "ask_when": {
        "en": "Which day and time would suit you?",
        "hi": "आपके लिए कौन सा दिन और समय ठीक रहेगा?",
        "hinglish": "Aapke liye kaunsa din aur time theek rahega?",
    },
    "offer_slots": {
        "en": "I have {options} with {doctor}. Which one would you like?",
        "hi": "{doctor} के साथ {options} खाली है। आपको कौन सा चाहिए?",
        "hinglish": "{doctor} ke saath {options} available hai. Aapko kaunsa chahiye?",
    },
    "offer_slots_same_day": {
        "en": "On {date} I have {times} with {doctor}. Which time would you like?",
        "hi": "{date} को {doctor} के साथ {times} खाली है। कौन सा समय चाहिए?",
        "hinglish": "{date} ko {doctor} ke saath {times} available hai. Kaunsa time chahiye?",
    },
    "exact_slot": {
        "en": "{when} with {doctor} is available.",
        "hi": "{doctor} के साथ {when} खाली है।",
        "hinglish": "{doctor} ke saath {when} available hai.",
    },
    "no_slots": {
        "en": "Sorry, there's nothing free then. Would another day work?",
        "hi": "माफ़ कीजिए, उस समय कुछ खाली नहीं है। क्या कोई और दिन चलेगा?",
        "hinglish": "Sorry, us time kuch available nahi hai. Kya koi aur din chalega?",
    },
    "nothing_then": {
        "en": "Sorry, nothing is free then.",
        "hi": "माफ़ कीजिए, उस समय कुछ खाली नहीं है।",
        "hinglish": "Sorry, us time kuch available nahi hai.",
    },
    "slot_taken": {
        "en": "Sorry, that time was just taken.",
        "hi": "माफ़ कीजिए, वह समय अभी-अभी बुक हो गया।",
        "hinglish": "Sorry, woh time abhi-abhi book ho gaya.",
    },
    "or": {"en": " or ", "hi": " या ", "hinglish": " ya "},
    "confirm_book": {
        "en": "Just to confirm: a {service} for {name} with {doctor} on {date} at {time}. "
        "Shall I book it?",
        "hi": "पुष्टि कर लूँ: {name} के लिए {doctor} के साथ {service}, {date} को {time}। क्या मैं बुक कर दूँ?",
        "hinglish": "Confirm kar loon: {name} ke liye {doctor} ke saath {service}, {date} ko {time}. "
        "Kya main book kar doon?",
    },
    "booked": {
        "en": "Done. {name} is booked with {doctor} on {date} at {time}. You'll get an SMS confirmation.",
        "hi": "हो गया। {name} का अपॉइंटमेंट {doctor} के साथ {date} को {time} बुक है। आपको SMS आ जाएगा।",
        "hinglish": "Ho gaya. {name} ka appointment {doctor} ke saath {date} ko {time} book hai. "
        "Aapko SMS aa jayega.",
    },
    # --- existing appointments
    "no_appointments": {
        "en": "I don't see any upcoming appointment for {name}. Would you like to book one?",
        "hi": "{name} का कोई आने वाला अपॉइंटमेंट नहीं दिख रहा। क्या आप नया बुक करना चाहेंगे?",
        "hinglish": "{name} ka koi upcoming appointment nahi dikh raha. Kya aap naya book karna chahenge?",
    },
    "which_appointment": {
        "en": "I see {options}. Which one?",
        "hi": "मुझे {options} दिख रहे हैं। कौन सा?",
        "hinglish": "Mujhe {options} dikh rahe hain. Kaunsa?",
    },
    "appointment_item": {
        "en": "a {service} on {date} at {time}",
        "hi": "{date} को {time} {service}",
        "hinglish": "{date} ko {time} {service}",
    },
    "found_appointment": {
        "en": "I see {item} with {doctor}.",
        "hi": "मुझे {doctor} के साथ {item} दिख रहा है।",
        "hinglish": "Mujhe {doctor} ke saath {item} dikh raha hai.",
    },
    "ask_new_when": {
        "en": "Which day and time would you like instead?",
        "hi": "इसकी जगह कौन सा दिन और समय चाहिए?",
        "hinglish": "Iski jagah kaunsa din aur time chahiye?",
    },
    "confirm_reschedule": {
        "en": "Just to confirm: move {name}'s {service} with {doctor} from {old_date} at {old_time} "
        "to {date} at {time}. Shall I go ahead?",
        "hi": "पुष्टि कर लूँ: {name} का {service}, {doctor} के साथ, {old_date} {old_time} से बदलकर "
        "{date} को {time}। क्या मैं बदल दूँ?",
        "hinglish": "Confirm kar loon: {name} ka {service}, {doctor} ke saath, {old_date} {old_time} "
        "se badal kar {date} ko {time}. Kya main badal doon?",
    },
    "rescheduled": {
        "en": "Done. The appointment is now on {date} at {time} with {doctor}. You'll get an SMS.",
        "hi": "हो गया। अपॉइंटमेंट अब {date} को {time} {doctor} के साथ है। आपको SMS आ जाएगा।",
        "hinglish": "Ho gaya. Appointment ab {date} ko {time} {doctor} ke saath hai. Aapko SMS aa jayega.",
    },
    "confirm_cancel": {
        "en": "Just to confirm: cancel {name}'s {service} with {doctor} on {date} at {time}?",
        "hi": "पुष्टि कर लूँ: {name} का {doctor} के साथ {date} {time} का {service} कैंसल कर दूँ?",
        "hinglish": "Confirm kar loon: {name} ka {doctor} ke saath {date} {time} ka {service} cancel kar doon?",
    },
    "cancelled": {
        "en": "Done, the appointment is cancelled.",
        "hi": "हो गया, अपॉइंटमेंट कैंसल हो गया है।",
        "hinglish": "Ho gaya, appointment cancel ho gaya hai.",
    },
    "kept": {
        "en": "Okay, I haven't changed anything.",
        "hi": "ठीक है, मैंने कुछ नहीं बदला।",
        "hinglish": "Theek hai, maine kuch nahi badla.",
    },
    "change_what": {
        "en": "No problem. Which day or time would you prefer?",
        "hi": "कोई बात नहीं। कौन सा दिन या समय चाहिए?",
        "hinglish": "Koi baat nahi. Kaunsa din ya time chahiye?",
    },
    "confirm_yes_no": {
        "en": "Please say yes to confirm, or no to change it.",
        "hi": "पुष्टि के लिए हाँ बोलिए, बदलने के लिए ना।",
        "hinglish": "Confirm karne ke liye haan boliye, badalne ke liye na.",
    },
    # --- FAQ
    "faq_unknown": {
        "en": "I don't have that information, so I won't guess. Let me connect you to our staff.",
        "hi": "मेरे पास यह जानकारी नहीं है, इसलिए मैं अंदाज़ा नहीं लगाऊँगी। मैं आपको स्टाफ़ से जोड़ रही हूँ।",
        "hinglish": "Mere paas yeh jaankari nahi hai, isliye main guess nahi karoongi. Main aapko staff "
        "se jod rahi hoon.",
    },
    # --- closing
    "anything_else": {
        "en": "Is there anything else I can help with?",
        "hi": "क्या मैं और कुछ मदद कर सकती हूँ?",
        "hinglish": "Kya main aur kuch madad kar sakti hoon?",
    },
    "goodbye": {
        "en": "Thank you for calling {clinic}. Goodbye!",
        "hi": "{clinic} को कॉल करने के लिए धन्यवाद। नमस्ते!",
        "hinglish": "{clinic} ko call karne ke liye thank you. Namaste!",
    },
    # --- flow (b): messages for staff
    "ask_dob_message": {
        "en": "And the patient's date of birth, so the team can find the file? If you don't know it, just say so.",
        "hi": "और मरीज़ की जन्मतिथि, ताकि टीम फ़ाइल ढूँढ सके? अगर नहीं पता तो बता दीजिए।",
        "hinglish": "Aur patient ki date of birth, taaki team file dhoondh sake? Agar nahi pata toh bata dijiye.",
    },
    "ask_message": {
        "en": "What would you like me to pass on to the team?",
        "hi": "मैं टीम को क्या संदेश दूँ?",
        "hinglish": "Main team ko kya message doon?",
    },
    "confirm_callback_number": {
        "en": "Shall the team call you back on the number ending {last4}?",
        "hi": "क्या टीम आपको {last4} पर ख़त्म होने वाले नंबर पर कॉल करे?",
        "hinglish": "Kya team aapko {last4} pe khatam hone wale number pe call kare?",
    },
    "ask_callback_number": {
        "en": "Which number should the team call you back on?",
        "hi": "टीम आपको किस नंबर पर कॉल करे?",
        "hinglish": "Team aapko kis number pe call kare?",
    },
    "message_taken": {
        "en": "I've passed this on to the team. They'll call you back {when}.",
        "hi": "मैंने यह टीम को बता दिया है। वे आपको {when} कॉल करेंगे।",
        "hinglish": "Maine yeh team ko bata diya hai. Woh aapko {when} call karenge.",
    },
    "callback_today": {"en": "today by {time}", "hi": "आज {time} तक", "hinglish": "aaj {time} tak"},
    "callback_tomorrow": {
        "en": "tomorrow by {time}",
        "hi": "कल {time} तक",
        "hinglish": "kal {time} tak",
    },
    "callback_on": {
        "en": "on {date} by {time}",
        "hi": "{date} को {time} तक",
        "hinglish": "{date} ko {time} tak",
    },
    "also_message": {
        "en": "You also had a question for the team. Let me take a message for that.",
        "hi": "आपका टीम के लिए एक सवाल भी था। मैं उसका संदेश ले लेती हूँ।",
        "hinglish": "Aapka team ke liye ek sawaal bhi tha. Main uska message le leti hoon.",
    },
    # --- flow (c): reminder calls
    "outbound_opening": {
        "en": "Hello, this is Myna, the automated assistant calling from {clinic}.{recording} Am I speaking with {first_name}?",
        "hi": "नमस्ते, मैं मायना हूँ, {clinic} की ओर से ऑटोमेटेड असिस्टेंट।{recording} क्या मेरी बात {first_name} से हो रही है?",
        "hinglish": "Namaste, main Myna hoon, {clinic} ki taraf se automated assistant.{recording} Kya meri baat {first_name} se ho rahi hai?",
    },
    "outbound_ask_dob": {
        "en": "Thank you. For your privacy, could you please tell me your date of birth?",
        "hi": "धन्यवाद। आपकी प्राइवेसी के लिए, कृपया अपनी जन्मतिथि बताइए।",
        "hinglish": "Thank you. Aapki privacy ke liye, please apni date of birth bataiye.",
    },
    "outbound_dob_retry": {
        "en": "Sorry, that doesn't match our records. Could you say your date of birth again?",
        "hi": "माफ़ कीजिए, यह हमारे रिकॉर्ड से मेल नहीं खाता। क्या आप जन्मतिथि फिर से बताएँगे?",
        "hinglish": "Sorry, yeh hamare record se match nahi hua. Kya aap date of birth phir se batayenge?",
    },
    "outbound_not_verified": {
        "en": "I'm sorry, I can't share the details on this call. Please call {clinic} on {phone}. Goodbye.",
        "hi": "माफ़ कीजिए, मैं इस कॉल पर जानकारी नहीं दे सकती। कृपया {clinic} को {phone} पर कॉल करें। नमस्ते।",
        "hinglish": "Sorry, main is call pe details nahi de sakti. Please {clinic} ko {phone} pe call kariye. Namaste.",
    },
    "outbound_remind": {
        "en": "You have a {service} with {doctor} on {date} at {time}. Will you be able to come?",
        "hi": "{date} को {time} आपका {doctor} के साथ {service} है। क्या आप आ पाएँगे?",
        "hinglish": "{date} ko {time} aapka {doctor} ke saath {service} hai. Kya aap aa payenge?",
    },
    "outbound_move_or_cancel": {
        "en": "No problem. Would you like to move it to another day, or cancel it?",
        "hi": "कोई बात नहीं। क्या आप इसे किसी और दिन रखना चाहेंगे, या कैंसल करना?",
        "hinglish": "Koi baat nahi. Kya aap ise kisi aur din rakhna chahenge, ya cancel karna?",
    },
    "outbound_confirmed": {
        "en": "Thank you, we'll see you then. Goodbye!",
        "hi": "धन्यवाद, फिर मिलते हैं। नमस्ते!",
        "hinglish": "Thank you, tab milte hain. Namaste!",
    },
    "outbound_family": {
        "en": "No problem. Could you please ask {first_name} to call {clinic} on {phone}? Thank you, goodbye.",
        "hi": "कोई बात नहीं। क्या आप {first_name} से {clinic} को {phone} पर कॉल करने को कहेंगे? धन्यवाद, नमस्ते।",
        "hinglish": "Koi baat nahi. Kya aap {first_name} ko {clinic} ko {phone} pe call karne ko kahenge? Thank you, namaste.",
    },
    "outbound_wrong_number": {
        "en": "Sorry for the trouble. Goodbye.",
        "hi": "तकलीफ़ के लिए माफ़ कीजिए। नमस्ते।",
        "hinglish": "Takleef ke liye sorry. Namaste.",
    },
    "outbound_voicemail": {
        "en": "Hello, this is {clinic} calling for {first_name}. Please call us back on {phone}. Thank you.",
        "hi": "नमस्ते, यह {clinic} से {first_name} के लिए कॉल है। कृपया हमें {phone} पर वापस कॉल करें। धन्यवाद।",
        "hinglish": "Namaste, yeh {clinic} se {first_name} ke liye call hai. Please humein {phone} pe call back kariye. Thank you.",
    },
    "opted_out": {
        "en": "Okay, we won't call this number for reminders again. Goodbye.",
        "hi": "ठीक है, हम इस नंबर पर रिमाइंडर के लिए दोबारा कॉल नहीं करेंगे। नमस्ते।",
        "hinglish": "Theek hai, hum is number pe reminder ke liye dobara call nahi karenge. Namaste.",
    },
    "call_over": {
        "en": "This call has been passed to our staff.",
        "hi": "यह कॉल स्टाफ़ को दे दी गई है।",
        "hinglish": "Yeh call staff ko de di gayi hai.",
    },
}


def say_phone(phone: str) -> str:
    """Digits grouped the way Indians read numbers aloud: 98000 00001."""
    digits = "".join(ch for ch in phone if ch.isdigit())[-10:]
    return f"{digits[:5]} {digits[5:]}" if len(digits) == 10 else digits


def line(key: str, lang: Lang, **kwargs: str) -> str:
    return LINES[key][lang].format(**kwargs)


def join_options(items: list[str], lang: Lang) -> str:
    if len(items) <= 1:
        return "".join(items)
    return ", ".join(items[:-1]) + LINES["or"][lang] + items[-1]
