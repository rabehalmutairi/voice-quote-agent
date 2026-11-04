"""End-to-end mock demo: request -> TaskSpec -> 3 shops -> 3 concurrent calls -> quotes -> comparison.

Runs the real planner and orchestrator code. Only the providers are mocks (no network,
no real numbers, no cost).

    python -m app.mocks.demo
    python -m app.mocks.demo --scenario one_failed
    python -m app.mocks.demo --request "عندكم آيفون 16 في العليا؟"
    python -m app.mocks.demo --scenario all_failed --json > events.jsonl   # events only, JSON Lines

Scenarios: see app/mocks/scenarios.py.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time

from app.contracts import contract_errors
from app.mocks.providers import InMemoryEventSink
from app.mocks.scenarios import SCENARIOS, build_mock_stack

DEFAULT_REQUEST = "أبي أغير شاشة آيفون 15 برو، وأبي أعرف إذا يصلحونه قدامي"
DEFAULT_QUESTION = "يصلحونه قدامي ولا أتركه عندهم؟"
DEFAULT_AREA = "حي الملقا"


def _describe(event: dict, names: dict[str, str]) -> str:
    data = event["data"]
    kind = event["type"]
    if kind == "task.created":
        return f"{data['category']} slots={data['slots']} missing={data['missing_slots']}"
    if kind == "task.needs_input":
        return "asks: " + " | ".join(f"{q['key']}: {q['ask_ar']}" for q in data["questions"])
    if kind == "business.found":
        names[data["place_id"]] = data["name"]
        return f"{data['name']} ({data['phone_e164']})"
    if kind == "call.started":
        return f"{data['call_id']} -> {names.get(data['place_id'], data['place_id'])}"
    if kind == "call.ended":
        return f"{data['call_id']} {data['outcome']}, {len(data['transcript'])} turns"
    if kind == "call.failed":
        return f"{data['call_id']} {data['outcome']}: {data['reason']}"
    if kind == "quote.ready":
        prices = [o["price_sar"]["value"] for o in data["offers"] if o.get("price_sar", {}).get("status") == "found"]
        return f"{names.get(data['place_id'], data['place_id'])}: {len(data['offers'])} offer(s), prices {prices}"
    if kind == "comparison.ready":
        return f"{data['status']}: " + ", ".join(f"#{r['rank']} {names.get(r['place_id'], r['place_id'])}" for r in data["ranking"])
    if kind == "task.failed":
        return data["reason"]
    return ""


async def run_demo(
    scenario: str = "default",
    request_text: str = DEFAULT_REQUEST,
    custom_questions: list[str] | None = None,
    area_answer: str = DEFAULT_AREA,
    *,
    speed: float = 1.0,
    out=None,
    err=None,
    as_json: bool = False,
) -> dict:
    """Run one full mock task and return the plan, final task and events.

    Text output goes to `out` (None = silent). With `as_json`, `out` gets ONLY the events,
    one JSON object per line (JSON Lines), and every human-readable line goes to `err`.
    """
    text_out = err if as_json else out
    say = (lambda *a: print(*a, file=text_out)) if text_out else (lambda *a: None)
    custom_questions = [DEFAULT_QUESTION] if custom_questions is None else custom_questions
    clock = {"start": time.monotonic()}
    names: dict[str, str] = {}

    def show(event: dict) -> None:
        if as_json:
            if out:
                print(json.dumps(event, ensure_ascii=False), file=out, flush=True)
        else:
            elapsed = time.monotonic() - clock["start"]
            say(f"  +{elapsed:5.2f}s  #{event['seq']:<3}{event['type']:<17}{_describe(event, names)}")

    stack = build_mock_stack(scenario, speed=speed, events=InMemoryEventSink(on_event=show))
    say("MOCK MODE: no network, no real phone numbers, no cost.\n")

    say("1. Planner")
    say(f"  request: {request_text}")
    say(f"  custom questions: {custom_questions}")
    plan = await stack.planner.plan(request_text, custom_questions=custom_questions)
    say(f"  -> {plan.status}" + (f" ({plan.error.code}: {plan.error.message})" if plan.error else ""))
    if not plan.accepted:
        return {"plan": plan.to_dict(), "task": None, "events": stack.events.events}

    say("\n2. Orchestrator: submit, answer follow-up questions, run")
    clock["start"] = time.monotonic()
    task_id = plan.task_spec["task_id"]
    await stack.orchestrator.submit(plan.task_spec)
    if plan.status == "needs_input":
        answers = {q["key"]: area_answer for q in plan.questions if q["key"] == "area"}
        unanswerable = [q["key"] for q in plan.questions if q["key"] != "area"]
        if unanswerable:
            say(f"  the demo only answers the area question; still missing: {unanswerable}")
            return {"plan": plan.to_dict(), "task": stack.orchestrator.get(task_id), "events": stack.events.events}
        answered = await stack.orchestrator.answer(task_id, answers)
        say(f"  answered {answers} -> {answered.status}")
        if answered.status != "ready":
            return {"plan": plan.to_dict(), "task": stack.orchestrator.get(task_id), "events": stack.events.events}

    say(f"  running scenario '{scenario}' (times are from the start of the run) ...")
    clock["start"] = time.monotonic()
    task = await stack.orchestrator.run(task_id)

    say("\n3. Result")
    say(f"  state: {task['state']}   ({' -> '.join(task['state_history'])})")
    if task["failure_reason"]:
        say(f"  failure: {task['failure_reason']}")
    if task["comparison"]:
        comparison = task["comparison"]
        say(f"  comparison: {comparison['status']}, basis: {comparison['basis']}")
        for row in comparison["ranking"]:
            say(f"    #{row['rank']} {names.get(row['place_id'])}: {row['reason']}")
        for row in comparison["excluded"]:
            say(f"    excluded {names.get(row['place_id'])}: {row['reason']}")
    for quote in task["quotes"]:
        for answer in quote["answers"]:
            say(f"  {names.get(quote['place_id'])} on \"{answer['question']}\": {answer['status']} {answer['summary_ar'] or ''}")
    events = stack.events.for_task(task_id)
    seqs = [e["seq"] for e in events]
    invalid = sum(1 for e in events if contract_errors("event", e))
    say(f"  events: {len(events)}, seq {seqs[0]}..{seqs[-1]}, gaps: {'none' if seqs == list(range(1, len(seqs) + 1)) else 'YES'}, "
        f"invalid against event.schema.json: {invalid}")
    say(f"  max calls in flight at once: {stack.calls.max_in_flight}")
    return {"plan": plan.to_dict(), "task": task, "events": events}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--scenario", default="default", choices=sorted(SCENARIOS))
    parser.add_argument("--request", default=DEFAULT_REQUEST, help="the user's request text")
    parser.add_argument("--question", action="append", help="a custom question (repeat up to 2 times)")
    parser.add_argument("--no-question", action="store_true", help="no custom questions")
    parser.add_argument("--area", default=DEFAULT_AREA, help="answer to the area question if asked")
    parser.add_argument("--speed", type=float, default=1.0, help="scale fake call durations (0 = instant)")
    parser.add_argument("--json", action="store_true",
                        help="stdout: events only, one JSON object per line; everything else goes to stderr")
    args = parser.parse_args(argv)

    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")  # Arabic on the Windows console
    questions = [] if args.no_question else args.question
    result = asyncio.run(
        run_demo(
            args.scenario, args.request, questions, args.area,
            speed=args.speed, out=sys.stdout, err=sys.stderr, as_json=args.json,
        )
    )
    task = result["task"]
    return 0 if task is not None and task["state"] in ("done", "failed") else 1


if __name__ == "__main__":
    sys.exit(main())
