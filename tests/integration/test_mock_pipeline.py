"""End to end on mocks: request -> TaskSpec -> 3 businesses -> 3 calls -> quotes -> comparison -> events.

Runs the same function as `python -m app.mocks.demo`, so the demo can't silently break.
"""

import io

import pytest
from conftest import CUSTOM_QUESTION, assert_causal_order, assert_valid_event_stream, run

from app.contracts import contract_errors
from app.mocks.demo import main, run_demo

CONTRACT_OF = {
    "task.created": "task_spec",
    "business.found": "business",
    "call.ended": "call_result",
    "quote.ready": "quote",
    "comparison.ready": "comparison",
}


def test_electronics_request_runs_end_to_end():
    result = run(run_demo(speed=0))
    plan, task, events = result["plan"], result["task"], result["events"]

    assert plan["status"] == "needs_input" and plan["questions"][0]["key"] == "area"
    assert task["state"] == "done"
    assert task["state_history"] == ["created", "needs_input", "created", "discovering", "calling", "extracting", "done"]
    assert_valid_event_stream(events, task["task_id"])
    assert_causal_order(events)

    kinds = [e["type"] for e in events]
    assert kinds[:2] == ["task.created", "task.needs_input"]
    assert kinds.count("business.found") == 3
    assert kinds.count("call.started") == 3
    assert kinds.count("call.ended") == 3
    assert kinds.count("quote.ready") == 3
    assert kinds[-1] == "comparison.ready"
    for event in events:  # every payload is the contract object it claims to be
        if event["type"] in CONTRACT_OF:
            assert contract_errors(CONTRACT_OF[event["type"]], event["data"]) == []

    # The quotes come back for the exact task, calls and shops the orchestrator created.
    call_ids = {e["data"]["call_id"] for e in events if e["type"] == "call.started"}
    assert {q["call_id"] for q in task["quotes"]} == call_ids
    assert all(q["task_id"] == task["task_id"] for q in task["quotes"])
    # The user's own question is answered by the shops whose scripts covered it.
    statuses = [q["answers"][0]["status"] for q in task["quotes"]]
    assert all(q["answers"][0]["question"] == CUSTOM_QUESTION for q in task["quotes"])
    assert statuses == ["found", "found", "not_mentioned"]
    ranking = task["comparison"]["ranking"]
    assert [r["rank"] for r in ranking] == [1, 2, 3]


def test_stock_check_runs_on_the_same_engine():
    result = run(run_demo(request_text="عندكم آيفون 16 متوفر؟ أنا في العليا", custom_questions=[], speed=0))
    task = result["task"]
    assert result["plan"]["status"] == "ready"
    assert task["task_spec"]["category"] == "stock_check"
    assert task["state"] == "done"
    assert len(task["quotes"]) == 3
    assert task["comparison"]["status"] == "partial"  # the partial call gave no price
    assert_valid_event_stream(result["events"], task["task_id"])


@pytest.mark.parametrize(
    "scenario, state, comparison",
    [
        ("default", "done", "ranked"),
        ("one_failed", "done", "partial"),
        ("timeout", "done", "partial"),
        ("provider_error", "done", "partial"),
        ("retry", "done", "ranked"),
        ("all_failed", "failed", None),
        ("no_shops", "failed", None),
    ],
)
def test_every_scenario_ends_cleanly(scenario, state, comparison):
    task = run(run_demo(scenario, speed=0))["task"]
    assert task["state"] == state
    assert (task["comparison"] or {}).get("status") == comparison


def test_out_of_scope_request_never_reaches_the_orchestrator():
    result = run(run_demo(request_text="احجز لي موعد تصليح شاشة", speed=0))
    assert result["plan"]["status"] == "rejected"
    assert result["task"] is None and result["events"] == []


def test_demo_command_prints_a_summary():
    out = io.StringIO()
    run(run_demo("one_failed", speed=0, out=out))
    text = out.getvalue()
    assert "MOCK MODE" in text
    assert "comparison: partial" in text
    assert "gaps: none" in text and "invalid against event.schema.json: 0" in text


def test_demo_cli_exit_code(capsys):
    assert main(["--scenario", "all_failed", "--speed", "0"]) == 0
    assert "task.failed" in capsys.readouterr().out


@pytest.mark.parametrize("scenario", ["default", "one_failed", "all_failed", "no_shops"])
def test_json_mode_stdout_is_pure_json_lines(scenario):
    # Run the real command, as R7 would, and parse stdout line by line.
    import json
    import os
    import subprocess
    import sys
    from pathlib import Path

    root = Path(__file__).resolve().parents[2]
    env = {**os.environ, "PYTHONIOENCODING": "utf-8"}
    proc = subprocess.run(
        [sys.executable, "-m", "app.mocks.demo", "--json", "--speed", "0", "--scenario", scenario],
        cwd=root, capture_output=True, encoding="utf-8", env=env, timeout=60,
    )
    assert proc.returncode == 0, proc.stderr
    lines = proc.stdout.splitlines()
    assert lines, "no events on stdout"
    events = [json.loads(line) for line in lines]  # fails on any non-JSON line
    for event in events:
        assert contract_errors("event", event) == []
    assert [e["seq"] for e in events] == list(range(1, len(events) + 1))
    assert "MOCK MODE" in proc.stderr  # the human-readable text still exists, on stderr
