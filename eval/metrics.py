"""Measure labelled call attempts using the definitions in architecture §8."""

from __future__ import annotations

import argparse
import json
import math
import re
from collections import Counter, defaultdict
from pathlib import Path

from app.contracts import CONTRACTS_DIR, get_template, validate

_HUMAN = {"human_completed", "human_partial"}
_FIELD_PATH = re.compile(r"(fields|offers\.(?:0|[1-9][0-9]*))\.([a-z][a-z0-9_]*)")


def _attempt_result(row: dict) -> dict:
    result = row.get("call_result")
    failure = row.get("call_failed")
    if (result is None) == (failure is None):
        raise ValueError("provide exactly one call_result or call_failed")
    if result is not None:
        validate("call_result", result)
        return result

    validate("event", failure)
    if failure["type"] != "call.failed":
        raise ValueError("call_failed must be a call.failed event")
    pre_arranged, scenario_id = row.get("pre_arranged"), row.get("scenario_id")
    if type(pre_arranged) is not bool or "scenario_id" not in row:
        raise ValueError("call_failed needs pre_arranged and scenario_id metadata")
    if scenario_id is not None and not isinstance(scenario_id, str):
        raise ValueError("scenario_id must be a string or null")
    return {
        **failure["data"], "task_id": failure["task_id"], "pre_arranged": pre_arranged,
        "scenario_id": scenario_id, "cost_usd": row.get("cost_usd"),
    }


def _field_values(quote: dict | None) -> dict:
    if quote is None:
        return {}
    groups = [("fields", quote["fields"])]
    groups.extend((f"offers.{i}", offer) for i, offer in enumerate(quote["offers"]))
    return {
        f"{scope}.{name}": field["value"] if field["value"] is not None else [
            field["value_min"], field["value_max"]
        ]
        for scope, fields in groups for name, field in fields.items() if field["status"] == "found"
    }


def _number(value: object) -> bool:
    return type(value) in (int, float) and math.isfinite(value) and value >= 0


def _value_fits(value: object, field: dict) -> bool:
    match field["type"]:
        case "number":
            return _number(value) or (
                isinstance(value, list) and len(value) == 2
                and all(_number(v) for v in value) and value[0] <= value[1]
            )
        case "choice":
            return value in field["choices"]
        case "boolean":
            return type(value) is bool
        case "text":
            return isinstance(value, str) and bool(value.strip())
    return False


def _same_value(actual: object, expected: object) -> bool:
    # True and 1 compare equal in Python. They represent different contract values.
    if type(actual) is bool or type(expected) is bool:
        return actual is expected
    return actual == expected


def _score_labels(labels: dict, quote: dict | None, template: dict, counts: Counter) -> Counter:
    values = _field_values(quote)
    accuracy = Counter()
    for path, expected in labels.get("expected_fields", {}).items():
        match = _FIELD_PATH.fullmatch(path)
        if match is None:
            raise ValueError(f"invalid expected field path: {path}")
        scope, name = match.groups()
        allowed = template["quote_fields"] if scope == "fields" else template["offer_fields"]
        if name not in allowed or name not in template["required_fields"]:
            raise ValueError(f"{path} is outside the template's required fields")
        if not _value_fits(expected, template["fields"][name]):
            raise ValueError(f"invalid labelled value for {path}")
        accuracy[name, "total"] += 1
        accuracy[name, "correct"] += _same_value(values.get(path), expected)

    unsupported = labels.get("unsupported_fields")
    if unsupported is not None:
        if (not isinstance(unsupported, list) or len(set(unsupported)) != len(unsupported)
                or not set(unsupported) <= values.keys()):
            raise ValueError("unsupported_fields must list unique returned field paths")
        counts["unsupported"] += len(unsupported)
        counts["returned"] += len(values)

    baseline = labels.get("baseline")
    if baseline is not None:
        bad, total = baseline["unsupported"], baseline["returned"]
        if type(bad) is not int or type(total) is not int or not 0 <= bad <= total:
            raise ValueError("baseline needs integer counts with 0 <= unsupported <= returned")
        if unsupported is None:
            raise ValueError("review unsupported_fields on the same call as the baseline")
        counts["paired_unsupported"] += len(unsupported)
        counts["paired_returned"] += len(values)
        counts["baseline_unsupported"] += bad
        counts["baseline_returned"] += total
        counts["paired_calls"] += 1

    faithfulness = labels.get("answer_faithful")
    if faithfulness is not None:
        summaries = {
            str(answer["question_index"]) for answer in (quote or {}).get("answers", [])
            if answer["summary_ar"] is not None
        }
        if faithfulness.keys() != summaries or any(type(v) is not bool for v in faithfulness.values()):
            raise ValueError("answer_faithful needs one boolean for each returned summary")
        counts["faithful"] += sum(faithfulness.values())
        counts["summaries"] += len(faithfulness)
    return accuracy


