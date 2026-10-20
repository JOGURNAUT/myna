"""Live-call state in a shared store: contract tests, snapshots, two instances, Redis outage.

The store contract runs against memory and against Redis (fakeredis here; set REDIS_URL to run the
same tests against a real server, as CI does).
"""

from __future__ import annotations

import asyncio
import json
import os
from collections.abc import AsyncIterator

import fakeredis
import httpx
import pytest
import redis.asyncio as aioredis
from conftest import NOW_LOCAL, ApiServer

from myna_agent.nlu import RuleBasedNLU
from myna_agent.server import create_app
from myna_agent.session_store import (
    InMemoryStore,
    LockTimeout,
    RedisStore,
    ResilientStore,
    SessionStore,
)
from myna_agent.settings import Settings
from myna_agent.snapshot import SNAPSHOT_VERSION, IncompatibleSnapshot, restore, snapshot

# ------------------------------------------------------------------ the store contract


@pytest.fixture(params=["memory", "redis"])
async def store(request: pytest.FixtureRequest) -> AsyncIterator[SessionStore]:
    if request.param == "memory":
        yield InMemoryStore(ttl_seconds=1)
        return
    url = os.environ.get("REDIS_URL")
    client = (
        aioredis.Redis.from_url(url, decode_responses=True)
        if url
        else fakeredis.FakeAsyncRedis(decode_responses=True)
    )
    await client.flushdb()
    yield RedisStore(client, ttl_seconds=1)
    await client.aclose()


async def test_round_trip_and_missing(store: SessionStore) -> None:
    assert await store.load("c1") is None
    payload = {"v": 1, "text": "नमस्ते", "n": [1, 2]}
    await store.save("c1", payload)
    assert await store.load("c1") == payload
    await store.delete("c1")
    assert await store.load("c1") is None


async def test_state_expires_after_the_ttl(store: SessionStore) -> None:
    await store.save("c1", {"v": 1})
    await asyncio.sleep(1.3)
    assert await store.load("c1") is None


async def test_each_save_extends_the_ttl(store: SessionStore) -> None:
    for _ in range(3):
        await store.save("c1", {"v": 1})
        await asyncio.sleep(0.6)  # 1.8 s in total, but never 1 s without a save
    assert await store.load("c1") == {"v": 1}


async def test_the_lock_serialises_turns_of_one_call(store: SessionStore) -> None:
    inside = 0
    peak = 0

    async def turn() -> None:
        nonlocal inside, peak
        async with store.lock("c1"):
            inside += 1
            peak = max(peak, inside)
            await asyncio.sleep(0.02)
            inside -= 1

    await asyncio.gather(*(turn() for _ in range(8)))
    assert peak == 1


async def test_the_lock_is_released_when_the_turn_fails(store: SessionStore) -> None:
    with pytest.raises(RuntimeError):
        async with store.lock("c1"):
            raise RuntimeError("turn blew up")
    async with asyncio.timeout(1):
        async with store.lock("c1"):
            pass


async def test_different_calls_do_not_block_each_other(store: SessionStore) -> None:
    async with store.lock("a"):
        async with asyncio.timeout(1):
            async with store.lock("b"):
                pass


# ------------------------------------------------------------------ snapshots


@pytest.mark.api
async def test_a_call_survives_snapshot_and_restore_mid_booking(make_call, api) -> None:
    first = await make_call(caller_phone="9822200111")
    await first.start()
    await first.say("Hi, I'd like to book a cleaning")
    await first.say("Tuesday at 11 am")
    await first.say("My name is Neha Kapoor")

    # Serialise exactly as Redis would, then load into a brand-new Conversation.
    wire = json.loads(json.dumps(snapshot(first.conv, clinic_id="smile-dental", rev=3)))
    second = await make_call(caller_phone="9822200111")
    second.conv.call_id = first.conv.call_id
    restore(second.conv, wire)

    r = await second.say("15 March 1992")
    assert "Neha Kapoor" in r.text and "Tuesday, 13 October" in r.text
    r = await second.say("yes please")
    assert r.text.startswith("Done.")


@pytest.mark.api
async def test_a_foreign_snapshot_is_refused_not_half_applied(make_call) -> None:
    call = await make_call()
    data = snapshot(call.conv, clinic_id="smile-dental", rev=1)
    with pytest.raises(IncompatibleSnapshot):
        restore(call.conv, {**data, "v": SNAPSHOT_VERSION + 1})
    with pytest.raises(IncompatibleSnapshot):
        restore(call.conv, {"v": SNAPSHOT_VERSION, "mode": "inbound"})  # missing fields


# ------------------------------------------------------------------ two instances, one store


def _settings(api_server: ApiServer) -> Settings:
    return Settings(
        api_base_url=api_server.base_url,
        agent_api_token=api_server.token,
        llm_provider="rules",
        sarvam_api_key=None,
        sarvam_model="sarvam-105b",
        port=0,
    )


def _instance(api_server: ApiServer, store: SessionStore) -> httpx.AsyncClient:
    app = create_app(
        _settings(api_server),
        nlu_factory=lambda _name: RuleBasedNLU(),
        now=lambda: NOW_LOCAL,
        store=store,
    )
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://agent")


