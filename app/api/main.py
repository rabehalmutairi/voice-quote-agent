"""Task API and live progress using the project's mock providers."""

import asyncio
import os
from collections.abc import AsyncIterator
from contextlib import AsyncExitStack, asynccontextmanager
from typing import Annotated, Any

from fastapi import Body, FastAPI, Header, Request
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, StrictInt

from app.api.events import TaskEventStream
from app.db.events import PostgresEventSink
from app.db.postgres import open_store
from app.mocks.providers import FINAL_EVENTS
from app.mocks.scenarios import build_mock_stack
from app.orchestrator import (
    DuplicateTask,
    InvalidTaskState,
    MissingInput,
    OrchestratorError,
    TaskAlreadyStarted,
    UnknownTask,
    UnsafeContent,
)
from app.planner import PlanResult


class CreateTaskBody(BaseModel):
    text: str
    custom_questions: list[str] | None = None
    area: str | dict[str, Any] | None = None
    max_businesses: StrictInt = 3


_PLAN_STATUS = {
    "ready": 201,
    "needs_input": 201,
    "invalid": 422,
    "rejected": 422,
    "error": 503,
}


def _plan_response(result: PlanResult) -> JSONResponse:
    return JSONResponse(result.to_dict(), status_code=_PLAN_STATUS[result.status])


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    scenario = os.getenv("MOCK_SCENARIO", "default")
    url = os.getenv("R5_DATABASE_URL")
    async with AsyncExitStack() as resources:
        store = await resources.enter_async_context(open_store(url)) if url else None
        if store is not None:
            events = PostgresEventSink(store, lambda task_id: stack.orchestrator.get(task_id))
            # The mock builder accepts the orchestrator's EventSink interface at runtime.
            stack = build_mock_stack(scenario, events=events)  # type: ignore[arg-type]
        else:
            stack = build_mock_stack(scenario)
        app.state.stack = stack
        app.state.store = store
        app.state.runners = set()
        try:
            yield
        finally:
            await asyncio.gather(*app.state.runners, return_exceptions=True)


app = FastAPI(title="Voice Quote Agent (Mock Mode)", lifespan=lifespan)


@app.exception_handler(OrchestratorError)
async def orchestrator_error(_request: Request, exc: OrchestratorError) -> JSONResponse:
    if isinstance(exc, UnknownTask):
        status_code = 404
    elif isinstance(exc, (DuplicateTask, MissingInput, TaskAlreadyStarted, InvalidTaskState)):
        status_code = 409
    elif isinstance(exc, UnsafeContent):
        status_code = 422
    else:
        raise exc
    return JSONResponse(
        {"error": {"code": exc.code, "message": str(exc)}},
        status_code=status_code,
    )


@app.post("/tasks", status_code=201)
async def create_task(body: CreateTaskBody, request: Request) -> JSONResponse:
    stack = request.app.state.stack
    result = await stack.planner.plan(
        body.text,
        custom_questions=body.custom_questions,
        area=body.area,
        max_businesses=body.max_businesses,
    )
    if result.accepted:
        await stack.orchestrator.submit(result.task_spec)
    return _plan_response(result)


@app.post("/tasks/{task_id}/answers", status_code=201)
async def answer_task(
    task_id: str,
    answers: Annotated[
        dict[str, Any],
        Body(openapi_examples={"area": {"value": {"area": "حي الملقا"}}}),
    ],
    request: Request,
) -> JSONResponse:
    stack = request.app.state.stack
    result = await stack.orchestrator.answer(task_id, answers)
    store = request.app.state.store
    if store is not None and result.status == "ready":
        await store.save_ready_snapshot(stack.orchestrator.get(task_id))
    return _plan_response(result)


@app.post("/tasks/{task_id}/start", status_code=202)
async def start_task(task_id: str, request: Request) -> dict[str, str]:
    stack = request.app.state.stack
    try:
        runner = stack.orchestrator.start(task_id)
    except UnknownTask:
        store = request.app.state.store
        if store is not None and await store.snapshot(task_id) is not None:
            raise TaskAlreadyStarted("Saved tasks are read-only after a restart.") from None
        raise
    runners = request.app.state.runners
    runners.add(runner)
    runner.add_done_callback(runners.discard)
    return {"task_id": task_id}


async def _find_snapshot(task_id: str, request: Request) -> tuple[dict, bool]:
    try:
        return request.app.state.stack.orchestrator.get(task_id), True
    except UnknownTask:
        store = request.app.state.store
        saved = await store.snapshot(task_id) if store is not None else None
        if saved is None:
            raise
        if saved["state"] not in {"done", "failed"}:
            saved["state"] = "failed"
            saved["state_history"].append("failed")
            saved["failure_reason"] = "Backend restarted before the task finished."
        return saved, False


@app.get("/tasks/{task_id}")
async def get_task(task_id: str, request: Request) -> dict:
    snapshot, _ = await _find_snapshot(task_id, request)
    store = request.app.state.store
    if store is not None:
        costs = await store.call_costs(task_id)
        for call in snapshot["calls"]:
            call["cost_usd"] = costs.get(call["call_id"])
    return snapshot


@app.get(
    "/tasks/{task_id}/events",
    response_class=Response,
    responses={
        200: {"content": {"text/event-stream": {}}},
        204: {"description": "The terminal event was already received"},
        400: {"description": "Invalid Last-Event-ID"},
    },
)
async def task_events(
    task_id: str,
    request: Request,
    last_event_id: Annotated[str, Header()] = "0",
) -> Response:
    stack = request.app.state.stack
    snapshot, live = await _find_snapshot(task_id, request)
    try:
        cursor = int(last_event_id) if last_event_id.isascii() and last_event_id.isdecimal() else -1
    except ValueError:
        cursor = -1
    if not 0 <= cursor <= snapshot["last_seq"]:
        return JSONResponse(
            {"error": {"code": "invalid_event_cursor", "message": "Last-Event-ID must refer to a received event or be 0"}},
            status_code=400,
        )

    if not live and cursor == snapshot["last_seq"]:
        return Response(status_code=204)

    store = request.app.state.store
    if cursor == snapshot["last_seq"] and cursor:
        if store is None:
            kind = stack.events.for_task(task_id)[-1]["type"]
        else:
            kind = await store.event_type(task_id, cursor)
        if kind in FINAL_EVENTS:
            # HTTP 204 also tells browser EventSource clients to stop reconnecting.
            return Response(status_code=204)

    events = (
        stack.events.follow(task_id, after_seq=cursor)
        if live
        else stack.events.follow(task_id, after_seq=cursor, live=False)
    )
    return TaskEventStream(events)
