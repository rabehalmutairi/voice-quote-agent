"""Publish committed PostgreSQL events to the local API's subscribers."""

import asyncio
from collections.abc import AsyncGenerator, Callable

from app.db.postgres import PostgresStore
from app.mocks.providers import FINAL_EVENTS


class PostgresEventSink:
    def __init__(
        self, store: PostgresStore, snapshot: Callable[[str], dict], *, queue_size: int = 100
    ) -> None:
        self.store = store
        self.snapshot = snapshot
        self.queue_size = queue_size
        self._subscribers: dict[str, set[asyncio.Queue]] = {}

    async def publish(self, event: dict) -> None:
        task_id = event["task_id"]
        snapshot = self.snapshot(task_id)
        snapshot["last_seq"] = event["seq"]
        # R1 transitions to done immediately after the comparison event is published.
        if event["type"] == "comparison.ready":
            snapshot["state"] = "done"
            snapshot["state_history"].append("done")

        # A task timeout can interrupt publish. Let the write settle first so a
        # committed sequence is advanced before the orchestrator handles cancellation.
        write = asyncio.create_task(self.store.record(event, snapshot))
        cancelled = False
        while True:
            try:
                await asyncio.shield(write)
                break
            except asyncio.CancelledError:
                if write.cancelled():
                    raise
                cancelled = True

        subscribers = self._subscribers.get(task_id, set())
        for queue in tuple(subscribers):
            try:
                queue.put_nowait(event)
            except asyncio.QueueFull:
                subscribers.discard(queue)
                queue.get_nowait()
                queue.put_nowait(None)  # stop the lagging stream so it can replay
        if cancelled:
            asyncio.current_task().cancel()

    async def follow(
        self, task_id: str, after_seq: int = 0, *, live: bool = True
    ) -> AsyncGenerator[dict, None]:
        if not live:
            for event in await self.store.replay(task_id, after_seq):
                yield event
            return

        queue: asyncio.Queue = asyncio.Queue(self.queue_size)
        subscribers = self._subscribers.setdefault(task_id, set())
        subscribers.add(queue)
        try:
            for event in await self.store.replay(task_id, after_seq):
                after_seq = event["seq"]
                yield event
                if event["type"] in FINAL_EVENTS:
                    return
            while True:
                event = await queue.get()
                if queue not in subscribers or event is None:
                    return
                if event["seq"] > after_seq:
                    after_seq = event["seq"]
                    yield event
                    if event["type"] in FINAL_EVENTS:
                        return
        finally:
            subscribers.discard(queue)
            if not subscribers and self._subscribers.get(task_id) is subscribers:
                self._subscribers.pop(task_id, None)
