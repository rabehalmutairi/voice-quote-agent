"""Orchestrator: state, CallJobs, 3 concurrent calls, failures, timeouts, cancellation, events.

Providers are the mocks from app/mocks, plus small stubs defined here for failure cases.
"""

import asyncio
import copy
from dataclasses import replace

import pytest
from conftest import (
    COMPLETE_REQUEST,
    CUSTOM_QUESTION,
    assert_causal_order,
    assert_valid_event_stream,
    run,
    submit_ready_task,
)

from app.contracts import ContractError, contract_errors
from app.mocks import SCENARIOS, InMemoryEventSink, MockExtractor, build_mock_stack, mock_businesses
from app.orchestrator import (
    DuplicateTask,
    InvalidTaskState,
    MissingInput,
    Orchestrator,
    OrchestratorConfig,
    TaskAlreadyStarted,
    UnknownTask,
)

SHOP_1, SHOP_2, SHOP_3 = (b["place_id"] for b in mock_businesses())


def types(events):
    return [e["type"] for e in events]


async def full_run(stack, **kwargs):
    task_id = await submit_ready_task(stack, **kwargs)
    return await stack.orchestrator.run(task_id)


def rewire(stack, **providers):
    """Same stack, but with some providers or the config replaced."""
    parts = dict(
        planner=stack.planner,
        discovery=stack.discovery,
        calls=stack.calls,
        extractor=stack.extractor,
        comparator=stack.comparator,
        events=stack.events,
        config=stack.orchestrator.config,
    )
    parts.update(providers)
    stack.orchestrator = Orchestrator(**parts)
    return stack


# -- submit / needs_input / answer -------------------------------------------------------


def test_complete_task_is_created_and_waits_for_run(stack):
    task_id = run(submit_ready_task(stack))
    task = stack.orchestrator.get(task_id)
    assert task["state"] == "created"
    assert types(stack.events.events) == ["task.created"]
    assert stack.events.events[0]["data"] == task["task_spec"]


def test_missing_input_prevents_any_call(stack):
    async def scenario():
        plan = await stack.planner.plan("أبي أغير شاشة آيفون 15 برو")
        task = await stack.orchestrator.submit(plan.task_spec)
        assert task["state"] == "needs_input"
        with pytest.raises(MissingInput):
            await stack.orchestrator.run(task["task_id"])
        return task

    task = run(scenario())
    assert types(stack.events.events) == ["task.created", "task.needs_input"]
    assert stack.events.events[1]["data"] == {"questions": task["follow_up_questions"]}
    assert stack.discovery.requests == [] and stack.calls.jobs == []
    assert stack.orchestrator.get(task["task_id"])["state"] == "needs_input"


def test_answers_complete_the_task_then_it_runs(stack):
    async def scenario():
        plan = await stack.planner.plan("تصليح جوالي", custom_questions=[CUSTOM_QUESTION])
        task_id = (await stack.orchestrator.submit(plan.task_spec))["task_id"]
        partial = await stack.orchestrator.answer(task_id, {"device_model": "آيفون 15 برو"})
        assert partial.status == "needs_input"
        done = await stack.orchestrator.answer(task_id, {"repair_type": "الشاشة", "area": "الملقا"})
        assert done.status == "ready"
        assert stack.orchestrator.get(task_id)["state"] == "created"
        return await stack.orchestrator.run(task_id)

    task = run(scenario())
    assert task["state"] == "done"
    assert types(stack.events.events)[:3] == ["task.created", "task.needs_input", "task.needs_input"]
    # The second needs_input only asks what is still missing.
    assert [q["key"] for q in stack.events.events[2]["data"]["questions"]] == ["repair_type", "area"]


def test_invalid_answers_leave_the_task_unchanged(stack):
    async def scenario():
        plan = await stack.planner.plan("أبي أغير شاشة آيفون 15 برو")
        task_id = (await stack.orchestrator.submit(plan.task_spec))["task_id"]
        result = await stack.orchestrator.answer(task_id, {"colour": "أسود"})
        return task_id, result

    task_id, result = run(scenario())
    assert result.status == "invalid"
    assert stack.orchestrator.get(task_id)["state"] == "needs_input"
    assert len(stack.events.events) == 2


