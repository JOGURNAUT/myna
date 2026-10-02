"""Hard safety rules that run in code, on every caller turn, BEFORE the LLM.

The LLM can add a second opinion (its `emergency` / `medical_question` intents), but it can
never remove one of these. Replies for these cases are fixed templates, not LLM output.
"""

from __future__ import annotations

from dataclasses import dataclass

from .text import any_phrase, normalize

# Rule 3 — emergencies. Phrases, not single words: "bleeding gums" is a dental visit,
# "bleeding heavily" is not.
EMERGENCY_PHRASES: tuple[str, ...] = (
    # English
    "chest pain",
    "heart attack",
    "cannot breathe",
    "can not breathe",
    "not breathing",
    "difficulty breathing",
    "trouble breathing",
    "unable to breathe",
    "unconscious",
    "fainted",
    "not waking up",
    "bleeding heavily",
    "heavy bleeding",
    "bleeding a lot",
    "lot of blood",
    "will not stop bleeding",
    "bleeding will not stop",
    "bleeding not stopping",
    "accident",
    "suicide",
    "kill myself",
    "end my life",
    "self harm",
    "hurt myself",
    "seizure",
    "having fits",
    "swallowed poison",
    "poisoning",
    "face is swelling up",
    "throat is swelling",
    # Hinglish
    "seene mein dard",
    "seene me dard",
    "chhati mein dard",
    "chhati me dard",
    "chest mein dard",
    "saans nahi",
    "saans nahin",
    "saans nahi aa",
    "saans lene mein",
    "saans lene me",
    "behosh",
    "bahut khoon",
    "khoon nahi ruk",
    "khoon ruk nahi",
    "khoon band nahi",
    "accident ho",
    "khudkushi",
    "aatmahatya",
    "atmahatya",
    "mar jana chahta",
    "mar jaana chahta",
    "marna chahta",
    "marna chahti",
    "jeena nahi chahta",
    "jeena nahi chahti",
    "zeher",
    "jahar",
    "daura pad",
    # Devanagari
    "सीने में दर्द",
    "छाती में दर्द",
    "सांस नहीं",
    "साँस नहीं",
    "सांस लेने में",
    "साँस लेने में",
    "बेहोश",
    "बहुत खून",
    "खून नहीं रुक",
    "खून रुक नहीं",
    "एक्सीडेंट",
    "दुर्घटना",
    "आत्महत्या",
    "खुदकुशी",
    "मरना चाहता",
    "मरना चाहती",
    "ज़हर",
    "जहर",
    "दौरा पड़",
)

# Rule 2 — medical advice. Medicines and "what should I do about my symptom" questions.
# A request to SEE the doctor is fine; a request for the doctor's ADVICE over the phone is not.
MEDICINE_WORDS: tuple[str, ...] = (
    "medicine",
    "medicines",
    "medication",
    "tablet",
    "tablets",
    "pill",
    "pills",
    "painkiller",
    "painkillers",
    "antibiotic",
    "antibiotics",
    "dose",
    "dosage",
    "mg",
    "ibuprofen",
    "paracetamol",
    "crocin",
    "combiflam",
    "amoxicillin",
    "dolo",
    "ointment",
    "mouthwash",
    "dawai",
    "dawa",
    "davai",
    "dava",
    "goli",
    "goliyan",
    "दवा",
    "दवाई",
    "गोली",
    "गोलियां",
    "टैबलेट",
)
ADVICE_PHRASES: tuple[str, ...] = (
    "what should i do",
    "what do i do",
    "is it serious",
    "is this serious",
    "is it normal",
    "is that normal",
    "should i take",
    "can i take",
    "how much should i take",
    "is it infected",
    "kya karun",
    "kya karu",
    "kya karoon",
    "kya karna chahiye",
    "normal hai kya",
    "serious hai kya",
    "kya lena chahiye",
    "kya le sakta",
    "kya le sakti",
    "kya khaun",
    "kya khau",
    "क्या करूँ",
    "क्या करूं",
    "क्या करना चाहिए",
    "नॉर्मल है क्या",
    "क्या लूँ",
    "क्या लूं",
)

# Asking for a person is always honoured (pilot rule: "say 'staff'").
HUMAN_PHRASES: tuple[str, ...] = (
    "staff",
    "human",
    "real person",
    "receptionist",
    "talk to someone",
    "speak to someone",
    "operator",
    "manager",
    "insaan",
    "kisi se baat",
    "kisi aadmi",
    "स्टाफ",
    "इंसान",
    "किसी से बात",
)


@dataclass(frozen=True)
class SafetyFlags:
    emergency: str | None = None
    medical: str | None = None
    wants_human: str | None = None


def check(text: str) -> SafetyFlags:
    t = normalize(text)
    medical = any_phrase(t, ADVICE_PHRASES) or any_phrase(t, MEDICINE_WORDS)
    return SafetyFlags(
        emergency=any_phrase(t, EMERGENCY_PHRASES),
        medical=medical,
        wants_human=any_phrase(t, HUMAN_PHRASES),
    )


# Words that must never appear in anything Myna says (Hawk checks the same list).
FORBIDDEN_IN_REPLIES: tuple[str, ...] = (
    "ibuprofen",
    "paracetamol",
    "crocin",
    "combiflam",
    "amoxicillin",
    "dolo",
    "antibiotic",
    "painkiller",
    "mg",
    "dosage",
    "diagnos",
)