def measure(attempts: list[dict]) -> dict:
    """Aggregate a local bundle of attempt records. All inputs remain unchanged."""
    counts = Counter()
    reach = {"pre_arranged": [0, 0], "cold": [0, 0]}
    accuracy = Counter()
    failures = Counter()
    seen = {}
    task_times = {}
    usable_shops = defaultdict(set)

    for row in attempts:
        result = _attempt_result(row)
        if (result["scenario_id"] or "").startswith("mock_"):
            counts["mock_excluded"] += 1
            continue
        call_id, task_id, place_id = (result[k] for k in ("call_id", "task_id", "place_id"))
        attempt = row["attempt"]
        if type(attempt) is not int or attempt not in {1, 2}:
            raise ValueError("attempt must be 1 or 2")
        key = (task_id, call_id, attempt)
        if key in seen:
            raise ValueError(f"duplicate attempt: {key}")
        template = get_template(row["category"])

        human = result["outcome"] in _HUMAN
        seen[key] = (human, place_id, row["category"], result["pre_arranged"])
        group = reach["pre_arranged" if result["pre_arranged"] else "cold"]
        group[0] += human
        group[1] += 1
        counts["human"] += human
        counts["completed"] += result["outcome"] == "human_completed"
        if not human:
            failures[result["outcome"]] += 1

        cost = result["cost_usd"]
        if cost is None:
            counts["unknown_costs"] += 1
        elif _number(cost):
            counts["cost"] += cost
        else:
            raise ValueError("cost_usd must be a finite non-negative number or null")

        quote = row.get("quote")
        if quote is not None:
            validate("quote", quote)
            if (quote["task_id"], quote["call_id"], quote["place_id"]) != (task_id, call_id, place_id):
                raise ValueError(f"quote IDs must match the call for {key}")
            if not human:
                raise ValueError("only calls that reached a person may have a quote")

        labels = row.get("labels") or {}
        accuracy.update(_score_labels(labels, quote, template, counts))
        usable = labels.get("usable")
        if usable is not None and type(usable) is not bool:
            raise ValueError("usable must be a boolean or null")
        if usable:
            if quote is None:
                raise ValueError("a usable quote must exist")
            usable_shops[task_id].add(place_id)
        elif usable is None and quote is not None:
            counts["unreviewed_usability"] += 1

        observations = row.get("observations") or {}
        latency = observations.get("turn_latency_s", [])
        if not isinstance(latency, list) or not all(_number(x) for x in latency):
            raise ValueError("turn_latency_s must contain finite non-negative seconds")
        counts["latency_s"] += sum(latency)
        counts["latency_samples"] += len(latency)
        elapsed = observations.get("task_elapsed_s")
        if elapsed is not None:
            if not _number(elapsed) or task_times.setdefault(task_id, elapsed) != elapsed:
                raise ValueError(f"task_elapsed_s must be consistent and non-negative for {task_id}")
        switch = observations.get("language_switch_ok")
        if switch is not None:
            if type(switch) is not bool:
                raise ValueError("language_switch_ok must be a boolean or null")
            counts["switched"] += switch
            counts["switch_cases"] += 1

    for (task_id, call_id, attempt), (_, *identity) in seen.items():
        if attempt == 2 and seen.get((task_id, call_id, 1)) != (False, *identity):
            raise ValueError(f"retry needs a failed first attempt for the same call: {task_id}/{call_id}")

    per_field = {
        name: (accuracy[name, "correct"], accuracy[name, "total"])
        for name in sorted({name for name, _ in accuracy})
    }
    successes = sum(len(shops) >= 2 for shops in usable_shops.values())
    known_cost = not counts["unknown_costs"] and not counts["unreviewed_usability"]
    return {
        "mock_excluded": counts["mock_excluded"],
        "attempts": len(seen),
        "reach": {name: tuple(pair) for name, pair in reach.items()},
        "completion": (counts["completed"], counts["human"]),
        "accuracy": per_field,
        "critical_accuracy": (sum(p[0] for p in per_field.values()), sum(p[1] for p in per_field.values())),
        "hallucination": (counts["unsupported"], counts["returned"]),
        "paired_hallucination": (counts["paired_unsupported"], counts["paired_returned"]),
        "baseline_hallucination": (counts["baseline_unsupported"], counts["baseline_returned"]),
        "paired_calls": counts["paired_calls"],
        "faithfulness": (counts["faithful"], counts["summaries"]),
        "successful_tasks": successes,
        "unknown_costs": counts["unknown_costs"],
        "unreviewed_usability": counts["unreviewed_usability"],
        "cost_per_success": counts["cost"] / successes if known_cost and successes else None,
        "language_switch": (counts["switched"], counts["switch_cases"]),
        "turn_latency_s": (counts["latency_s"], counts["latency_samples"]),
        "task_elapsed_s": (sum(task_times.values()), len(task_times)),
        "failures": dict(sorted(failures.items())),
    }