def test_two_answers_at_once_both_count(stack):
    class SlowResolver:
        async def resolve(self, text):
            await asyncio.sleep(0.02)
            return {"label": text, "lat": 24.8, "lng": 46.6, "radius_m": 5000}

    from app.mocks import MockRequestParser
    from app.planner import Planner

    planner = Planner(MockRequestParser(), SlowResolver())
    rewire(stack, planner=planner)

    async def scenario():
        plan = await planner.plan("تصليح جوالي")
        task_id = (await stack.orchestrator.submit(plan.task_spec))["task_id"]
        await asyncio.gather(
            stack.orchestrator.answer(task_id, {"area": "الملقا", "repair_type": "الشاشة"}),
            stack.orchestrator.answer(task_id, {"device_model": "آيفون 15"}),
        )
        return stack.orchestrator.get(task_id)

    task = run(scenario())
    assert task["task_spec"]["slots"] == {"repair_type": "الشاشة", "device_model": "آيفون 15"}
    assert task["state"] == "created"


def test_answer_only_while_waiting_for_input(stack):
    task_id = run(submit_ready_task(stack))
    with pytest.raises(InvalidTaskState):
        run(stack.orchestrator.answer(task_id, {"area": "الملقا"}))


def test_duplicate_task_is_refused(stack):
    async def scenario():
        plan = await stack.planner.plan(COMPLETE_REQUEST)
        await stack.orchestrator.submit(plan.task_spec)
        with pytest.raises(DuplicateTask):
            await stack.orchestrator.submit(plan.task_spec)

    run(scenario())
    assert types(stack.events.events) == ["task.created"]


def test_invalid_task_spec_is_refused_at_the_boundary(stack):
    spec = run(stack.planner.plan(COMPLETE_REQUEST)).task_spec
    spec["max_businesses"] = 7
    with pytest.raises(ContractError):
        run(stack.orchestrator.submit(spec))
    assert stack.events.events == []


def test_unknown_task(stack):
    with pytest.raises(UnknownTask):
        stack.orchestrator.get("tsk_nope")
    with pytest.raises(UnknownTask):
        run(stack.orchestrator.run("tsk_nope"))


# -- running: happy path, CallJobs, concurrency -----------------------------------------------


def test_full_run_reaches_done_through_every_state(stack):
    task = run(full_run(stack))
    assert task["state"] == "done"
    assert task["state_history"] == ["created", "discovering", "calling", "extracting", "done"]
    assert len(task["quotes"]) == 3
    assert task["comparison"]["status"] == "ranked"
    assert task["last_seq"] == len(stack.events.events)


def test_call_jobs_are_valid_and_built_from_the_task(stack):
    task = run(full_run(stack))
    spec = task["task_spec"]
    jobs = stack.calls.jobs
    assert len(jobs) == 3
    assert len({j["call_id"] for j in jobs}) == 3
    by_place = {b["place_id"]: b for b in task["businesses"]}
    for job in jobs:
        assert contract_errors("call_job", job) == []
        assert job["task_id"] == spec["task_id"]
        assert job["template"] == spec["category"]
        assert job["dynamic_variables"] == spec["slots"]
        assert job["custom_questions"] == spec["custom_questions"] == [CUSTOM_QUESTION]
        assert job["to_number"] == by_place[job["place_id"]]["phone_e164"]
        assert (job["attempt"], job["max_duration_s"]) == (1, 150)


def test_three_calls_run_at_the_same_time():
    stack = build_mock_stack(speed=0.05)  # calls last 20-45 ms, so they overlap if concurrent
    task = run(full_run(stack))
    assert task["state"] == "done"
    assert stack.calls.max_in_flight == 3


def test_three_calls_take_as_long_as_the_slowest_not_the_sum():
    stack = build_mock_stack(speed=0.5)  # calls of 0.30 s, 0.45 s, 0.20 s: sum 0.95 s

    async def timed():
        task_id = await submit_ready_task(stack)
        loop = asyncio.get_running_loop()
        start = loop.time()
        await stack.orchestrator.run(task_id)
        return loop.time() - start

    assert run(timed()) < 0.8


def test_max_businesses_limits_the_calls():
    stack = build_mock_stack(speed=0)

    async def scenario():
        plan = await stack.planner.plan(COMPLETE_REQUEST, max_businesses=2)
        await stack.orchestrator.submit(plan.task_spec)
        return await stack.orchestrator.run(plan.task_spec["task_id"])

    task = run(scenario())
    assert len(task["businesses"]) == 2 and len(stack.calls.jobs) == 2
    assert stack.discovery.requests[0]["limit"] == 2


