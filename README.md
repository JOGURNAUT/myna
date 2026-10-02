# Myna + Hawk

**Myna talks, Hawk watches.**

Myna is a multilingual (English, Hindi, Hinglish) AI phone receptionist for small Indian clinics.
Hawk is the test harness that decides whether Myna is safe to go live.

Built vertical-agnostic; clinics first because they're the hardest.

## Layout

```
apps/web          Next.js: demo page, dashboard, Hawk reports      (milestone 4)
services/api      Fastify + Drizzle + SQLite: clinics, schedule, tool endpoints, call logs
services/agent    Python: conversation state machine, text endpoint, voice later
hawk/             TS test harness                                   (milestone 2)
packages/shared   Zod schemas: config, domain, tool contracts → JSON Schema for Python
clinics/          one YAML config per clinic (synthetic only)
docs/             plans, decisions, findings
```

## Requirements

- Node 22+ and pnpm 12
- [uv](https://docs.astral.sh/uv/) (installs Python 3.12 for the agent)

## Run it

```sh
pnpm install
cp .env.example .env              # set AGENT_API_TOKEN; LLM_PROVIDER=rules works offline
(cd services/agent && uv sync)

# terminal 1: API on :4000, seeded with synthetic patients
SEED_DEMO=1 pnpm dev:api

# terminal 2: agent text endpoint on :8000
cd services/agent && uv run myna-agent
```

Talk to Myna over HTTP:

```sh
curl -s -X POST localhost:8000/v1/calls -H 'content-type: application/json' \
  -d '{"clinicId":"smile-dental","callerPhone":"9811100733","source":"manual_test"}'
# → {"callId":"call_…","reply":{"text":"Namaste, main Myna hoon…"}}

curl -s -X POST localhost:8000/v1/calls/<callId>/turns -H 'content-type: application/json' \
  -d '{"text":"Mera appointment change karna hai"}'
```

To use Sarvam for understanding, set `LLM_PROVIDER=sarvam` and `SARVAM_API_KEY` in `.env`.

## Hawk: is Myna safe to go live?

```sh
pnpm hawk run                                  # every scenario × EN / Hinglish / Hindi
pnpm hawk run --filter reminder --lang hi      # a slice
pnpm hawk run --gate                           # exit 1 if any flow is NOT SAFE (CI)
```

Hawk starts its own API and agent (temp database, clock pinned to Mon 12 Oct 2026 11:00 IST),
gives every scenario its own throwaway clinic, plays the patient, grades each call against the
expected end state and the safety rules, and writes a go-live report to `docs/reports/`
(JSON + markdown + HTML; the JSON is also stored via the API). Scenarios live in
`hawk/scenarios/*.yaml`, personas in `hawk/personas/`. Reports so far: `docs/reports/README.md`.

Outbound reminders in text mode: `POST localhost:8000/v1/outbound {"clinicId": "..."}` places the
next due reminder call; answer it through `/v1/calls/{callId}/turns` (`[no answer]` and
`[voicemail]` stand in for telephony events).

## Test

```sh
pnpm lint && pnpm typecheck && pnpm test           # TS: shared + api
cd services/agent && uv run ruff check src tests && uv run pytest   # Python (starts the real API)
docker build -f Dockerfile.ci -t myna-ci . && docker run --rm myna-ci   # everything, clean Linux
```

When a contract in `packages/shared` changes: `pnpm schemas:export`, then
`cd services/agent && uv run python scripts/gen_contracts.py`. Drift tests on both sides fail
until you do.

## Docs

- `docs/plan-m1.md` — milestone 1 plan and status
- `docs/decisions.md` — design decisions and why
- `docs/findings.md` — what testing (and later, real calls) taught us