@pytest.mark.api
async def test_any_instance_can_serve_any_turn_of_a_call(api_server: ApiServer, api) -> None:
    shared = RedisStore(fakeredis.FakeAsyncRedis(decode_responses=True))
    async with _instance(api_server, shared) as a, _instance(api_server, shared) as b:
        started = await a.post(
            "/v1/calls",
            json={"clinicId": "smile-dental", "source": "hawk", "callerPhone": "9822200123"},
        )
        call_id = started.json()["callId"]
        script = [
            "Hi, I'd like to book a cleaning",
            "Thursday at 11 am",
            "My name is Karan Bedi",
            "20 June 1988",
            "yes please",
            "no thanks",
        ]
        replies = []
        for i, text in enumerate(script):
            instance = b if i % 2 == 0 else a  # every turn lands on the other instance
            res = await instance.post(f"/v1/calls/{call_id}/turns", json={"text": text})
            assert res.status_code == 200, res.text
            replies.append(res.json()["reply"])
        assert replies[4]["text"].startswith("Done."), [r["text"] for r in replies]
        assert replies[-1]["ended"] is True
        # The finished call is gone from the shared store, for both instances.
        assert (await a.post(f"/v1/calls/{call_id}/turns", json={"text": "hi"})).status_code == 404
        assert (await b.post(f"/v1/calls/{call_id}/turns", json={"text": "hi"})).status_code == 404


@pytest.mark.api
async def test_a_restarted_instance_picks_up_calls_in_progress(api_server: ApiServer) -> None:
    shared = RedisStore(fakeredis.FakeAsyncRedis(decode_responses=True))
    async with _instance(api_server, shared) as before:
        call_id = (
            await before.post("/v1/calls", json={"clinicId": "smile-dental", "source": "hawk"})
        ).json()["callId"]
        await before.post(f"/v1/calls/{call_id}/turns", json={"text": "what are your timings"})
    # "Deploy": a brand-new app object with nothing in its own memory.
    async with _instance(api_server, shared) as after:
        res = await after.post(f"/v1/calls/{call_id}/turns", json={"text": "no thanks, bye"})
        assert res.status_code == 200 and res.json()["reply"]["ended"] is True


@pytest.mark.api
async def test_two_taps_at_once_do_not_interleave(api_server: ApiServer) -> None:
    shared = RedisStore(fakeredis.FakeAsyncRedis(decode_responses=True))
    async with _instance(api_server, shared) as a, _instance(api_server, shared) as b:
        call_id = (
            await a.post("/v1/calls", json={"clinicId": "smile-dental", "source": "hawk"})
        ).json()["callId"]
        results = await asyncio.gather(
            a.post(f"/v1/calls/{call_id}/turns", json={"text": "what are your timings"}),
            b.post(f"/v1/calls/{call_id}/turns", json={"text": "what is the address"}),
        )
        assert [r.status_code for r in results] == [200, 200]
        stored = await shared.load(call_id)
        assert stored is not None
        # Both turns are in the transcript, one after the other: nothing was lost.
        said = [who_text[1] for who_text in stored["transcript"] if who_text[0] == "caller"]
        assert sorted(said) == ["what are your timings", "what is the address"]


@pytest.mark.api
async def test_an_incompatible_state_asks_the_caller_to_start_over(api_server: ApiServer) -> None:
    shared = RedisStore(fakeredis.FakeAsyncRedis(decode_responses=True))
    async with _instance(api_server, shared) as app:
        call_id = (
            await app.post("/v1/calls", json={"clinicId": "smile-dental", "source": "hawk"})
        ).json()["callId"]
        data = await shared.load(call_id)
        assert data is not None
        await shared.save(call_id, {**data, "v": 999})
        res = await app.post(f"/v1/calls/{call_id}/turns", json={"text": "hello"})
        assert res.status_code == 410
        assert (
            await app.post(f"/v1/calls/{call_id}/turns", json={"text": "hi"})
        ).status_code == 404


# ------------------------------------------------------------------ Redis down: fail safe


@pytest.mark.api
async def test_calls_still_work_when_redis_is_down(api_server: ApiServer) -> None:
    dead = aioredis.Redis.from_url(
        "redis://127.0.0.1:1", decode_responses=True, socket_connect_timeout=0.2
    )
    store = ResilientStore(RedisStore(dead), InMemoryStore())
    async with _instance(api_server, store) as app:
        started = await app.post("/v1/calls", json={"clinicId": "smile-dental", "source": "hawk"})
        assert started.status_code == 200
        call_id = started.json()["callId"]
        res = await app.post(f"/v1/calls/{call_id}/turns", json={"text": "what are your timings"})
        assert res.status_code == 200 and "Monday to Friday" in res.json()["reply"]["text"]
        res = await app.post(f"/v1/calls/{call_id}/turns", json={"text": "no thanks, bye"})
        assert res.json()["reply"]["ended"] is True


async def test_a_stuck_lock_times_out_instead_of_hanging_the_caller(monkeypatch) -> None:
    monkeypatch.setattr("myna_agent.session_store.LOCK_WAIT_SECONDS", 0.2)
    store = RedisStore(fakeredis.FakeAsyncRedis(decode_responses=True))
    async with store.lock("c1"):
        with pytest.raises(LockTimeout):
            async with store.lock("c1"):
                pass