def test_run_twice_is_refused(stack):
    async def scenario():
        task_id = await submit_ready_task(stack)
        first = asyncio.create_task(stack.orchestrator.run(task_id))
        await asyncio.sleep(0)  # let the first run start
        with pytest.raises(TaskAlreadyStarted):
            await stack.orchestrator.run(task_id)
        await first
        with pytest.raises(TaskAlreadyStarted):
            await stack.orchestrator.run(task_id)

    run(scenario())
    assert len(stack.calls.jobs) == 3  # still only one set of calls


def test_ensure_runnable_lets_the_api_refuse_before_scheduling(stack):
    async def scenario():
        plan = await stack.planner.plan("أبي أغير شاشة آيفون 15 برو")
        task_id = (await stack.orchestrator.submit(plan.task_spec))["task_id"]
        with pytest.raises(MissingInput):
            stack.orchestrator.ensure_runnable(task_id)
        await stack.orchestrator.answer(task_id, {"area": "الملقا"})
        stack.orchestrator.ensure_runnable(task_id)  # no error: ready
        await stack.orchestrator.run(task_id)
        with pytest.raises(TaskAlreadyStarted):
            stack.orchestrator.ensure_runnable(task_id)
        with pytest.raises(UnknownTask):
            stack.orchestrator.ensure_runnable("tsk_nope")

    run(scenario())


def test_snapshot_is_a_copy(stack):
    task = run(full_run(stack))
    task["quotes"].clear()
    task["task_spec"]["slots"].clear()
    again = stack.orchestrator.get(task["task_id"])
    assert len(again["quotes"]) == 3 and again["task_spec"]["slots"]


# -- partial results and failures ---------------------------------------------------------------


def test_one_failed_call_does_not_stop_the_others():
    stack = build_mock_stack("one_failed", speed=0)
    task = run(full_run(stack))
    assert task["state"] == "done"
    assert {q["place_id"] for q in task["quotes"]} == {SHOP_1, SHOP_3}
    assert task["excluded"] == [{"place_id": SHOP_2, "reason": "no answer"}]
    assert task["comparison"]["status"] == "partial"
    failed = [e for e in stack.events.events if e["type"] == "call.failed"]
    assert len(failed) == 1
    assert failed[0]["data"]["outcome"] == "no_answer" and failed[0]["data"]["place_id"] == SHOP_2


def test_every_call_failing_fails_the_task():
    stack = build_mock_stack("all_failed", speed=0)
    task = run(full_run(stack))
    assert task["state"] == "failed"
    assert task["state_history"][-2:] == ["calling", "failed"]  # nothing was extracted
    assert task["failure_reason"].startswith("no shop gave a usable answer")
    event_types = types(stack.events.events)
    assert event_types.count("call.failed") == 3
    assert "quote.ready" not in event_types and "comparison.ready" not in event_types
    assert event_types[-1] == "task.failed"
    assert stack.extractor.calls == []


def test_a_call_that_never_ends_is_timed_out_and_the_others_finish():
    stack = build_mock_stack("timeout", speed=0)
    task = run(full_run(stack))
    assert task["state"] == "done"
    failed = next(e["data"] for e in stack.events.events if e["type"] == "call.failed")
    assert failed["place_id"] == SHOP_3 and failed["outcome"] == "failed"
    assert "timed out" in failed["reason"]
    assert len(task["quotes"]) == 2


def test_task_timeout_fails_the_whole_task():
    stack = build_mock_stack("timeout", speed=0)
    config = OrchestratorConfig(call_timeout_s=60, task_timeout_s=0.3)
    rewire(stack, config=config)
    task = run(full_run(stack))
    assert task["state"] == "failed"
    assert task["failure_reason"] == "task timed out after 0.3 s"
    assert types(stack.events.events)[-1] == "task.failed"
    assert stack.calls.in_flight == 0  # the hanging call was cancelled, not left running


def test_provider_crash_is_isolated_to_its_call():
    stack = build_mock_stack("provider_error", speed=0)
    task = run(full_run(stack))
    assert task["state"] == "done"
    assert task["excluded"] == [{"place_id": SHOP_2, "reason": "call provider error (ConnectionError)"}]


def test_no_shops_found_fails_cleanly():
    stack = build_mock_stack("no_shops", speed=0)
    task = run(full_run(stack))
    assert task["state"] == "failed"
    assert types(stack.events.events) == ["task.created", "task.failed"]
    assert stack.calls.jobs == []


class StubDiscovery:
    def __init__(self, result=None, error=None):
        self.result, self.error = result, error

    async def find_businesses(self, task_spec, limit):
        if self.error:
            raise self.error
        return copy.deepcopy(self.result)


