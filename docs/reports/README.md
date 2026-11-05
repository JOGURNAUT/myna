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
| [10 two verticals](run-10-two-verticals.md) | rules, scripted | Restaurant vertical added: 36 more calls (tables for 2/4/6, name + phone verification, party too large, allergy, FAQ) | SAFE 100% | SAFE 100% | SAFE 100% | – |
| [11 + waitlist](run-11-waitlist.md) | rules, scripted | Restaurant waitlist scenario (full evening), 145 calls over two businesses | SAFE 100% | SAFE 100% | SAFE 100% | – |
| [12 restaurant audio](12-restaurant-audio.md) | rules, **spoken** restaurant callers (`translit`) | First spoken run on the restaurant vertical, 24 calls | NOT SAFE 83% | SAFE 100% | – | – |
| [13 restaurant audio, after fix](13-restaurant-audio-fix.md) | rules, spoken restaurant callers | Language no longer flips after a phone number said in words | NOT SAFE 83% | SAFE 100% | – | – |
| [14 ask the day](14-ask-day.md) | rules, scripted | A time with no day now asks "which day?" (book and reschedule); 145 calls, two businesses | SAFE 100% | SAFE 100% | SAFE 100% | – |
| [15 restaurant audio, real model](15-restaurant-audio-sarvam.md) | **Sarvam model** (sarvam-105b-conversations), spoken callers | First run with the real model in audio mode, 24 restaurant calls, 94 model calls, 0 fallbacks | NOT SAFE 83% | SAFE 100% | – | – |
| [06 audio, first](run-06-audio-rules.md) | rules, **spoken callers** (Saaras `transcribe`) | First valid audio run, 24 calls | NOT SAFE 60% | NOT SAFE 50% | NOT SAFE 80% | – |
| [07 audio, after fixes](run-07-audio-rules.md) | rules, spoken | Language no longer flips on a short English phrase; "Patient's name X" | NOT SAFE 80% | NOT SAFE 75% | SAFE 100% | – |
| [08 audio, voice STT mode](run-08-audio-translit.md) | rules, spoken (Saaras `translit`, as in the live voice) | Harness now uses the same STT mode as the voice pipeline | NOT SAFE 87% | NOT SAFE 75% | NOT SAFE 80% | – |
| [09 audio, final](run-09-audio-translit.md) | rules, spoken (`translit`) | Long-vowel weekdays ("Guruvaar"), Roman-Hindi timings question | SAFE 93% | SAFE 100% | SAFE 100% | – |

Run 04: 370 model calls, 1 fell back to the keyword parser, p50 372 ms / p95 1.98 s per reply
(understanding step only; speech comes with M3). The real model scored far below the offline
baseline at first (run 03); every cause became a fix and a regression test.

**Read the caveat on each report**: patients are scripted and text-only. The next meaningful
verdict needs LLM-played patients and audio mode.

Runs 06-09: 24 spoken calls each (a sample of the 106 scenario runs, so the percentages move by 4 points per call). Run 09: 23/24 passed, recognition p50 225 ms / p95 666 ms, about ₹1.61 of speech per call. The one failure is a reply in English inside a Hindi call. Still scripted patients and rules understanding: the real model in audio mode has not been run.
