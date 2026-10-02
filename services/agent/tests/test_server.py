"""The text endpoint (what Hawk and the web demo call), against the real API."""

from __future__ import annotations

import httpx
import pytest
from conftest import NOW_LOCAL, ApiServer

from myna_agent.nlu import RuleBasedNLU
from myna_agent.server import create_app
from myna_agent.settings import Settings

pytestmark = pytest.mark.api


@pytest.fixture
async def client(api_server: ApiServer):
    settings = Settings(
        api_base_url=api_server.base_url,
        agent_api_token=api_server.token,
        llm_provider="rules",
        sarvam_api_key=None,
        sarvam_model="sarvam-105b",
        port=0,
    )
    app = create_app(settings, nlu_factory=lambda _name: RuleBasedNLU(), now=lambda: NOW_LOCAL)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://agent"
    ) as c:
        yield c


async def test_a_call_over_http(client: httpx.AsyncClient) -> None:
    res = await client.post("/v1/calls", json={"clinicId": "smile-dental", "source": "hawk"})
    assert res.status_code == 200
    call_id = res.json()["callId"]
    assert "AI assistant" in res.json()["reply"]["text"]

    r = (
        await client.post(f"/v1/calls/{call_id}/turns", json={"text": "what are your timings"})
    ).json()
    assert "Monday to Friday" in r["reply"]["text"]
    r = (await client.post(f"/v1/calls/{call_id}/turns", json={"text": "no thanks, bye"})).json()
    assert r["reply"]["ended"] is True and r["reply"]["state"] == "CLOSE"

    gone = await client.post(f"/v1/calls/{call_id}/turns", json={"text": "hello?"})
    assert gone.status_code == 404


async def test_handoff_is_reported_to_the_caller_side(client: httpx.AsyncClient) -> None:
    call_id = (await client.post("/v1/calls", json={"clinicId": "smile-dental"})).json()["callId"]
    r = (await client.post(f"/v1/calls/{call_id}/turns", json={"text": "chest pain, help"})).json()[
        "reply"
    ]
    assert r["ended"] and r["handoffTo"] == "9800000002" and "112" in r["text"]


async def test_unknown_clinic_and_empty_turns_are_rejected(client: httpx.AsyncClient) -> None:
    assert (await client.post("/v1/calls", json={"clinicId": "nope"})).status_code == 404
    call_id = (await client.post("/v1/calls", json={"clinicId": "smile-dental"})).json()["callId"]
    assert (await client.post(f"/v1/calls/{call_id}/turns", json={"text": ""})).status_code == 422
