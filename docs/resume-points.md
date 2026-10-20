# Resume points (every number is in the repo; see the source in brackets)

## Pick 4–5 for the FDE role

1. Built **Myna**, a Hinglish/Hindi/English voice receptionist for clinics, as an explicit state
   machine where the LLM only extracts intent and code enforces safety (emergency → 112/108 handoff,
   no medical advice, verification and read-back before any write). [`docs/decisions.md`]
2. Built **Hawk**, a go-live test harness: simulated patients, outcome-based grading of the
   resulting schedule, SAFE / WITH HANDOFF / NOT SAFE verdicts by flow and language. [`docs/reports/`]
3. Took the real-model pass rate from **26% to 99% (102/103)** by moving closed-vocabulary
   decisions into code, with a regression test per bug. [`run-03` → `run-04`, `docs/findings.md`]
4. Added **audio mode** (Bulbul → Saaras → agent), which exposed failures text tests cannot see
   (Devanagari Hinglish, phonetically spelled English, numbers as words, mangled names); fixed and
   tested, including emergency phrases in transliterated speech. [`docs/findings.md`]
5. Shipped **browser voice** (Pipecat WebRTC + Sarvam), about **0.5 s** from end-of-speech to first
   audio (about 0.95 s felt), verified end to end with a headless WebRTC client. [`docs/plan-m3.md`]
6. Made it **scale out with Redis** (shared call state, atomic reminder claims, shared rate limits,
   kill-switch bus) and proved it by running Hawk across two agent instances (106/106); real Redis
   in CI. [`docs/plan-redis.md`, `run-05`]
7. Designed a **scheduling-adapter** interface with SQLite and Google Sheets backends passing one
   contract suite (Sheets writes serialised by a mutex, Redis lock when scaled). [`services/api/src/adapters`]

## Short form (3 lines)
- Built a Hinglish voice receptionist for clinics: the LLM suggests, code decides; safety rules are
  enforced in code.
- Built a test harness (text + audio) that grades outcomes; real-model pass rate 26% → 99%.
- Added browser voice (Pipecat + Sarvam, about 0.95 s felt latency) and Redis-based scale-out.

## Do not claim
- Deployed at / used by real clinics (no pilot yet). Say "pilot-ready".
- The audio-mode number as final: the last valid 24-call sample was 79%, the rerun was cut short by
  exhausted Sarvam credits. Re-run before quoting it.
- Latency with the real model: the 0.5 s figure used rule-based understanding; the model adds about
  0.4 s p50.