def test_discovery_crash_fails_the_task(stack):
    rewire(stack, discovery=StubDiscovery(error=ConnectionError("places down")))
    task = run(full_run(stack))
    assert task["state"] == "failed"
    assert task["failure_reason"] == "shop search failed (ConnectionError)"


def test_invalid_and_duplicate_businesses_are_skipped(stack):
    shops = mock_businesses()
    broken = {**shops[1], "phone_e164": "0500000002"}  # not E.164
    duplicate = copy.deepcopy(shops[0])
    rewire(stack, discovery=StubDiscovery([shops[0], broken, duplicate, shops[2]]))
    task = run(full_run(stack))
    assert [b["place_id"] for b in task["businesses"]] == [SHOP_1, SHOP_3]
    assert len(stack.calls.jobs) == 2


class StubCalls:
    """Returns whatever `make(job)` builds, so tests can break the CallResult contract."""

    def __init__(self, make):
        self.make = make

    async def place_call(self, call_job):
        return self.make(call_job)


def test_an_invalid_call_result_counts_as_a_failed_call(stack):
    def broken(job):
        return {"call_id": job["call_id"], "outcome": "human_completed"}  # most keys missing

    rewire(stack, calls=StubCalls(broken))
    task = run(full_run(stack))
    assert task["state"] == "failed"
    assert {c["reason"] for c in task["calls"]} == {"call provider returned an invalid CallResult"}


def test_a_call_result_for_another_call_is_rejected(stack):
    real = stack.calls

    class WrongId:
        async def place_call(self, job):
            result = await real.place_call(job)
            return {**result, "call_id": "call_someoneelse"}

    rewire(stack, calls=WrongId())
    task = run(full_run(stack))
    assert task["state"] == "failed"
    assert "different call" in task["calls"][0]["reason"]


def test_extraction_failure_excludes_only_that_shop(stack):
    rewire(stack, extractor=MockExtractor(fail_for={SHOP_1}))
    task = run(full_run(stack))
    assert task["state"] == "done"
    assert task["excluded"] == [{"place_id": SHOP_1, "reason": "reading the answers failed"}]
    assert "quote.ready" in types(stack.events.events)
    assert task["comparison"]["excluded"] == task["excluded"]


def test_an_invalid_quote_is_not_forwarded(stack):
    class BadExtractor:
        async def extract(self, call_result, task_spec, template):
            return {"call_id": call_result["call_id"]}

    rewire(stack, extractor=BadExtractor())
    task = run(full_run(stack))
    assert task["state"] == "failed"
    assert "quote.ready" not in types(stack.events.events)
    assert set(task["excluded"][0].values()) >= {"extraction returned an invalid Quote"}


def test_an_invalid_comparison_fails_the_task(stack):
    class BadComparator:
        async def compare(self, task_spec, template, quotes, excluded):
            return {"task_id": task_spec["task_id"], "status": "ranked"}

    rewire(stack, comparator=BadComparator())
    task = run(full_run(stack))
    assert task["state"] == "failed"
    assert task["failure_reason"] == "comparison returned an invalid Comparison"
    assert task["state_history"][-2:] == ["extracting", "failed"]


def test_missing_call_variable_fails_before_any_call(stack):
    spec = run(stack.planner.plan(COMPLETE_REQUEST)).task_spec
    del spec["slots"]["device_model"]  # valid TaskSpec, but {{device_model}} would be read aloud
    run(stack.orchestrator.submit(spec))
    task = run(stack.orchestrator.run(spec["task_id"]))
    assert task["state"] == "failed"
    assert "device_model" in task["failure_reason"]
    assert stack.calls.jobs == []


# -- retries (R4's policy decides, the orchestrator caps) -------------------------------------


def test_a_retry_policy_gets_one_more_attempt():
    stack = build_mock_stack("retry", speed=0)
    task = run(full_run(stack))
    assert task["state"] == "done"
    attempts = sorted(j["attempt"] for j in stack.calls.jobs if j["place_id"] == SHOP_2)
    assert attempts == [1, 2]
    shop2_call = next(c for c in task["calls"] if c["place_id"] == SHOP_2)
    started = [e for e in stack.events.events if e["type"] == "call.started" and e["data"]["call_id"] == shop2_call["call_id"]]
    assert len(started) == 2  # the UI sees the shop ringing again


class AlwaysRetry:
    def retry_delay_s(self, call_job, call_result):
        return 0


