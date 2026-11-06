"""A business must never hear another business's words (a restaurant guest asked about "patients").

Three lenses: every template line, the prompt the model sees, and what a call actually says.
Adding a vertical (a hotel, say) means: an entry in `i18n.VERTICAL_LINES`, an entry in
`FORBIDDEN` below, and (in hawk/src/grader.ts) `OTHER_VERTICAL_WORDS`. The registry test fails
until all of it exists, so a new vertical cannot quietly inherit clinic wording.
"""

from __future__ import annotations

import dataclasses
import re
from datetime import date

import pytest

from myna_agent import contracts as c
from myna_agent import i18n
from myna_agent.llm.sarvam import SarvamNLU
from myna_agent.nlu import ClinicFacts, TurnContext

# Words that belong to the clinic vertical, matched on any part of a word (this is a net, not a
# parser: "appointment" is a clinic word here, a restaurant says "booking").
CLINIC_WORDS = (
    r"patient|doctor|dr\.|dental|dentist|clinic|appointment|medicine|prescription|treatment|"
    r"tooth|teeth|मरीज|डॉक्टर|क्लिनिक|अपॉइंटमेंट|डेंटल|दांत|दवा|dawai|mareez"
)
FORBIDDEN: dict[str, re.Pattern[str]] = {
    "restaurant": re.compile(CLINIC_WORDS, re.I),
}

LANGS: tuple[i18n.Lang, ...] = ("en", "hi", "hinglish")


def test_every_vertical_is_registered_and_has_a_word_list() -> None:
    for vertical in c.Vertical:
        if vertical is c.Vertical.clinic:
            continue
        assert vertical.value in i18n.VERTICAL_LINES, f"{vertical.value}: no wording in i18n"
        assert vertical.value in FORBIDDEN, f"{vertical.value}: no forbidden-word list"


@pytest.mark.parametrize("vertical", sorted(FORBIDDEN))
def test_no_template_line_carries_another_verticals_words(vertical: str) -> None:
    bad = []
    for key in i18n.LINES:
        for lang in LANGS:
            text = i18n.resolve(key, lang, vertical)
            # {clinic} and {doctor} are placeholder names; their values come from the business.
            if m := FORBIDDEN[vertical].search(re.sub(r"\{[^}]*\}", "", text)):
                bad.append(f"{key}[{lang}] has {m.group(0)!r}: {text[:70]}")
    assert not bad, "\n".join(bad)


@pytest.mark.parametrize("vertical", sorted(FORBIDDEN))
def test_overrides_cover_every_language(vertical: str) -> None:
    for key, by_lang in i18n.VERTICAL_LINES[vertical].items():
        assert set(by_lang) == set(LANGS), f"{vertical}.{key} misses a language"


@pytest.mark.parametrize("vertical", sorted(FORBIDDEN))
def test_the_model_prompt_never_describes_another_business(vertical: str) -> None:
    facts = ClinicFacts(
        services={"table-4": ["table for 4"]},
        resources={"table-1": ["table 1"]},
        faqs={"timings": "what are your opening hours?"},
        vertical=vertical,
    )
    nlu = SarvamNLU("test-key", clinic_name="Spice Route Kitchen")
    expecting = ("intent", "name", "dob", "phone", "service", "when", "choice", "appointment")
    expecting += ("confirm", "message", "callback_confirm", "waitlist_offer", "anything_else")
    for e in expecting:
        ctx = TurnContext(
            expecting=e,  # type: ignore[arg-type]
            today=date(2026, 10, 12),
            facts=dataclasses.replace(facts),
            language="en",
            history=[("caller", "hello")],
        )
        system = nlu._messages("hello", ctx)[0]["content"]
        m = FORBIDDEN[vertical].search(system)
        assert m is None, f"expecting={e}: prompt says {m.group(0)!r}" if m else ""


# --- what a call actually says -------------------------------------------------------------

JOURNEYS: dict[str, list[str]] = {
    "book": ["table for 2 tomorrow at 8 pm", "Rahul Shah", "9822211111", "yes", "no thanks"],
    "book_hinglish": ["kal raat 8 baje do logon ke liye table", "Rahul Shah", "9822211111", "haan"],
    "book_hindi": ["कल रात 8 बजे चार लोगों के लिए मेज़ चाहिए", "राहुल शाह", "9822211111", "हाँ"],
    "message": ["I want to leave a message for the manager", "Neha Rao", "call me about a cake"],
    "message_hinglish": ["manager ke liye message chhodna hai", "Neha Rao", "cake ke baare mein"],
    "unknown_faq": ["do you serve a Jain menu"],
    "allergy": ["is it safe with a nut allergy", "table for 2 tomorrow at 8 pm"],
    "emergency": ["table for 2", "someone is bleeding heavily and cannot breathe"],
    "frustrated": ["this is useless, give me a person"],
    "noise": ["hello hello", "hmm", "uh"],
    "party_too_large": ["table for 15 people tomorrow"],
    "waitlist_decline": ["table for 2 on tuesday at 9 pm", "no"],
}


@pytest.mark.parametrize("journey", sorted(JOURNEYS))
async def test_a_restaurant_call_never_hears_clinic_words(
    journey: str, make_call, make_tenant
) -> None:
    t = await make_tenant(baseClinicId="spice-route")
    call = await make_call(caller_phone="9822255555", clinic_id=t["clinicId"])
    await call.start()
    for said in JOURNEYS[journey]:
        if call.conv.ended:
            break
        await call.say(said)
    m = FORBIDDEN["restaurant"].search(call.all_text)
    assert m is None, f"{journey}: heard {m.group(0)!r}\n{call.all_text}" if m else ""


@pytest.mark.parametrize("vertical", sorted(FORBIDDEN))
def test_the_output_schema_the_model_reads_never_describes_another_business(vertical: str) -> None:
    import json

    schema = json.dumps(SarvamNLU("test-key")._schema_for(vertical))
    m = FORBIDDEN[vertical].search(schema)
    assert m is None, f"schema says {m.group(0)!r}" if m else ""
