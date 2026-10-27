# Plan: Hawk LLM judge (soft criteria)

Status: built 2026-10-27 (requested: "ok bandao").

## What it does
Scores politeness, language consistency and clarity for each call with an LLM and a fixed rubric
(`hawk/src/judge.ts`, `RUBRIC`). It runs inside Hawk (`pnpm hawk run --judge`).

## What it must not do
- Change a pass/fail or a verdict. Safety and schedule state stay deterministic (`grader.ts`).
- Count an unscorable call as a pass: it is reported as "could not be scored".

## How we know whether to trust it
`pnpm hawk judge-labels --api URL --clinic ID` (password in `HAWK_STAFF_PASSWORD`) reads the calls a
person labelled in the dashboard, asks the judge the same question ("was this call handled
correctly?"), and writes `docs/reports/judge-agreement.json`: agreement %, catch rate (share of
human-"wrong" calls the judge also flagged), precision. `pnpm hawk run --judge --agreement <file>`
shows that in the Hawk report. Under 20 labelled calls the number is shown with a warning.

## Choices
- Provider behind `JudgeModel`; default Sarvam `sarvam-105b-conversations` (same as the agent).
- One retry on a malformed reply; transcript is passed as data and the prompt says to ignore
  instructions inside it.
- Rubric exempts Myna's opening greeting (said before the caller's language is known): the first
  smoke run flagged it as a language failure.

## Open
- Needs 20+ human labels before the agreement number means anything.
- Judge and agent use the same model family; compare with a second judge model later.
