"""Spoken numbers → digits, for dates of birth said in words.

Callers say "twelfth April nineteen ninety", "baarah April unnees sau nabbe" or
"बारह अप्रैल उन्नीस सौ नब्बे". Found by Hawk run 1 (persona: number-mumbler): every such
caller was handed to staff. This turns runs of number words into digits so the date parser
sees "12 april 1990".
"""

from __future__ import annotations

import re

_EN_UNITS = {
    "zero": 0,
    "oh": 0,
    "one": 1,
    "two": 2,
    "three": 3,
    "four": 4,
    "five": 5,
    "six": 6,
    "seven": 7,
    "eight": 8,
    "nine": 9,
    "ten": 10,
    "eleven": 11,
    "twelve": 12,
    "thirteen": 13,
    "fourteen": 14,
    "fifteen": 15,
    "sixteen": 16,
    "seventeen": 17,
    "eighteen": 18,
    "nineteen": 19,
}
_EN_TENS = {
    "twenty": 20,
    "thirty": 30,
    "forty": 40,
    "fifty": 50,
    "sixty": 60,
    "seventy": 70,
    "eighty": 80,
    "ninety": 90,
}
_EN_ORDINALS = {
    "first": 1,
    "second": 2,
    "third": 3,
    "fourth": 4,
    "fifth": 5,
    "sixth": 6,
    "seventh": 7,
    "eighth": 8,
    "ninth": 9,
    "tenth": 10,
    "eleventh": 11,
    "twelfth": 12,
    "thirteenth": 13,
    "fourteenth": 14,
    "fifteenth": 15,
    "sixteenth": 16,
    "seventeenth": 17,
    "eighteenth": 18,
    "nineteenth": 19,
    "twentieth": 20,
    "thirtieth": 30,
}

# Hindi 1–99: romanised (common spellings) and Devanagari, index = value.
_HI_ROMAN = [
    "",
    "ek",
    "do",
    "teen",
    "chaar",
    "paanch",
    "chhah",
    "saat",
    "aath",
    "nau",
    "das",
    "gyaarah",
    "baarah",
    "terah",
    "chaudah",
    "pandrah",
    "solah",
    "satrah",
    "athaarah",
    "unnees",
    "bees",
    "ikkees",
    "baaees",
    "teyees",
    "chaubees",
    "pachchees",
    "chhabbees",
    "sattaees",
    "atthaees",
    "untees",
    "tees",
    "iktees",
    "battees",
    "taintees",
    "chauntees",
    "paintees",
    "chhattees",
    "saintees",
    "adtees",
    "untaalees",
    "chaalees",
    "iktaalees",
    "bayaalees",
    "taintaalees",
    "chavaalees",
    "paintaalees",
    "chhiyaalees",
    "saintaalees",
    "adtaalees",
    "unchaas",
    "pachaas",
    "ikyaavan",
    "baavan",
    "tirpan",
    "chauvan",
    "pachpan",
    "chhappan",
    "sattaavan",
    "atthaavan",
    "unsath",
    "saath",
    "iksath",
    "baasath",
    "tirsath",
    "chausath",
    "painsath",
    "chhiyaasath",
    "sadsath",
    "adsath",
    "unhattar",
    "sattar",
    "ikhattar",
    "bahattar",
    "tihattar",
    "chauhattar",
    "pachhattar",
    "chhihattar",
    "sathattar",
    "athhattar",
    "unaasi",
    "assi",
    "ikyaasi",
    "bayaasi",
    "tiraasi",
    "chauraasi",
    "pachaasi",
    "chhiyaasi",
    "sataasi",
    "athaasi",
    "navaasi",
    "nabbe",
    "ikyaanave",
    "baanave",
    "tiraanave",
    "chauraanave",
    "pachaanave",
    "chhiyaanave",
    "sattaanave",
    "atthaanave",
    "ninyaanave",
]
_HI_DEVA = [
    "",
    "एक",
    "दो",
    "तीन",
    "चार",
    "पाँच",
    "छह",
    "सात",
    "आठ",
    "नौ",
    "दस",
    "ग्यारह",
    "बारह",
    "तेरह",
    "चौदह",
    "पंद्रह",
    "सोलह",
    "सत्रह",
    "अठारह",
    "उन्नीस",
    "बीस",
    "इक्कीस",
    "बाईस",
    "तेईस",
    "चौबीस",
    "पच्चीस",
    "छब्बीस",
    "सत्ताईस",
    "अट्ठाईस",
    "उनतीस",
    "तीस",
    "इकतीस",
    "बत्तीस",
    "तैंतीस",
    "चौंतीस",
    "पैंतीस",
    "छत्तीस",
    "सैंतीस",
    "अड़तीस",
    "उनतालीस",
    "चालीस",
    "इकतालीस",
    "बयालीस",
    "तैंतालीस",
    "चवालीस",
    "पैंतालीस",
    "छियालीस",
    "सैंतालीस",
    "अड़तालीस",
    "उनचास",
    "पचास",
    "इक्यावन",
    "बावन",
    "तिरपन",
    "चौवन",
    "पचपन",
    "छप्पन",
    "सत्तावन",
    "अट्ठावन",
    "उनसठ",
    "साठ",
    "इकसठ",
    "बासठ",
    "तिरसठ",
    "चौंसठ",
    "पैंसठ",
    "छियासठ",
    "सड़सठ",
    "अड़सठ",
    "उनहत्तर",
    "सत्तर",
    "इकहत्तर",
    "बहत्तर",
    "तिहत्तर",
    "चौहत्तर",
    "पचहत्तर",
    "छिहत्तर",
    "सतहत्तर",
    "अठहत्तर",
    "उन्यासी",
    "अस्सी",
    "इक्यासी",
    "बयासी",
    "तिरासी",
    "चौरासी",
    "पचासी",
    "छियासी",
    "सत्तासी",
    "अट्ठासी",
    "नवासी",
    "नब्बे",
    "इक्यानवे",
    "बानवे",
    "तिरानवे",
    "चौरानवे",
    "पचानवे",
    "छियानवे",
    "सत्तानवे",
    "अट्ठानवे",
    "निन्यानवे",
]
# A few spelling variants people (and speech-to-text) actually produce.
_HI_VARIANTS = {
    "char": 4,
    "panch": 5,
    "chhe": 6,
    "che": 6,
    "chah": 6,
    "gyarah": 11,
    "barah": 12,
    "baara": 12,
    "pandra": 15,
    "unnis": 19,
    "unnees": 19,
    "bis": 20,
    "tis": 30,
    "nabbe": 90,
    "पांच": 5,
    "छः": 6,
    "पन्द्रह": 15,
}
_HUNDRED = {"hundred", "sau", "सौ"}
_THOUSAND = {"thousand", "hazaar", "hazar", "हज़ार", "हजार"}

