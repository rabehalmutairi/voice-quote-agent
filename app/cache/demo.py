"""Demonstrate dated quote reuse with the existing simulated call flow."""

import asyncio
import sys
from datetime import timedelta, timezone

from app.cache.answers import AnswerCache
from app.mocks.demo import DEFAULT_AREA, DEFAULT_QUESTION, DEFAULT_REQUEST
from app.mocks.providers import mock_businesses
from app.mocks.scenarios import build_mock_stack

_RIYADH = timezone(timedelta(hours=3))
_CHANGED_QUESTION = "هل عندكم ضمان على الشاشة؟"


async def _demo() -> None:
    cache = AnswerCache()
    stack = build_mock_stack(speed=0)
    shop = mock_businesses()[0]
    print(f"Simulated shop: {shop['name']} ({DEFAULT_AREA})")

    for index, question in enumerate((DEFAULT_QUESTION, DEFAULT_QUESTION, _CHANGED_QUESTION), 1):
        plan = await stack.planner.plan(
            DEFAULT_REQUEST, area=DEFAULT_AREA, custom_questions=[question], max_businesses=1,
        )
        assert plan.status == "ready" and plan.task_spec is not None
        task = plan.task_spec
        task_id = task["task_id"]
        print(f"\nRun {index}: {question}")
        before = len(stack.calls.jobs)
        saved = cache.get(task, shop)
        if saved is not None:
            original = saved.recorded_at.astimezone(_RIYADH).date()
            answer = saved.quote["answers"][0]
            print(f"  Reused answer from {original}: {answer['summary_ar']}")
            print(f"  Original shop words: {answer['evidence'][0]['quote']}")
        else:
            await stack.orchestrator.submit(task)
            result = await stack.orchestrator.run(task_id)
            call = next(event["data"] for event in stack.events.for_task(task_id)
                        if event["type"] == "call.ended")
            if cache.remember(task, shop, call, result["quotes"][0]):
                print("  Called shop and saved its answer.")
            else:
                print("  Called shop. No reusable answer for the new question.")
        print(f"  New simulated calls: {len(stack.calls.jobs) - before}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    asyncio.run(_demo())
