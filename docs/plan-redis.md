# Plan — Redis in Myna (storage, caching, workflow coordination)

Status: **draft, waiting for OK**

Why now: Myna is built to run as several instances on Cloud Run, and four things that are fine on
one laptop break the moment there are two instances. Redis is the standard answer to each, so
each use below has a real failure it prevents. (Not padding: if a use has no failure story, it
isn't here.)

## What breaks with two instances, and the Redis fix

| # | Today (one process) | Breaks when scaled out | Redis fix |
|---|---|---|---|
| 1 | Active-call state lives in a Python dict in the agent (`sessions`) | Turn 2 of a call lands on another instance: "unknown call". A restart drops every live call. | **Session store**: call state as JSON under `call:{id}` with a 30-min sliding TTL. Any instance can serve any turn; calls survive a deploy. |
| 2 | "Which patients to remind" is a list; nothing stops two workers dialling the same one | Two schedulers both pick Pooja → she gets two calls | **Distributed claim**: `SET reminder:{appt} <worker> NX PX 120000` before dialling. Only one worker wins; a crashed worker's claim expires and the call is retried. |
| 3 | Rate limits are per-process (`Map` in the Next route, `LoginThrottle` in the API) | N instances = N× the limit; the login lock-out can be dodged by hitting different instances | **Shared rate limiter**: fixed/sliding window with `INCR` + `EXPIRE` (atomic via a Lua script). Also a token bucket in front of Sarvam so we respect its per-minute plan limits across instances. |
| 4 | Agent fetches the clinic config from the API at the start of every call | Needless load; slow first reply | **Config cache** with a short TTL **and explicit invalidation**: changing the kill switch deletes the key and publishes `config-changed`, so the cache can never delay a safety switch. |

## Design rules
- **Optional.** No `REDIS_URL` → in-memory implementations behind the same interface (dev, tests,
  Hawk stay offline). Same interface = same tests run against both (like the scheduling-adapter
  contract suite).
- **Fail safe, not fail open.** Redis down: sessions fall back to in-memory for *new* calls and
  log loudly; the reminder claim falls back to **not dialling** (a missed reminder is better than
  a double call); the kill-switch path always reads the source of truth.
- **No patient data in Redis beyond what a live call needs**, TTL on everything, masked phone
  numbers only in keys (DPDP data rules in CLAUDE.md). Keys are prefixed per tenant.

## Steps
1. `redis` in `docker-compose.yml` (dev) and as a service container in CI; `REDIS_URL` in `.env.example`.
2. **Agent** (`redis-py` asyncio): `SessionStore` protocol (`InMemory`, `Redis`);
   `Conversation.snapshot()/restore()` (state → JSON; contract models already serialise);
   server loads state per turn, saves after, under a short per-call lock so two simultaneous
   turns can't interleave.
3. **API** (`ioredis`): `RateLimiter` interface (in-memory / Redis Lua); replace `LoginThrottle`;
   `ReminderClaims` (`claim`, `release`, `complete`) and a `POST /reminders/claim` endpoint that
   returns due reminders already claimed by the caller.
4. **Web**: the demo-chat limiter uses the same Redis limiter (server-side `ioredis`).
5. **Config cache + invalidation** in the agent, and an invalidation hook in the API's kill-switch
   route (`DEL` + `PUBLISH`).
6. **Tests**: shared contract suites for each interface run against in-memory and a real Redis
   (docker locally, service container in CI); a two-instance test (two agent apps, one Redis:
   start a call on A, take turns on B); a race test (20 concurrent claims → exactly one winner);
   a Redis-outage test (each fail-safe behaviour above).
7. **Hawk**: `--instances 2` mode runs the suite against two agent processes sharing Redis, so
   "works scaled out" is a graded property, not a claim.
8. Docs: `docs/decisions.md` entries, README section.

## Risks / what I need from you
- Local Redis via Docker (already installed). Windows without Docker would use the in-memory mode.
- Snapshot size and versioning: sessions carry a `v` field so a deploy can't resurrect an
  incompatible state; incompatible = start-over message, never a crash.
- **OK to start?** Order: 2 (session store) → 3 (limiter + claims) → 5 (cache) → 7 (Hawk).
