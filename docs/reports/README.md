# Hawk go-live reports

Each report exists as JSON (the source of truth, also stored via the API), markdown and a
self-contained HTML page. Regenerate with `pnpm hawk run` (offline) or
`pnpm hawk run --nlu sarvam --model sarvam-105b-conversations` (real model, needs `SARVAM_API_KEY`).

| Run | Understanding | What changed | Booking | Messages | Reminders | EN / Hinglish / HI |
|---|---|---|---|---|---|---|
| [01 baseline](run-01-baseline.md) | rules | First run of M2 | NOT SAFE 71% | NOT SAFE 80% | NOT SAFE 80% | 94 / 53 / 76 % |
| [02 after fixes](run-02-after-fixes.md) | rules | Fixes for every run-01 finding | SAFE 100% | SAFE 100% | SAFE 100% | 100 / 100 / 100 % |
| [03 first live try](run-03-live-first-attempt.md) | **Sarvam** (Hinglish only, 34 calls) | First contact with the real model | NOT SAFE 29% | NOT SAFE 0% | NOT SAFE 38% | – / 26 / – % |
| [04 live, final](run-04-live-final.md) | **Sarvam** (all 103 calls) | Myna made robust to a noisy model (`docs/findings.md`) | SAFE 98% | SAFE 100% | SAFE 100% | 100 / 97 / 100 % |
| [05 two instances](run-05-two-instances.md) | rules, **2 agent instances + shared Redis** | Every turn of every call hops to the other instance | SAFE 100% | SAFE 100% | SAFE 100% | 100 / 100 / 100 % |

Run 04: 370 model calls, 1 fell back to the keyword parser, p50 372 ms / p95 1.98 s per reply
(understanding step only; speech comes with M3). The real model scored far below the offline
baseline at first (run 03); every cause became a fix and a regression test.

**Read the caveat on each report**: patients are scripted and text-only. The next meaningful
verdict needs LLM-played patients and audio mode.
