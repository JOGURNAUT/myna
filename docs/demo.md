# 3-minute demo script (for a Loom or a live walkthrough)

Setup once: `pnpm demo` (needs `SARVAM_API_KEY` in `.env` and Sarvam credits for voice and the real
model). Open http://localhost:3000 and http://localhost:3000/hawk in two tabs.

## 0:00 – The one-line pitch (15 s)
"Myna answers a clinic's phone in English, Hindi and Hinglish. Hawk is the test harness that decides
whether she is safe to put live. The model suggests, code decides."

## 0:15 – A booking by voice (60 s)  [tab 1]
Press **Talk with your voice** and say: *"Mujhe cleaning ka appointment chahiye Thursday subah
gyarah baje."*
- Point out: she opens by saying she is an AI assistant; replies come in Hinglish; the language
  badge per turn; the **felt latency** next to each reply (about 1 s).
- Give a name and date of birth. She reads everything back (name, doctor, absolute date, time)
  **before** writing anything. Say yes. The booking appears on the mini schedule.

## 1:15 – Safety, live (30 s)
- Say *"daant mein dard hai, kaunsi dawai lun?"* → she refuses medical advice and offers a booking
  or staff.
- Say *"meri mummy ko saans lene mein dikkat hai"* → immediate "call 112 / 108" and a handoff to
  staff. No booking flow continues.
"These are fixed templates enforced in code; a model mistake cannot remove them."

## 1:45 – Hawk, the point of the project (60 s)  [tab 2: /hawk]
- Verdict per flow (SAFE / LAUNCH WITH HANDOFF / NOT SAFE), pass rate by language and scenario.
- "Hawk plays 100+ simulated patients and grades the **schedule they leave behind**, not just the
  words: double bookings, verification before disclosure, emergency → handoff."
- The story: "Against the real model my first run scored **26%**. Every failure became a code rule
  and a regression test; it is now **99%** (102/103)."
- Audio mode: "When callers *speak*, recognition writes Hinglish in Devanagari, spells English
  words phonetically, turns numbers into words and mangles names. Text tests never show this.
  Audio mode found it; the fixes have tests." (Quote one real example from `docs/findings.md`.)

## 2:45 – Scale and honesty (15 s)
"It runs as multiple instances on Redis: shared call state, one worker per reminder, a kill switch
that reaches every instance, and Hawk proves it by hopping every turn between two agents."
"Not done yet: a real clinic pilot and telephony. The harness says what is safe to launch."

## If something fails live
Fall back to typing in the same page (same agent, same rules) and say so; the Hawk report is
static and always works.
