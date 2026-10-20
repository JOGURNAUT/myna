"""A short-lived shared cache of each clinic's config, so a call doesn't wait on the API to start.

Safety first: a config with the kill switch ON is never cached or served from the cache, and the
API deletes the cached copy the moment a clinic's settings change (`DEL` + publish), so the cache
can delay a normal edit by at most its TTL and can never delay the kill switch. If Redis is down
we just ask the API.
"""

from __future__ import annotations

import logging
from typing import Any

from . import contracts as c
from .tools import ApiClient

log = logging.getLogger("myna.config_cache")

CONFIG_TTL_SECONDS = 60


def cache_key(clinic_id: str) -> str:
    return f"myna:config:{clinic_id}"  # the API deletes this key; keep in sync with config-bus.ts


class ConfigCache:
    """`redis` is a redis.asyncio client (decode_responses=True), or None for no caching."""

    def __init__(self, redis: Any | None, ttl_seconds: int = CONFIG_TTL_SECONDS) -> None:
        self._r = redis
        self._ttl = ttl_seconds

    async def get(self, api: ApiClient) -> c.BusinessConfig:
        if self._r is None:
            return await api.config()
        key = cache_key(api.clinic_id)
        try:
            raw = await self._r.get(key)
            if raw is not None:
                cached = c.BusinessConfig.model_validate_json(raw)
                if not cached.kill_switch:
                    return cached
        except Exception:
            log.warning("config cache unreadable; asking the API", exc_info=True)
        fresh = await api.config()
        if not fresh.kill_switch:
            try:
                await self._r.set(key, fresh.model_dump_json(by_alias=True), ex=self._ttl)
            except Exception:
                log.warning("config cache unwritable", exc_info=True)
        return fresh
