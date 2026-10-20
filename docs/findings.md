# Findings

Real-world and test findings, newest first: what happened, why, and what changed.
Every bug found in a real call also becomes a Hawk regression scenario.

## 2026-10-20 — Hawk against the REAL model (Sarvam `sarvam-105b-conversations`)
Reports: `docs/reports/run-03-live-first-attempt.html` → `run-04-live-final.html`.

The offline suite was 100% on all three flows, so I expected the real model to roughly match.
**It scored 26% on the Hinglish suite** (9/34; booking 29%, messages 0%, reminders 38%). One
critical failure: a booking nobody asked for. The offline tests had never shown any of this,
because a language model fails in ways a keyword parser doesn't. After the fixes below:
**102/103 (99%), all three flows SAFE TO LAUNCH**, 370 model calls with 1 fallback to rules,
p50 372 ms / p95 1.98 s per reply (understanding only; speech comes with M3).

The principle that fixed all of it: **the model suggests, code decides.** Wherever the answer is a
closed set or a visible fact (a service name, a doctor, yes/no/goodbye, Devanagari = Hindi, a
message category), deterministic code overrules a noisy model. The model keeps the judgement calls
(intent, emergencies, medical questions, frustration) and code never overrides what it did extract.

| # | What the live model did | Effect on a call | Fix (each one is a regression test) |
|---|---|---|---|
| 1 | Right intent, but left `service_id` empty, even for the bare answer "cleaning" | Myna asked "what is the visit for?" 16 times | Code fills fields the model left empty (service, doctor, option, phone, DOB, name, FAQ). |
| 2 | Copied a date from an earlier turn into `date_text` on a bare "Haan ji" | Wiped the slot being confirmed; an `assert` then crashed the turn (HTTP 500) | A model hint only counts if it quotes what the caller just said. No asserts in commit paths. Any unexpected error becomes a handoff, never a dead line. |
| 3 | Heard "yes" (or a new FAQ) in "Nahi, bas. Thank you." | Myna asked what to book next; the caller started over and booked twice (the critical failure) | On yes/no/goodbye questions, plain keywords beat a confused or wrong model. |
| 4 | Collapsed "is my report ready? also book a cleaning" into one label | The booking was dropped | Code sees the booking word plus a day or service: book first, the question waits its turn. |
| 5 | Labelled Devanagari "hinglish", and "Nahi, bas. Thank you." "en" | Hindi callers got Hinglish replies | Script is a fact: Devanagari is Hindi. Hinglish words veto a switch to English. |
| 6 | Filed "is my X-ray report ready?" and "ask the doctor to call me" as `other`; called a bill question an FAQ | Wrong task category; a bill question was transferred ("I don't have that information") instead of taken as a message | Closed-vocabulary categories are decided by keywords when the model says nothing specific; a report/refill/bill/callback request is never an FAQ. |
| 7 | Sarvam's Starter plan rate-limits (~40–60 chat requests/min) | 429s silently downgraded a call to the keyword parser, and one call hung past 20 s | Retry with backoff; a hard 6 s model budget (a phone caller can't wait); `/v1/stats` counts model answers vs fallbacks and Hawk prints it, so a report can't claim the model's result for the parser's work. |

Also learned:
- `sarvam-105b` is a *reasoning* model: given a small token budget it can spend it all thinking and
  return an empty reply. `sarvam-105b-conversations` answers directly (~300 ms) and is the right
  model for a voice agent; it is now the default.
- Hawk now prints the agent's log tail when a call errors. That is how finding #2's traceback was found.
- Still open: the Hawk patients are scripted and text-only. Re-run with LLM-played patients and in
  audio mode (M3) before trusting any SAFE verdict for a pilot.

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
