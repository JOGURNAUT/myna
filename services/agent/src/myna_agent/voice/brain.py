"""The voice pipeline's door into Myna: the agent's own HTTP app, called in-process."""

from __future__ import annotations

from typing import Any

import httpx
from fastapi import FastAPI


class Brain:
    """Starts calls and takes turns through the same routes Hawk and the web chat use."""

    def __init__(self, app: FastAPI) -> None:
        self._http = httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://myna-agent", timeout=30
        )

    async def start(self, clinic_id: str, source: str = "manual_test") -> dict[str, Any]:
        res = await self._http.post("/v1/calls", json={"clinicId": clinic_id, "source": source})
        res.raise_for_status()
        return res.json()  # type: ignore[no-any-return]

    async def turn(self, call_id: str, text: str) -> dict[str, Any]:
        res = await self._http.post(f"/v1/calls/{call_id}/turns", json={"text": text})
        res.raise_for_status()
        return res.json()["reply"]  # type: ignore[no-any-return]

    async def hangup(self, call_id: str) -> None:
        await self._http.post(f"/v1/calls/{call_id}/hangup")

    async def aclose(self) -> None:
        await self._http.aclose()
