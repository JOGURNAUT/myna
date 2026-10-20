# Myna + Hawk

**Myna talks, Hawk watches.**

Myna is a multilingual (English, Hindi, Hinglish) AI phone receptionist for small Indian clinics.
Hawk is the test harness that decides whether Myna is safe to go live.

Built vertical-agnostic; clinics first because they're the hardest.

## The idea in one paragraph

The language model **suggests, code decides**. The model only turns what the caller said into a
small structured guess (intent, language, fields); every reply Myna speaks is a fixed per-language
template, and code enforces the rules: AI disclosure, emergency → 112/108 + human, no medical
advice, verification before any patient detail, read-back before any booking, handoff when
confused. Hawk then plays hundreds of simulated patients against it and grades the *schedule it
leaves behind*, not just the words.

## Layout

```
apps/web          Next.js: talk to Myna (type or speak), clinic dashboard, Hawk reports
services/api      Fastify + Drizzle + SQLite: clinics, schedule, tool endpoints, call logs
services/agent    Python: conversation state machine, text endpoint, Pipecat voice pipeline
hawk/             TS test harness: scenarios, personas, grader, go-live report (text + audio mode)
packages/shared   Zod schemas: config, tool contracts → JSON Schema for Python; rate limiter
clinics/          one YAML config per clinic (synthetic only)
docs/             plans, decisions, findings, Hawk reports
```

## Requirements

- Node 22+ and pnpm 12
- [uv](https://docs.astral.sh/uv/) (installs Python 3.12 for the agent)
- Optional: a Sarvam API key (real understanding + speech), Docker (a local Redis)

## See it running

```sh
pnpm install
(cd services/agent && uv sync)
cp .env.example .env     # add SARVAM_API_KEY for the real model and for voice; works offline without
pnpm demo
```

Opens API :4000, agent :8000 and web :3000 together. Then:

- **http://localhost:3000**: talk to Myna. Type, or press *Talk with your voice* (microphone;
  needs `SARVAM_API_KEY`). The booking appears on the mini schedule as it is confirmed.
- **/hawk**: the go-live report. **/login** (`smile-dental` / `demo-password-123`): the clinic
  dashboard, call review and manual labels.

## Hawk: is Myna safe to go live?

```sh
pnpm hawk run                                  # every scenario × EN / Hinglish / Hindi
pnpm hawk run --filter reminder --lang hi      # a slice
pnpm hawk run --gate                           # exit 1 if any flow is NOT SAFE (CI)
pnpm hawk run --nlu sarvam --model sarvam-105b-conversations   # with the real model
pnpm hawk run --instances 2                    # two agents sharing Redis; turns hop between them
pnpm hawk run --audio --sample 24              # callers SPEAK: Bulbul → Saaras → Myna
```

Hawk starts its own API and agent (temp database, clock pinned to Mon 12 Oct 2026 11:00 IST),
gives every scenario its own throwaway clinic, plays the patient, grades each call against the
expected end state and the safety rules, and writes a go-live report to `docs/reports/`
(JSON + markdown + HTML; the JSON is also stored via the API). Scenarios live in
`hawk/scenarios/*.yaml`, personas in `hawk/personas/`. All runs so far: `docs/reports/README.md`.

Audio mode is the honest one: it shows what real speech recognition does to Hinglish names,
dates and numbers, which clean text never does.

## Scaling out (Redis, optional)

Without `REDIS_URL` everything lives in memory, which is right for one instance. With it (set the
same URL on API, agent and web; `docker compose up -d redis` locally) live-call state, reminder
claims, rate limits and the config cache are shared, so any instance can serve any turn of a call,
two workers never ring the same patient, and the kill switch reaches every instance. See
`docs/plan-redis.md` and `docs/decisions.md`.

## Voice

Browser voice is Pipecat (WebRTC) + Sarvam Saaras (speech-to-text) and Bulbul (text-to-speech).
Pipecat owns the transport, voice-activity detection and barge-in; Myna's own `MynaTurn` takes
each transcript to the same turn logic the text endpoint uses, and Bulbul speaks the fixed reply.
Per-turn latency (listen / think / speak) is logged and shown in the UI. See `docs/plan-m3.md`.

## Test

```sh
pnpm lint && pnpm typecheck && pnpm test           # TS: shared, api, hawk, web
cd services/agent && uv run ruff check src tests && uv run pytest   # Python (starts the real API)
docker build -f Dockerfile.ci -t myna-ci . && docker run --rm myna-ci   # everything, clean Linux
```

The live voice tests (`tests/test_voice_live.py`, `tests/test_voice_webrtc.py`) call the real
Sarvam services and are skipped without `SARVAM_API_KEY`.

When a contract in `packages/shared` changes: `pnpm schemas:export`, then
`cd services/agent && uv run python scripts/gen_contracts.py`. Drift tests on both sides fail
until you do.

## Docs

- `docs/plan-m1.md`, `plan-m2.md`, `plan-m3.md`, `plan-m4.md`, `plan-redis.md`: plans and status
- `docs/decisions.md`: design decisions and why
- `docs/findings.md`: what testing (and later, real calls) taught us