def test_never_more_than_one_retry():
    stack = build_mock_stack("all_failed", speed=0)
    rewire(stack, retry_policy=AlwaysRetry())
    task = run(full_run(stack))
    assert sorted(j["attempt"] for j in stack.calls.jobs) == [1, 1, 1, 2, 2, 2]
    assert all(c["reason"].endswith("after one retry") for c in task["calls"])


def test_no_retry_once_the_cost_cap_is_reached():
    stack = build_mock_stack("all_failed", speed=0)
    rewire(stack, retry_policy=AlwaysRetry(), config=OrchestratorConfig(max_task_cost_usd=0))
    run(full_run(stack))
    assert [j["attempt"] for j in stack.calls.jobs] == [1, 1, 1]


# -- cancellation ----------------------------------------------------------------------------


def test_cancel_a_running_task():
    stack = build_mock_stack("timeout", speed=0)
    rewire(stack, config=OrchestratorConfig(call_timeout_s=60))

    async def scenario():
        task_id = await submit_ready_task(stack)
        runner = asyncio.create_task(stack.orchestrator.run(task_id))
        while stack.calls.in_flight < 1:  # wait until the hanging call is ringing
            await asyncio.sleep(0.01)
        assert await stack.orchestrator.cancel(task_id) is True
        with pytest.raises(asyncio.CancelledError):
            await runner
        return task_id

    task = stack.orchestrator.get(run(scenario()))
    assert task["state"] == "failed" and task["failure_reason"] == "cancelled"
    assert types(stack.events.events)[-1] == "task.failed"
    assert stack.calls.in_flight == 0
    assert_valid_event_stream(stack.events.events, task["task_id"])


def test_cancel_before_start_and_after_finish(stack):
    async def scenario():
        plan = await stack.planner.plan("أبي أغير شاشة آيفون 15 برو")
        task_id = (await stack.orchestrator.submit(plan.task_spec))["task_id"]
        assert await stack.orchestrator.cancel(task_id) is True
        assert await stack.orchestrator.cancel(task_id) is False
        with pytest.raises(TaskAlreadyStarted):
            await stack.orchestrator.run(task_id)
        with pytest.raises(InvalidTaskState):
            await stack.orchestrator.answer(task_id, {"area": "الملقا"})
        return task_id

    task = stack.orchestrator.get(run(scenario()))
    assert task["state"] == "failed"
    assert types(stack.events.events) == ["task.created", "task.needs_input", "task.failed"]


# -- events ----------------------------------------------------------------------------------


@pytest.mark.parametrize("scenario", sorted(SCENARIOS))
def test_events_are_valid_ordered_and_gapless_in_every_scenario(scenario):
    stack = build_mock_stack(scenario, speed=0.02)
    task = run(full_run(stack))
    events = stack.events.events
    assert_valid_event_stream(events, task["task_id"])
    assert_causal_order(events)
    assert task["last_seq"] == len(events)


def test_event_data_is_the_contract_object(stack):
    task = run(full_run(stack))
    events = {e["type"]: e for e in stack.events.events}
    assert events["task.created"]["data"] == task["task_spec"]
    assert events["comparison.ready"]["data"] == task["comparison"]
    ended = [e["data"] for e in stack.events.events if e["type"] == "call.ended"]
    assert all(contract_errors("call_result", r) == [] for r in ended)


class FlakySink(InMemoryEventSink):
    """Fails once, on the first event of `fail_on` type."""

    def __init__(self, fail_on):
        super().__init__()
        self.fail_on = fail_on

    async def publish(self, event):
        if event["type"] == self.fail_on:
            self.fail_on = None
            raise ConnectionError("db down")
        await super().publish(event)


def test_a_failing_event_sink_fails_the_task_without_a_seq_gap(stack):
    sink = FlakySink("call.started")
    rewire(stack, events=sink)
    task = run(full_run(stack))
    assert task["state"] == "failed"
    assert task["failure_reason"] == "internal error (ConnectionError)"
    assert_valid_event_stream(sink.events, task["task_id"])
    assert sink.events[-1]["type"] == "task.failed"


def test_events_carry_the_clock_time():
    from datetime import datetime, timezone

    stack = build_mock_stack(speed=0)
    rewire(stack, clock=lambda: datetime(2026, 11, 5, 10, 0, tzinfo=timezone.utc))
    run(full_run(stack))
    assert {e["at"] for e in stack.events.events} == {"2026-11-05T10:00:00Z"}


def test_bad_config_is_refused():
    with pytest.raises(ValueError):
        OrchestratorConfig(max_parallel_calls=4)
    with pytest.raises(ValueError):
        replace(OrchestratorConfig(), call_max_duration_s=300)
