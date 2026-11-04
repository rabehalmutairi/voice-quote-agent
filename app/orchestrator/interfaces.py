"""What the orchestrator needs from other roles' components.

Each interface takes and returns contract objects: plain dicts that validate against
/contracts. The orchestrator validates what comes back, so a provider that breaks a
contract fails loudly at the boundary instead of somewhere downstream.

These are `typing.Protocol`s: you don't inherit from them, you write a class with the
same method and pass an instance to `Orchestrator(...)`. Mocks: app/mocks/. How each
role plugs in: docs/integration.md.

All methods are async. A provider that calls a network API should `await` it; one that
is pure computation can just return. Every call may be cancelled (task timeout or user
cancel): handle `asyncio.CancelledError` by cleaning up (e.g. hang up) and re-raising.
"""

from __future__ import annotations

from typing import Protocol


class DiscoveryProvider(Protocol):
    """R5: Google Places. Returns callable shops for the task, best first."""

    async def find_businesses(self, task_spec: dict, limit: int) -> list[dict]:
        """Up to `limit` Business objects. An empty list means none found (the task fails cleanly)."""
        ...


class CallProvider(Protocol):
    """R4 + R2: Twilio + ElevenLabs. Places ONE call attempt and waits for it to end.

    Must refuse numbers not on the allowlist (architecture §11) and convert the
    ElevenLabs speaker `user` to `shop`. Retries are not done here: the orchestrator
    asks the RetryPolicy and places a second attempt itself.
    """

    async def place_call(self, call_job: dict) -> dict:
        """Return the CallResult. call_id, task_id and place_id must match the CallJob."""
        ...


class RetryPolicy(Protocol):
    """R4: whether and when to retry a call that didn't reach a person."""

    def retry_delay_s(self, call_job: dict, call_result: dict | None) -> float | None:
        """Seconds to wait before attempt 2, or None for no retry.

        `call_result` is None when the attempt produced no CallResult (timeout or
        provider error). Only asked after attempt 1: the contract allows at most one retry.
        """
        ...


class Extractor(Protocol):
    """R6: transcript -> Quote, with the evidence checker applied."""

    async def extract(self, call_result: dict, task_spec: dict, template: dict) -> dict:
        """Return the Quote. Only called for calls that reached a person (human_*)."""
        ...


class Comparator(Protocol):
    """R6: Quotes -> Comparison."""

    async def compare(self, task_spec: dict, template: dict, quotes: list[dict], excluded: list[dict]) -> dict:
        """Return the Comparison.

        `excluded` lists shops with no usable quote as {place_id, reason}: failed calls
        and failed extractions. Copy them into Comparison.excluded.
        """
        ...


class EventSink(Protocol):
    """R5: stores each event, then streams it to the UI over SSE (`seq` = SSE event id).

    Events arrive one at a time, already validated and numbered 1, 2, 3... per task.

    The rule (the orchestrator's "no gaps" guarantee depends on it):
    - `publish` returns ONLY after the event is durably stored (committed).
    - `publish` raises ONLY if the event was NOT stored. The orchestrator then gives the
      next event the same `seq`, so storage never has a gap or a duplicate, and the task
      fails (we'd rather stop than let the UI miss an event).
    - Pushing to live SSE connections happens after storing and must NEVER raise from
      `publish`: a broken or slow connection is dropped, and the browser reconnects with
      `Last-Event-ID` and gets the missed events replayed from storage.
    - Keep a UNIQUE (task_id, seq) constraint as a safety net, but don't use
      "ON CONFLICT DO NOTHING": a conflict means a bug and must be loud.

    Reference implementation: app.mocks.InMemoryEventSink (`publish`, `replay`, `follow`).
    """

    async def publish(self, event: dict) -> None: ...


class NoRetry:
    """Default RetryPolicy until R4's is plugged in: never retry."""

    def retry_delay_s(self, call_job: dict, call_result: dict | None) -> float | None:
        return None