_VALUES: dict[str, int] = {**_EN_UNITS, **_EN_TENS, **_EN_ORDINALS, **_HI_VARIANTS}
for _i, _w in enumerate(_HI_ROMAN):
    if _w:
        _VALUES.setdefault(_w, _i)
for _i, _w in enumerate(_HI_DEVA):
    if _w:
        _VALUES.setdefault(_w, _i)

_TOKEN = re.compile(r"[\wऀ-ॿ]+|[^\wऀ-ॿ]+")


def _is_number_word(tok: str) -> bool:
    return tok in _VALUES or tok in _HUNDRED or tok in _THOUSAND


def _evaluate(words: list[str]) -> list[int]:
    """Turn one run of number words into the numbers it most plausibly says.

    "nineteen ninety" → [1990]; "nineteen eighty five" → [1985]; "twelve" → [12];
    "unnees sau nabbe" → [1990]; "do hazaar paanch" → [2005]; "two thousand fifteen" → [2015].
    """
    values: list[int | str] = []
    for w in words:
        if w in _HUNDRED:
            values.append("x100")
        elif w in _THOUSAND:
            values.append("x1000")
        else:
            values.append(_VALUES[w])

    # Multipliers: "unnees sau nabbe", "do hazaar paanch".
    if any(v in ("x100", "x1000") for v in values):
        total, current = 0, 0
        for v in values:
            if v == "x1000":
                total += max(current, 1) * 1000
                current = 0
            elif v == "x100":
                current = max(current, 1) * 100
            else:
                assert isinstance(v, int)
                current += v
        return [total + current]

    nums = [v for v in values if isinstance(v, int)]
    # Tens + unit: "eighty five" → 85.
    merged: list[int] = []
    for n in nums:
        if merged and merged[-1] % 10 == 0 and 20 <= merged[-1] <= 90 and 1 <= n <= 9:
            merged[-1] += n
        else:
            merged.append(n)
    # Year said in two halves: "nineteen ninety" → 1990, "twenty fifteen" → 2015.
    if len(merged) == 2 and 10 <= merged[0] <= 20 and 0 <= merged[1] <= 99:
        return [merged[0] * 100 + merged[1]]
    return merged


def words_to_digits(text: str) -> str:
    """Replace each run of number words with digits; everything else is left as it was."""
    parts = _TOKEN.findall(text.lower())
    out: list[str] = []
    i = 0
    while i < len(parts):
        if _is_number_word(parts[i]):
            run = [parts[i]]
            j = i + 1
            # Extend across spaces / hyphens to further number words.
            while (
                j + 1 < len(parts) and parts[j].strip(" -") == "" and _is_number_word(parts[j + 1])
            ):
                run.append(parts[j + 1])
                j += 2
            if all(w in _HUNDRED or w in _THOUSAND for w in run):
                out.append(parts[i])
                i += 1
                continue
            out.append(" ".join(str(n) for n in _evaluate(run)))
            i = j
        else:
            out.append(parts[i])
            i += 1
    return "".join(out)
