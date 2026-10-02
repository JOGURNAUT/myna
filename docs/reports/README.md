# Hawk go-live reports

Each report exists as JSON (the source of truth, also stored via the API), markdown and a
self-contained HTML page. Regenerate with `pnpm hawk run`.

| Run | What changed | Booking | Messages | Reminders | Languages (EN / Hinglish / HI) |
|---|---|---|---|---|---|
| [01 — baseline](run-01-baseline.md) | First run of M2 | NOT SAFE 71% | NOT SAFE 80% | NOT SAFE 80% | 94% / 53% / 76% |
| [02 — after fixes](run-02-after-fixes.md) | Fixes for every run-01 finding (`docs/findings.md`) | SAFE 100% | SAFE 100% | SAFE 100% | 100% / 100% / 100% |

Both runs: rule-based understanding, scripted patients, 103 calls, clock pinned to
Mon 12 Oct 2026 11:00 IST. **Read the caveat on each report**: scripted patients phrase things the
way scenarios were written. The next meaningful verdict needs LLM-played patients and audio mode.
