"""start(): atomic background start for R5's POST /start, plus the orchestrator's own
outbound-content check (the second line behind the planner)."""

import asyncio
import gc

import pytest
from conftest import COMPLETE_REQUEST, run, submit_ready_task

from app.mocks import build_mock_stack
from app.orchestrator import MissingInput, TaskAlreadyStarted, UnknownTask, UnsafeContent


def types(stack):
    return [e["type"] for e in stack.events.events]


def test_start_runs_the_task_in_the_background(stack):
    async def scenario():
        task_id = await submit_ready_task(stack)
        runner = stack.orchestrator.start(task_id)
        assert isinstance(runner, asyncio.Task)
        assert stack.orchestrator.get(task_id)["state"] == "discovering"  # changed before returning
        return await runner

    task = run(scenario())
    assert task["state"] == "done"


def test_two_starts_in_a_row_place_calls_once(stack):
    async def scenario():
        task_id = await submit_ready_task(stack)
        runner = stack.orchestrator.start(task_id)
        with pytest.raises(TaskAlreadyStarted):
            stack.orchestrator.start(task_id)  # same tick, before the runner has even begun
        with pytest.raises(TaskAlreadyStarted):
            await stack.orchestrator.run(task_id)
        await runner

    run(scenario())
    assert len(stack.calls.jobs) == 3


def test_start_refuses_before_scheduling_anything(stack):
    async def scenario():
        plan = await stack.planner.plan("أبي أغير شاشة آيفون 15 برو")  # no area yet
        task_id = (await stack.orchestrator.submit(plan.task_spec))["task_id"]
        with pytest.raises(MissingInput):
            stack.orchestrator.start(task_id)
        with pytest.raises(UnknownTask):
            stack.orchestrator.start("tsk_nope")
        return task_id

    task_id = run(scenario())
    assert stack.orchestrator.get(task_id)["state"] == "needs_input"
    assert stack.discovery.requests == []


def test_the_orchestrator_keeps_the_runner_alive_without_a_caller_reference(stack):
    async def scenario():
        task_id = await submit_ready_task(stack)
        stack.orchestrator.start(task_id)  # return value deliberately dropped, as a careless route might
        gc.collect()
        while stack.orchestrator.get(task_id)["state"] not in ("done", "failed"):
            await asyncio.sleep(0.01)
        return task_id

    assert stack.orchestrator.get(run(scenario()))["state"] == "done"


def test_start_outside_an_event_loop_changes_nothing(stack):
    task_id = run(submit_ready_task(stack))
    with pytest.raises(RuntimeError):
        stack.orchestrator.start(task_id)  # no running loop here
    assert stack.orchestrator.get(task_id)["state"] == "created"
    assert run(stack.orchestrator.run(task_id))["state"] == "done"  # and it can still start


def test_a_scheduling_failure_is_rolled_back(stack):
    async def scenario():
        task_id = await submit_ready_task(stack)
        loop = asyncio.get_running_loop()
        real_create_task = loop.create_task

        def broken(*args, **kwargs):
            raise RuntimeError("cannot schedule")

        loop.create_task = broken
        try:
            with pytest.raises(RuntimeError, match="cannot schedule"):
                stack.orchestrator.start(task_id)
        finally:
            loop.create_task = real_create_task
        task = stack.orchestrator.get(task_id)
        assert task["state"] == "created" and task["state_history"] == ["created"]
        return await stack.orchestrator.run(task_id)  # a later start works

    assert run(scenario())["state"] == "done"
    assert types(stack).count("task.created") == 1


def test_cancel_right_after_start_still_fails_the_task_cleanly(stack):
    async def scenario():
        task_id = await submit_ready_task(stack)
        runner = stack.orchestrator.start(task_id)
        assert await stack.orchestrator.cancel(task_id) is True  # before the runner's first step
        with pytest.raises(asyncio.CancelledError):
            await runner
        for _ in range(10):  # the cleanup runs on the next loop iterations
            await asyncio.sleep(0)
        return task_id

    task = stack.orchestrator.get(run(scenario()))
    assert task["state"] == "failed" and task["failure_reason"] == "cancelled"
    assert types(stack) == ["task.created", "task.failed"]
    assert stack.calls.jobs == []


def test_cancel_a_started_task_mid_call():
    stack = build_mock_stack("timeout", speed=0)

    async def scenario():
        task_id = await submit_ready_task(stack)
        runner = stack.orchestrator.start(task_id)
        while stack.calls.in_flight < 1:
            await asyncio.sleep(0.01)
        await stack.orchestrator.cancel(task_id)
        with pytest.raises(asyncio.CancelledError):
            await runner
        return task_id

    task = stack.orchestrator.get(run(scenario()))
    assert task["state"] == "failed" and types(stack)[-1] == "task.failed"
    assert stack.calls.in_flight == 0


# -- second line of the outbound-content check -------------------------------------------------


def test_submit_refuses_unsafe_content_from_a_spec_built_elsewhere(stack):
    spec = run(stack.planner.plan(COMPLETE_REQUEST)).task_spec
    spec["custom_questions"] = ["اتصلوا علي على 0551234567"]  # valid per schema, unsafe per policy
    with pytest.raises(UnsafeContent) as error:
        run(stack.orchestrator.submit(spec))
    assert "0551234567" not in str(error.value)
    assert stack.events.events == []


def test_pipeline_rechecks_before_any_call(stack, monkeypatch):
    # Simulate content that slipped past submit (e.g. a future code path): the pipeline's
    # own check must still stop it before discovery and before any CallJob exists.
    import app.orchestrator.orchestrator as orchestrator_module
    from app.planner.policy import PolicyIssue

    calls = {"n": 0}

    def check(slots, questions):
        calls["n"] += 1
        return [] if calls["n"] == 1 else [("custom_questions[0]", PolicyIssue("booking", "a booking request"))]

    monkeypatch.setattr(orchestrator_module, "check_outbound", check)
    task = run(stack.orchestrator.run(run(submit_ready_task(stack))))
    assert task["state"] == "failed"
    assert "outbound content check" in task["failure_reason"]
    assert stack.discovery.requests == [] and stack.calls.jobs == []
