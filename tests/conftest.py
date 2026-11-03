"""Helpers shared by the planner, orchestrator and integration tests.

Async code is run with asyncio.run() inside normal test functions, so no pytest plugin
is needed.
"""

import asyncio

import pytest

from app.contracts import contract_errors
from app.mocks import build_mock_stack

COMPLETE_REQUEST = "أبي أغير شاشة آيفون 15 برو في حي الملقا"
CUSTOM_QUESTION = "يصلحونه قدامي ولا أتركه عندهم؟"


def run(coro):
    return asyncio.run(coro)


def assert_valid_event_stream(events, task_id):
    """The Event contract plus the rules a schema can't check: one task, seq 1..n, no gaps."""
    assert events, "no events"
    for event in events:
        assert contract_errors("event", event) == [], event["type"]
        assert event["task_id"] == task_id
    assert [e["seq"] for e in events] == list(range(1, len(events) + 1))


def assert_causal_order(events):
    """Per call: started before ended/failed, ended before its quote; comparison last."""
    position = {}
    for index, event in enumerate(events):
        data = event["data"]
        if event["type"] == "call.started":
            position.setdefault(("started", data["call_id"]), index)
        elif event["type"] in ("call.ended", "call.failed"):
            assert ("started", data["call_id"]) in position, "call ended before it started"
            position[("ended", data["call_id"])] = index
        elif event["type"] == "quote.ready":
            assert ("ended", data["call_id"]) in position, "quote before its call ended"
    types = [e["type"] for e in events]
    assert types[0] == "task.created"
    if "comparison.ready" in types:
        assert types[-1] == "comparison.ready"
    if "task.failed" in types:
        assert types[-1] == "task.failed"
    business = [i for i, t in enumerate(types) if t == "business.found"]
    calls = [i for i, t in enumerate(types) if t == "call.started"]
    if business and calls:
        assert max(business) < min(calls), "every shop is announced before the first call"


@pytest.fixture
def stack():
    """Planner + orchestrator wired to instant mocks (default scenario)."""
    return build_mock_stack(speed=0)


async def submit_ready_task(stack, request=COMPLETE_REQUEST, custom_questions=(CUSTOM_QUESTION,)):
    plan = await stack.planner.plan(request, custom_questions=list(custom_questions))
    assert plan.status == "ready", plan
    await stack.orchestrator.submit(plan.task_spec)
    return plan.task_spec["task_id"]
