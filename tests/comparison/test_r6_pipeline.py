"""R6's Extractor and Comparator plugged into R1's real orchestrator on mocks (integration.md §9).

The LLM is a fake that answers from the mock scripts, so this checks the wiring, the
evidence checker on every mock call, and the like-for-like comparison end to end.
"""

import copy

import pytest
from conftest import COMPLETE_REQUEST, CUSTOM_QUESTION, assert_causal_order, assert_valid_event_stream, run

from app.comparison import R6Comparator
from app.contracts import contract_errors
from app.extraction import R6Extractor
from app.mocks import build_mock_stack, mock_script
from app.orchestrator import Orchestrator

SHOPS = ("ChIJexample01", "ChIJexample02", "ChIJexample03")


class ScriptedLLM:
    """Answers like an honest model would: the mock script's values for whichever call it is shown.
    `tamper` can change the reply first, to play a hallucinating model."""

    def __init__(self, category, tamper=None):
        self.category = category
        self.tamper = tamper

    async def complete_json(self, *, system, user):
        for place_id in SHOPS:
            script = mock_script(self.category, place_id)
            if all(f"[{t['i']}] {t['speaker']}: {t['text']}" in user for t in script["transcript"]):
                answers = [{"question_index": i, **a} for i, a in enumerate(script["answers"])]
                reply = {"offers": script["offers"], "fields": script["fields"], "answers": answers}
                if self.tamper:
                    reply = self.tamper(place_id, copy.deepcopy(reply))
                return reply
        raise AssertionError("transcript not from a mock script")


def r6_stack(scenario="default", category="electronics_repair", tamper=None):
    stack = build_mock_stack(scenario, speed=0)
    stack.orchestrator = Orchestrator(
        planner=stack.planner, discovery=stack.discovery, calls=stack.calls,
        extractor=R6Extractor(ScriptedLLM(category, tamper)), comparator=R6Comparator(),
        events=stack.events, config=stack.orchestrator.config,
    )
    return stack


async def run_task(stack, request=COMPLETE_REQUEST, custom_questions=(CUSTOM_QUESTION,)):
    plan = await stack.planner.plan(request, custom_questions=list(custom_questions))
    assert plan.status == "ready", plan
    await stack.orchestrator.submit(plan.task_spec)
    return await stack.orchestrator.run(plan.task_spec["task_id"])


def test_electronics_task_runs_with_r6_components():
    stack = r6_stack()
    task = run(run_task(stack))
    events = stack.events.for_task(task["task_id"])

    assert task["state"] == "done"
    assert_valid_event_stream(events, task["task_id"])
    assert_causal_order(events)
    assert len(task["quotes"]) == 3
    for quote in task["quotes"]:
        assert contract_errors("quote", quote) == []
        assert quote["evidence_issues"] == []  # every mock value is honestly backed
    assert [a["status"] for q in task["quotes"] for a in q["answers"]] == ["found", "found", "not_mentioned"]

    comparison = task["comparison"]
    assert comparison["status"] == "ranked"
    assert comparison["basis"].startswith("commercial part")
    assert [r["place_id"] for r in comparison["ranking"]] == list(SHOPS)


def test_stock_check_task_runs_with_r6_components():
    stack = r6_stack(category="stock_check")
    task = run(run_task(stack, request="عندكم آيفون 16 متوفر؟ أنا في العليا", custom_questions=()))
    assert task["state"] == "done"
    comparison = task["comparison"]
    assert comparison["status"] == "partial"
    assert [r["place_id"] for r in comparison["ranking"]] == ["ChIJexample02", "ChIJexample01"]
    assert comparison["excluded"] == [{"place_id": "ChIJexample03", "reason": "no verified price"}]


def test_one_failed_call_is_excluded_and_the_others_ranked():
    stack = r6_stack("one_failed")
    task = run(run_task(stack))
    comparison = task["comparison"]
    assert comparison["status"] == "partial"
    assert [r["place_id"] for r in comparison["ranking"]] == ["ChIJexample01", "ChIJexample03"]
    assert comparison["excluded"][0]["place_id"] == "ChIJexample02"


def test_hallucinated_price_is_dropped_before_comparison():
    def tamper(place_id, reply):
        if place_id == "ChIJexample01":
            reply["offers"][1]["price_sar"]["value"] = 300  # shop said 450: would have "won"
        return reply

    stack = r6_stack(tamper=tamper)
    task = run(run_task(stack))
    shop1 = next(q for q in task["quotes"] if q["place_id"] == "ChIJexample01")
    assert shop1["evidence_issues"] == [{"field": "price_sar", "option_index": 1, "reason": "number_not_in_quote"}]
    ranking = task["comparison"]["ranking"]
    assert [r["place_id"] for r in ranking] == ["ChIJexample02", "ChIJexample03"]
    assert "300" not in str(task["comparison"])


@pytest.mark.parametrize("scenario", ["all_failed", "no_shops"])
def test_failing_scenarios_still_fail_cleanly(scenario):
    stack = r6_stack(scenario)
    task = run(run_task(stack))
    assert task["state"] == "failed"