def _rate(pair: tuple[int, int]) -> str:
    count, total = pair
    return f"{count / total:.1%} ({count}/{total})" if total else "N/A (0 samples)"


def _seconds(pair: tuple[float, int]) -> str:
    seconds, total = pair
    return f"{seconds / total:.2f} s (n={total})" if total else "N/A (0 samples)"


def format_report(report: dict) -> str:
    rows = [
        ("Human reach rate (pre-arranged)", _rate(report["reach"]["pre_arranged"])),
        ("Human reach rate (cold)", _rate(report["reach"]["cold"])),
        ("Task completion", _rate(report["completion"])),
        ("Critical-field accuracy", _rate(report["critical_accuracy"])),
    ]
    rows.extend((f"  {name}", _rate(pair)) for name, pair in report["accuracy"].items())
    cost = report["cost_per_success"]
    rows.extend([
        ("Hallucination rate (ours, all audited)", _rate(report["hallucination"])),
        ("Hallucination rate (ours, paired)", _rate(report["paired_hallucination"])),
        ("Hallucination rate (ElevenLabs, paired)", _rate(report["baseline_hallucination"])),
        ("Answer faithfulness", _rate(report["faithfulness"])),
        ("Cost per successful task", f"${cost:.2f}" if cost is not None else "N/A"),
        ("Mean turn latency", _seconds(report["turn_latency_s"])),
        ("Language-switch success", _rate(report["language_switch"])),
        ("Mean time per request", _seconds(report["task_elapsed_s"])),
        ("Failure types", ", ".join(f"{k}={v}" for k, v in report["failures"].items()) or "none observed"),
    ])
    header = (
        f"{report['attempts']} attempts, {report['mock_excluded']} mock attempts excluded, "
        f"{report['paired_calls']} paired baseline calls\n"
        f"{report['successful_tasks']} confirmed successful tasks, {report['unknown_costs']} unknown costs, "
        f"{report['unreviewed_usability']} quotes with unreviewed usability\n"
    )
    return header + "\n".join(f"{label:<44} {value}" for label, value in rows)


def _example() -> list[dict]:
    directory = CONTRACTS_DIR / "examples"
    result = json.loads((directory / "call_result.json").read_text(encoding="utf-8"))
    quote = json.loads((directory / "quote.json").read_text(encoding="utf-8"))
    labels = json.loads(Path(__file__).with_name("example_labels.json").read_text(encoding="utf-8"))
    return [{"category": "electronics_repair", "attempt": 1, "call_result": result,
             "quote": quote, "labels": labels}]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--input", type=Path, help="JSON array of labelled call attempts")
    source.add_argument("--example", action="store_true", help="exercise the report with synthetic examples")
    args = parser.parse_args(argv)
    try:
        rows = _example() if args.example else json.loads(args.input.read_text(encoding="utf-8"))
        if not isinstance(rows, list):
            raise ValueError("expected a JSON array of attempts")
        report = measure(rows)
    except (OSError, ValueError, TypeError, KeyError, AttributeError) as exc:
        parser.error(str(exc))
    if args.example:
        print("SYNTHETIC CONTRACT EXAMPLE / demonstration only")
    print(format_report(report))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
