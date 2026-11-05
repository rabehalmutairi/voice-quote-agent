"""R4RetryPolicy on its own, and plugged into the real orchestrator with mock providers."""

import json
from datetime import datetime

import pytest

from app.contracts import CONTRACTS_DIR
from app.mocks import build_mock_stack
from app.orchestrator import Orchestrator
from app.telephony import R4RetryPolicy
from app.telephony.calling_hours import RIYADH
from conftest import run, submit_ready_task

OPEN = datetime(2026, 11, 5, 20, 0, tzinfo=RIYADH)  # Thursday evening: retry at 20:10 is fine
BEFORE_MAGHRIB = datetime(2026, 11, 5, 16, 45, tzinfo=RIYADH)  # retry at 16:55 = Maghrib
BEFORE_CLOSING = datetime(2026, 11, 5, 22, 18, tzinfo=RIYADH)  # retry at 22:28 + 3.5 min > 22:30

JOB = json.loads((CONTRACTS_DIR / "examples" / "call_job.json").read_text(encoding="utf-8"))


def result(outcome):
    return {"outcome": outcome}


def policy(at=OPEN, **kwargs):
    return R4RetryPolicy(clock=lambda: at, **kwargs)


@pytest.mark.parametrize("outcome", ["no_answer", "busy"])
def test_retries_once_after_ten_minutes(outcome):
    assert policy().retry_delay_s(JOB, result(outcome)) == 600.0


@pytest.mark.parametrize(
    "outcome", ["human_completed", "human_partial", "voicemail", "ivr", "hung_up", "wrong_business", "failed"]
)
def test_other_outcomes_are_not_retried(outcome):
    assert policy().retry_delay_s(JOB, result(outcome)) is None


def test_timeout_or_crash_is_not_retried():
    assert policy().retry_delay_s(JOB, None) is None


def test_never_a_second_retry():
    assert policy().retry_delay_s({**JOB, "attempt": 2}, result("no_answer")) is None


@pytest.mark.parametrize("at", [BEFORE_MAGHRIB, BEFORE_CLOSING, datetime(2026, 11, 6, 10, 30, tzinfo=RIYADH)])
def test_no_retry_outside_calling_hours(at):
    assert policy(at).retry_delay_s(JOB, result("no_answer")) is None


def test_negative_settings_are_refused():
    with pytest.raises(ValueError):
        R4RetryPolicy(delay_s=-1)


def test_does_not_modify_its_inputs():
    job, res = dict(JOB), result("busy")
    policy().retry_delay_s(job, res)
    assert job == JOB and res == {"outcome": "busy"}


# -- in the mock pipeline (Sat 7 Nov deliverable) ------------------------------------


def run_retry_scenario(retry_policy):
    stack = build_mock_stack("retry", speed=0)  # shop 2: no answer, then answers on attempt 2
    stack.orchestrator = Orchestrator(
        planner=stack.planner,
        discovery=stack.discovery,
        calls=stack.calls,
        extractor=stack.extractor,
        comparator=stack.comparator,
        events=stack.events,
        retry_policy=retry_policy,
        config=stack.orchestrator.config,
    )

    async def go():
        task_id = await submit_ready_task(stack)
        return await stack.orchestrator.run(task_id)

    return stack, run(go())


def test_pipeline_retries_shop_that_did_not_answer():
    stack, task = run_retry_scenario(policy(delay_s=0))  # 0 s so the test is instant
    assert task["state"] == "done"
    assert len(task["quotes"]) == 3
    assert sorted(job["attempt"] for job in stack.calls.jobs) == [1, 1, 1, 2]
    retried = [c for c in task["calls"] if c["attempts"] == 2]
    assert len(retried) == 1 and retried[0]["status"] == "ended"


def test_pipeline_does_not_retry_at_prayer_time():
    stack, task = run_retry_scenario(policy(BEFORE_MAGHRIB, delay_s=600))
    assert task["state"] == "done"
    assert len(task["quotes"]) == 2
    assert [job["attempt"] for job in stack.calls.jobs] == [1, 1, 1]
    failed = [e for e in stack.events.events if e["type"] == "call.failed"]
    assert len(failed) == 1 and failed[0]["data"]["reason"] == "no answer"
