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

## Getting started

```sh
pnpm install
cp .env.example .env
pnpm test                      # TS tests (shared + api)
cd services/agent && uv run pytest
```

See `docs/plan-m1.md` for the current milestone.
