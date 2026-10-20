"""The shared config cache: fast when it can be, never in the way of the kill switch."""

from __future__ import annotations

import fakeredis
import pytest
import redis.asyncio as aioredis

from myna_agent import contracts as c
from myna_agent.config_cache import ConfigCache, cache_key

pytestmark = pytest.mark.api


class CountingApi:
    """Stands in for ApiClient: serves a config and counts how often it was asked."""

    clinic_id = "smile-dental"

    def __init__(self, config: c.BusinessConfig) -> None:
        self.config_value = config
        self.calls = 0

    async def config(self) -> c.BusinessConfig:
        self.calls += 1
        return self.config_value


@pytest.fixture
async def real_config(api) -> c.BusinessConfig:
    return await api.config()


async def test_second_call_is_served_from_the_cache(real_config) -> None:
    cache = ConfigCache(fakeredis.FakeAsyncRedis(decode_responses=True))
    api = CountingApi(real_config)
    first = await cache.get(api)  # type: ignore[arg-type]
    second = await cache.get(api)  # type: ignore[arg-type]
    assert api.calls == 1
    assert first == second == real_config


async def test_another_instance_shares_the_cached_copy(real_config) -> None:
    redis = fakeredis.FakeAsyncRedis(decode_responses=True)
    a, b = CountingApi(real_config), CountingApi(real_config)
    await ConfigCache(redis).get(a)  # type: ignore[arg-type]
    await ConfigCache(redis).get(b)  # type: ignore[arg-type]
    assert (a.calls, b.calls) == (1, 0)


async def test_deleting_the_key_forces_a_fresh_read(real_config) -> None:
    redis = fakeredis.FakeAsyncRedis(decode_responses=True)
    cache, api = ConfigCache(redis), CountingApi(real_config)
    await cache.get(api)  # type: ignore[arg-type]
    await redis.delete(cache_key("smile-dental"))  # what the API does when settings change
    await cache.get(api)  # type: ignore[arg-type]
    assert api.calls == 2


async def test_the_kill_switch_is_never_cached(real_config) -> None:
    redis = fakeredis.FakeAsyncRedis(decode_responses=True)
    cache = ConfigCache(redis)
    killed = real_config.model_copy(update={"kill_switch": True})
    api = CountingApi(killed)
    assert (await cache.get(api)).kill_switch is True  # type: ignore[arg-type]
    assert await redis.get(cache_key("smile-dental")) is None

    # Even a copy cached BEFORE the switch flipped is not trusted once it says "on".
    await redis.set(cache_key("smile-dental"), killed.model_dump_json(by_alias=True))
    assert (await cache.get(api)).kill_switch is True  # type: ignore[arg-type]
    assert api.calls == 2


async def test_the_cache_expires(real_config) -> None:
    import asyncio

    cache = ConfigCache(fakeredis.FakeAsyncRedis(decode_responses=True), ttl_seconds=1)
    api = CountingApi(real_config)
    await cache.get(api)  # type: ignore[arg-type]
    await asyncio.sleep(1.2)
    await cache.get(api)  # type: ignore[arg-type]
    assert api.calls == 2


async def test_a_dead_redis_just_means_asking_the_api(real_config) -> None:
    dead = aioredis.Redis.from_url(
        "redis://127.0.0.1:1", decode_responses=True, socket_connect_timeout=0.2
    )
    api = CountingApi(real_config)
    assert await ConfigCache(dead).get(api) == real_config  # type: ignore[arg-type]


async def test_without_redis_nothing_is_cached(real_config) -> None:
    api = CountingApi(real_config)
    cache = ConfigCache(None)
    await cache.get(api)  # type: ignore[arg-type]
    await cache.get(api)  # type: ignore[arg-type]
    assert api.calls == 2
