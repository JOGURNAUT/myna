"""Where live-call state lives. One interface, two implementations (like the scheduling adapters).

- `InMemoryStore`: one process. Dev, tests, offline Hawk.
- `RedisStore`: shared. Several agent instances (Cloud Run) serve one call between them, and a
  deploy/restart doesn't drop calls in progress.
- `ResilientStore`: Redis first; if Redis is down, NEW state goes to memory (a call can still be
  answered by this instance) and we log loudly. We never invent state and never block a caller.

A per-call lock makes two simultaneous turns of one call run one after the other, not interleaved
(a double-tapped send button would otherwise corrupt the draft).
"""

from __future__ import annotations

import asyncio
import json
import logging
import secrets
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any, Protocol

log = logging.getLogger("myna.session")

SESSION_TTL_SECONDS = 30 * 60
LOCK_TTL_MS = 15_000
LOCK_WAIT_SECONDS = 10.0

Json = dict[str, Any]


class LockTimeout(Exception):
    """Another turn of the same call held the lock for too long."""


class SessionStore(Protocol):
    async def load(self, call_id: str) -> Json | None: ...
    async def save(self, call_id: str, data: Json) -> None: ...
    async def delete(self, call_id: str) -> None: ...
    def lock(self, call_id: str) -> AbstractAsyncContext: ...


class AbstractAsyncContext(Protocol):
    async def __aenter__(self) -> None: ...
    async def __aexit__(self, *exc: object) -> None: ...


class InMemoryStore:
    def __init__(self, ttl_seconds: float = SESSION_TTL_SECONDS) -> None:
        self._ttl = ttl_seconds
        self._data: dict[str, tuple[float, str]] = {}
        self._locks: dict[str, asyncio.Lock] = {}

    async def load(self, call_id: str) -> Json | None:
        item = self._data.get(call_id)
        if item is None:
            return None
        expires, raw = item
        if expires < asyncio.get_running_loop().time():
            self._data.pop(call_id, None)
            return None
        return json.loads(raw)  # type: ignore[no-any-return]

    async def save(self, call_id: str, data: Json) -> None:
        expires = asyncio.get_running_loop().time() + self._ttl
        self._data[call_id] = (expires, json.dumps(data, ensure_ascii=False))

    async def delete(self, call_id: str) -> None:
        self._data.pop(call_id, None)
        self._locks.pop(call_id, None)

    @asynccontextmanager
    async def lock(self, call_id: str) -> AsyncIterator[None]:
        lk = self._locks.setdefault(call_id, asyncio.Lock())
        async with lk:
            yield


# Release only if the lock is still ours (it may have expired and been taken by another turn).
_UNLOCK = """
if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end
return 0
"""


class RedisStore:
    """`client` is a `redis.asyncio.Redis` (decode_responses=True)."""

    def __init__(self, client: Any, ttl_seconds: int = SESSION_TTL_SECONDS) -> None:
        self._r = client
        self._ttl = ttl_seconds

    @staticmethod
    def _key(call_id: str) -> str:
        return f"myna:call:{call_id}"

    async def load(self, call_id: str) -> Json | None:
        raw = await self._r.get(self._key(call_id))
        return None if raw is None else json.loads(raw)  # type: ignore[no-any-return]

    async def save(self, call_id: str, data: Json) -> None:
        # EX on every save = a sliding window: a call that keeps talking never expires.
        await self._r.set(self._key(call_id), json.dumps(data, ensure_ascii=False), ex=self._ttl)

    async def delete(self, call_id: str) -> None:
        await self._r.delete(self._key(call_id))

    @asynccontextmanager
    async def lock(self, call_id: str) -> AsyncIterator[None]:
        key, token = f"myna:lock:{call_id}", secrets.token_hex(8)
        deadline = asyncio.get_running_loop().time() + LOCK_WAIT_SECONDS
        while not await self._r.set(key, token, nx=True, px=LOCK_TTL_MS):
            if asyncio.get_running_loop().time() > deadline:
                raise LockTimeout(call_id)
            await asyncio.sleep(0.05)
        try:
            yield
        finally:
            await self._r.eval(_UNLOCK, 1, key, token)


class ResilientStore:
    """Redis if it's up, memory if it isn't. See the module docstring."""

    def __init__(self, primary: SessionStore, fallback: SessionStore) -> None:
        self._p, self._f = primary, fallback

    async def load(self, call_id: str) -> Json | None:
        try:
            found = await self._p.load(call_id)
        except Exception:
            log.exception("session store unavailable on load; using local memory")
            return await self._f.load(call_id)
        return found if found is not None else await self._f.load(call_id)

    async def save(self, call_id: str, data: Json) -> None:
        try:
            await self._p.save(call_id, data)
        except Exception:
            log.exception("session store unavailable on save; keeping this call in local memory")
            await self._f.save(call_id, data)

    async def delete(self, call_id: str) -> None:
        await self._f.delete(call_id)
        try:
            await self._p.delete(call_id)
        except Exception:
            log.exception("session store unavailable on delete; the key will expire by TTL")

    @asynccontextmanager
    async def lock(self, call_id: str) -> AsyncIterator[None]:
        # Acquire first, then yield outside the try: an error in the caller's block must not be
        # mistaken for "Redis is down" and run the block a second time.
        held = self._p.lock(call_id)
        try:
            await held.__aenter__()
        except LockTimeout:
            raise
        except Exception:
            log.exception("lock store unavailable; falling back to a local lock")
            held = self._f.lock(call_id)
            await held.__aenter__()
        try:
            yield
        finally:
            await held.__aexit__(None, None, None)
