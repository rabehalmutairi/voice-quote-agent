"""Encode the orchestrator's stored events as server-sent events."""

import json
from collections.abc import AsyncGenerator
from contextlib import aclosing

from fastapi.responses import StreamingResponse
from starlette.types import Send


async def _messages(events: AsyncGenerator[dict, None]) -> AsyncGenerator[str, None]:
    async with aclosing(events):
        async for event in events:
            data = json.dumps(event, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
            yield f"id: {event['seq']}\nevent: {event['type']}\ndata: {data}\n\n"


class TaskEventStream(StreamingResponse):
    def __init__(self, events: AsyncGenerator[dict, None]) -> None:
        self.messages = _messages(events)
        super().__init__(
            self.messages,
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    async def stream_response(self, send: Send) -> None:
        # A disconnect can interrupt sending while the generator is paused at yield.
        async with aclosing(self.messages):
            await super().stream_response(send)
