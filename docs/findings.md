# Findings

Real-world and test findings, newest first: what happened, why, and what changed.
Every bug found in a real call also becomes a Hawk regression scenario.

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
- **Name matching is strict** (token set, honorifics removed). Spelling variants from speech-to-text
  (Puja/Pooja) will fail verification and hand off. Expect this to show up in audio mode (M3).
