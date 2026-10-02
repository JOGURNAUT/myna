# Findings

Real-world and test findings, newest first: what happened, why, and what changed.
Every bug found in a real call also becomes a Hawk regression scenario.

## 2026-10-03 — Hawk run 1: the first go-live report (M2)
103 simulated calls (35 scenarios × EN / Hinglish / Hindi), rule-based understanding, scripted
patients. Report: `docs/reports/run-01-baseline.html`.

**Verdict: NOT SAFE on all three flows.** Booking 71%, messages 80%, reminders 80%;
English 94%, Hindi 76%, **Hinglish 53%**. Four critical failures.

| # | Severity | What Hawk found | Why | Fix |
|---|---|---|---|---|
| 1 | critical | Hindi callers could never reschedule or cancel; Hindi messages were filed "unverified". | Speech-to-text gives "राहुल गुप्ता"; the record says "Rahul Gupta". Verification compared them literally. | API name matching transliterates Devanagari and compares consonant skeletons ("Pooja"/"Puja"/"पूजा" → `pj`). DOB/phone still must match exactly. |
| 2 | critical | A Hindi "don't call me again" on a reminder call was not understood; the number was never opted out. | The Hindi full stop "।" is inside the Devanagari Unicode block, so "करो।" never ended a word and phrase matching failed. | `normalize()` turns ।/॥ into spaces. Affected every Hindi phrase at a sentence end, not just opt-outs. |
| 3 | high | Callers who say their date of birth in words ("twelve April nineteen ninety", "baarah April unnees sau nabbe") were handed to staff after two tries. | The date parser only read digits. | `numbers.py` turns English, romanised-Hindi and Devanagari number words into digits, incl. "unnees sau nabbe" and "do hazaar paanch". |
| 4 | low | Half of Hinglish calls got some English replies. | (a) "Staff se baat karni hai." tokenised as "hai." so the Hinglish marker didn't match; (b) a date of birth ("15 March 1992") looked like 3 English words and switched the call to English. | Word tokens for language detection; switching to English now needs English function words, not just Latin script. |
| 5 | medium | "How much is a consultation?" wasn't recognised as a fees question. | Missing phrase. | Added "how much" / "kitni hai" / "कितना लगेगा". |
| 6 | high | A Hindi "please ask Dr. Mehta to call me" message was filed as "other". | Missing Hindi callback phrases. | Added. |

**Run 2, after the fixes: SAFE TO LAUNCH on all three flows, 100% in every language**
(`docs/reports/run-02-after-fixes.html`). Read that with the caveat printed on the report:
scripted patients phrase things the way the scenarios were written, so the suite now proves the
agent handles *these* phrasings in all three languages, not that it is ready for real callers.
The next honest verdict needs LLM-played patients (needs a Sarvam key) and audio mode (M3).

Also found while building Hawk (not agent bugs):
- The grader first called "the appointment was left unchanged" critical. It isn't a wrong
  action, it's a goal not met, so it's high now. Critical is reserved for bookings nobody asked for.
- On Windows, stopping `uv run` orphans the Python server it started. Hawk kills process trees.

## 2026-10-03 — M1 end-to-end conversations (rule-based NLU, synthetic patients)
Found by the first 20 scripted conversations against the real API. Each is now a regression test,
and each should become a Hawk scenario in M2.

| # | What happened | Why | Fix |
|---|---|---|---|
| 1 | Hinglish caller said "Pooja Malhotra"; Myna switched to English for the rest of the call. | Language was re-detected on every turn; a bare name has no Hindi words. | Short Latin-script answers (<3 words) don't switch language. |
| 2 | Patient "Kiran Rao" was booked with Dr. Rao. | Doctor names were matched anywhere, including inside the caller's own name. | Doctor/service mentions are ignored while Myna is collecting identity. |
| 3 | "Do you take cashless insurance?" was answered in Hinglish. | "do" (Hindi "give") was a Hinglish marker; it's also English. | Removed ambiguous markers. |
| 4 | "No, make it Friday at 12" kept 11 am. | A bare number wasn't treated as a time. | "at/around/by N" is a time; a lone number still isn't. |
| 5 | Two simultaneous bookings for one slot: the loser got a raw `SQLITE_BUSY` error. | libsql transactions don't inherit `busy_timeout`. | In-process write queue; loser now gets `SLOT_UNAVAILABLE` and is re-offered times. |
| 6 | Offering three slots on one day read the date three times. | Each option was read as date + time. | Same-day offers say the date once. |

Open questions for Hawk (M2):
- **"kal"** means both yesterday and tomorrow; we always read it as tomorrow in a booking context.
  Check real calls for "kal aaya tha" (I came yesterday) in reschedule flows.
- **"next Tuesday" on a Monday** resolves to the Tuesday of next calendar week (8 days away),
  not tomorrow. Callers split on this; the read-back with the absolute date is our safety net.
  Measure how often callers correct it.
- ~~**Name matching is strict**~~ — confirmed by Hawk run 1 (Hindi names) and fixed, see above.
