"""Typed client for the API's tool endpoints. The agent's ONLY way to touch the schedule."""

from __future__ import annotations

import time
from typing import Any, Protocol, TypeVar

import httpx
from pydantic import BaseModel

from . import contracts as c

Out = TypeVar("Out", bound=BaseModel)


class ToolError(Exception):
    """A typed failure from the API. Branch on `code`, never on the message."""

    def __init__(self, code: str, message: str, details: Any = None) -> None:
        super().__init__(f"{code}: {message}")
        self.code = code
        self.message = message
        self.details = details


class ToolCallLog(Protocol):
    async def tool_call(
        self, tool: str, ok: bool, error_code: str | None, latency_ms: int
    ) -> None: ...


class ApiClient:
    """One clinic's view of the API, authenticated as the agent."""

    def __init__(self, base_url: str, token: str, clinic_id: str, *, timeout: float = 10.0) -> None:
        self.clinic_id = clinic_id
        self._http = httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            headers={"Authorization": f"Bearer {token}"},
            timeout=timeout,
        )

    async def aclose(self) -> None:
        await self._http.aclose()

    async def _request(self, method: str, path: str, body: Any = None) -> Any:
        try:
            res = await self._http.request(method, f"/v1/clinics/{self.clinic_id}{path}", json=body)
        except httpx.HTTPError as e:
            raise ToolError("UNAVAILABLE", f"API unreachable: {e}") from e
        try:
            payload = res.json()
        except ValueError as e:
            raise ToolError("INTERNAL", f"non-JSON response ({res.status_code})") from e
        if not payload.get("ok"):
            err = payload.get("error") or {}
            raise ToolError(err.get("code", "INTERNAL"), err.get("message", ""), err.get("details"))
        return payload["data"]

    # ------------------------------------------------------------ config & call log

    async def config(self) -> c.BusinessConfig:
        return c.BusinessConfig.model_validate(await self._request("GET", "/config"))

    async def start_call(self, body: c.StartCallInput) -> str:
        data = await self._request("POST", "/calls", _dump(body))
        return c.StartCallOutput.model_validate(data).call_id

    async def call_event(self, call_id: str, event: dict[str, Any]) -> None:
        await self._request("POST", f"/calls/{call_id}/events", event)

    async def call_events(self, call_id: str) -> list[dict[str, Any]]:
        return (await self._request("GET", f"/calls/{call_id}/events"))["events"]

    async def due_reminders(self) -> list[c.DueReminder]:
        return c.DueRemindersOutput.model_validate(await self._request("GET", "/reminders/due")).due

    async def claim_reminders(
        self, worker: str, appointment_id: str | None = None
    ) -> list[c.DueReminder]:
        """The next due reminder, claimed for THIS worker; anyone else asking won't get it."""
        body: dict[str, object] = {"worker": worker, "limit": 1}
        if appointment_id:
            body["appointmentId"] = appointment_id
        return c.DueRemindersOutput.model_validate(
            await self._request("POST", "/reminders/claim", body)
        ).due

    async def tasks(self, status: str | None = None) -> list[c.StaffTask]:
        query = f"?status={status}" if status else ""
        return c.ListTasksOutput.model_validate(await self._request("GET", f"/tasks{query}")).tasks

    # ------------------------------------------------------------ tools

    async def tool(
        self, name: str, body: BaseModel, out: type[Out], log: ToolCallLog | None = None
    ) -> Out:
        started = time.perf_counter()
        error: ToolError | None = None
        try:
            data = await self._request("POST", f"/tools/{name}", _dump(body))
            return out.model_validate(data)
        except ToolError as e:
            error = e
            raise
        finally:
            if log is not None:
                ms = int((time.perf_counter() - started) * 1000)
                await log.tool_call(name, error is None, error.code if error else None, ms)


def _dump(model: BaseModel) -> dict[str, Any]:
    return model.model_dump(by_alias=True, exclude_none=True, mode="json")
