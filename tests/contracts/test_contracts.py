"""Contract tests.

1. Every schema is valid JSON Schema.
2. Every example (and template) matches its schema.
3. The examples tell one consistent story: same IDs everywhere, and every
   evidence quote really appears in a shop turn of the example transcript.
4. A Quote agrees with its category template (types, choices, required fields),
   and a stock-check and a car-repair Quote fit the same engine unchanged.
5. Broken data is rejected, so we know the rules are actually enforced.

Run: python -m pytest tests/contracts
"""

import copy
import json
import re
from pathlib import Path

import pytest
import yaml
from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource

ROOT = Path(__file__).resolve().parents[2]
CONTRACTS = ROOT / "contracts"
EXAMPLES = CONTRACTS / "examples"
TEMPLATES = ROOT / "templates"


def load_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def load_template(path):
    return yaml.safe_load(path.read_text(encoding="utf-8"))


SCHEMAS = {
    path.name.removesuffix(".schema.json"): load_json(path)
    for path in sorted(CONTRACTS.glob("*.schema.json"))
}
# Lets "$ref": "common.schema.json#/..." resolve without any network access.
REGISTRY = Registry().with_resources(
    (schema["$id"], Resource.from_contents(schema)) for schema in SCHEMAS.values()
)
TEMPLATE_FILES = sorted(TEMPLATES.glob("*.yaml"))
TEMPLATE_BY_NAME = {path.stem: load_template(path) for path in TEMPLATE_FILES}
# Contracts with a single example file at examples/<name>.json.
SINGLE_EXAMPLE = sorted(set(SCHEMAS) - {"common", "event", "template"})
EVENT_FILES = sorted((EXAMPLES / "events").glob("*.json"))


def errors(contract, instance):
    # FormatChecker makes "format": "date-time" an actual check; without it
    # jsonschema treats formats as comments.
    validator = Draft202012Validator(
        SCHEMAS[contract], registry=REGISTRY, format_checker=FormatChecker()
    )
    return [f"{list(e.absolute_path)}: {e.message}" for e in validator.iter_errors(instance)]


def example(name):
    return load_json(EXAMPLES / f"{name}.json")


# 1. Schemas -----------------------------------------------------------------


@pytest.mark.parametrize("contract", sorted(SCHEMAS))
def test_schema_is_valid_json_schema(contract):
    Draft202012Validator.check_schema(SCHEMAS[contract])


# 2. Examples match their schemas --------------------------------------------


@pytest.mark.parametrize("contract", SINGLE_EXAMPLE)
def test_example_matches_schema(contract):
    assert errors(contract, example(contract)) == []


@pytest.mark.parametrize("path", EVENT_FILES, ids=lambda p: p.stem)
def test_event_example_matches_schema(path):
    assert errors("event", load_json(path)) == []


def test_every_event_type_has_an_example():
    event_types = SCHEMAS["event"]["properties"]["type"]["enum"]
    assert sorted(p.stem for p in EVENT_FILES) == sorted(event_types)


@pytest.mark.parametrize("path", TEMPLATE_FILES, ids=lambda p: p.stem)
def test_template_matches_schema(path):
    assert errors("template", load_template(path)) == []


@pytest.mark.parametrize("path", TEMPLATE_FILES, ids=lambda p: p.stem)
def test_template_cross_references(path):
    # JSON Schema can't say "every key used here is defined there".
    template = load_template(path)
    assert template["category"] == path.stem

    defined = set(template["fields"])
    offer, quote = set(template["offer_fields"]), set(template["quote_fields"])
    assert offer | quote == defined and not offer & quote, "each field is per-offer or per-call"

    asked = {q["field"] for q in template["call_questions"]}
    assert asked <= defined
    assert set(template["required_fields"]) <= asked
    assert set(template["compare_on"]) <= offer & asked

    planner_keys = {q["key"] for q in template["planner_questions"]}
    placeholders = {
        name for q in template["call_questions"] for name in re.findall(r"\{\{(\w+)\}\}", q["ask_ar"])
    }
    assert placeholders <= planner_keys - {"area"}, "a {{slot}} must come from a planner question"


# 3. Examples agree with each other ------------------------------------------


def test_examples_share_ids():
    task, business, job = example("task_spec"), example("business"), example("call_job")
    result, quote, comparison = example("call_result"), example("quote"), example("comparison")

    for item in (job, result, quote, comparison):
        assert item["task_id"] == task["task_id"]
    for item in (job, result, quote):
        assert item["call_id"] == job["call_id"]
        assert item["place_id"] == business["place_id"]
    assert job["to_number"] == business["phone_e164"]
    assert job["template"] == task["category"]
    assert job["dynamic_variables"] == task["slots"]
    assert job["custom_questions"] == task["custom_questions"]
    assert business["place_id"] in {r["place_id"] for r in comparison["ranking"]}


def test_transcript_turns_are_numbered_in_order():
    transcript = example("call_result")["transcript"]
    assert [turn["i"] for turn in transcript] == list(range(len(transcript)))
    times = [turn["t"] for turn in transcript]
    assert times == sorted(times)


def evidence(quote):
    """Yield (where, quote text, turn index) for every claim in a Quote."""
    for index, offer in enumerate(quote["offers"]):
        for name, field in offer.items():
            yield f"offers[{index}].{name}", field["evidence_quote"], field["evidence_turn"]
    for name, field in quote["fields"].items():
        yield f"fields.{name}", field["evidence_quote"], field["evidence_turn"]
    for index, answer in enumerate(quote["answers"]):
        for item in answer["evidence"]:
            yield f"answers[{index}]", item["quote"], item["turn"]


def test_quote_evidence_comes_from_shop_turns():
    # The runtime rule from contracts/README.md, applied to the examples.
    # R6's checker adds Arabic normalization; plain substring is enough here.
    turns = {turn["i"]: turn for turn in example("call_result")["transcript"]}
    checked = 0
    for where, text, turn_index in evidence(example("quote")):
        if text is None:
            continue
        turn = turns[turn_index]
        assert turn["speaker"] == "shop", where
        assert text in turn["text"], where
        checked += 1
    assert checked > 0


def test_answers_follow_the_users_questions():
    task, quote = example("task_spec"), example("quote")
    assert [a["question"] for a in quote["answers"]] == task["custom_questions"]
    assert [a["question_index"] for a in quote["answers"]] == list(range(len(quote["answers"])))


@pytest.mark.parametrize(
    "event_type, contract",
    [
        ("business.found", "business"),
        ("call.ended", "call_result"),
        ("quote.ready", "quote"),
        ("comparison.ready", "comparison"),
    ],
)
def test_event_data_matches_example(event_type, contract):
    assert load_json(EXAMPLES / "events" / f"{event_type}.json")["data"] == example(contract)


# 4. A Quote agrees with its template ----------------------------------------


def template_problems(quote, template):
    """What the schema can't see: does this Quote fit its category template?

    This is a small stand-in for part of R6's checker, so the rule is written
    down and tested here. Returns a list of problems; empty means it fits.
    """
    problems = []
    fields = template["fields"]

    def check(where, key, field):
        definition = fields.get(key)
        if definition is None:
            problems.append(f"{where}: unknown field {key!r}")
            return
        if field["status"] != "found":
            return
        kind, value = definition["type"], field["value"]
        if field["value_min"] is not None:
            if kind != "number":
                problems.append(f"{where}: only a number can be a range")
            elif field["value_min"] > field["value_max"]:
                problems.append(f"{where}: value_min is above value_max")
        elif kind == "number" and (isinstance(value, bool) or not isinstance(value, (int, float))):
            problems.append(f"{where}: expected a number, got {value!r}")
        elif kind == "choice" and value not in definition["choices"]:
            problems.append(f"{where}: {value!r} is not one of {definition['choices']}")
        elif kind == "text" and not isinstance(value, str):
            problems.append(f"{where}: expected text, got {value!r}")
        elif kind == "boolean" and not isinstance(value, bool):
            problems.append(f"{where}: expected true/false, got {value!r}")

    seen = set()
    for index, offer in enumerate(quote["offers"]):
        for key, field in offer.items():
            seen.add(key)
            if key not in template["offer_fields"]:
                problems.append(f"offers[{index}]: {key!r} is not an offer field")
            check(f"offers[{index}].{key}", key, field)
    for key, field in quote["fields"].items():
        seen.add(key)
        if key not in template["quote_fields"]:
            problems.append(f"fields: {key!r} is not a call-level field")
        check(f"fields.{key}", key, field)
    for key in template["required_fields"]:
        if key not in seen:
            problems.append(f"required field {key!r} is missing")
    return problems


def found(value, quote, turn, confidence=0.9):
    return {
        "value": value, "value_min": None, "value_max": None, "status": "found",
        "confidence": confidence, "evidence_quote": quote, "evidence_turn": turn,
    }


def found_range(low, high, quote, turn, confidence=0.85):
    return found(None, quote, turn, confidence) | {"value_min": low, "value_max": high}


def not_mentioned():
    return {
        "value": None, "value_min": None, "value_max": None, "status": "not_mentioned",
        "confidence": None, "evidence_quote": None, "evidence_turn": None,
    }


def quote_for(offers, fields):
    return {
        "call_id": "call_01", "task_id": "tsk_01", "place_id": "ChIJexample01",
        "offers": offers, "fields": fields, "answers": [], "evidence_issues": [],
    }


def test_example_quote_fits_its_template():
    template = TEMPLATE_BY_NAME[example("task_spec")["category"]]
    assert template_problems(example("quote"), template) == []


def test_stock_check_quote_fits_the_same_engine():
    quote = quote_for(
        offers=[{
            "variant": found("أسود ٢٥٦", "الأسود ٢٥٦ موجود", 1),
            "condition": found("new", "جديد", 3),
            "price_sar": found(4200, "أربعة آلاف ومتين", 3),
            "availability": found("in_stock", "موجود", 1),
        }],
        fields={"warranty_days": found(365, "ضمان سنة", 5)},
    )
    assert errors("quote", quote) == []
    assert template_problems(quote, TEMPLATE_BY_NAME["stock_check"]) == []


def test_car_repair_quote_fits_the_same_engine():
    quote = quote_for(
        offers=[{
            "part_brand": found("aftermarket", "تجاري", 3),
            "price_sar": found(600, "ستمية", 3),
            "labor_included": found(True, "شامل التركيب", 5),
            "warranty_days": not_mentioned(),
        }],
        fields={"turnaround_minutes": found_range(30, 60, "من نص ساعة لساعة", 7)},
    )
    assert errors("quote", quote) == []
    assert template_problems(quote, TEMPLATE_BY_NAME["car_repair"]) == []


def test_side_by_side_comparison_is_valid():
    comparison = {
        "task_id": "tsk_01", "status": "side_by_side", "basis": None,
        "ranking": [], "excluded": [], "cannot_compare_reasons": [],
    }
    assert errors("comparison", comparison) == []


def mutate_quote(path, value):
    quote = copy.deepcopy(example("quote"))
    *parents, last = path
    target = quote
    for key in parents:
        target = target[key]
    target[last] = value
    return quote


@pytest.mark.parametrize(
    "why, path, value",
    [
        ("choice value not in the template's list", ["offers", 0, "part_type", "value"], "copy"),
        ("number given as text", ["offers", 1, "price_sar", "value"], "450"),
        ("yes/no given for a number", ["offers", 1, "price_sar", "value"], True),
        ("field the template doesn't define", ["offers", 0, "colour"], found("red", "أحمر", 3)),
        ("per-call field placed in an offer", ["offers", 0, "availability"], found("in_stock", "موجودة", 11)),
        ("range upside down", ["fields", "turnaround_minutes", "value_max"], 30),
    ],
    ids=lambda case: case if isinstance(case, str) else "",
)
def test_quote_that_breaks_the_template_is_caught(why, path, value):
    quote = mutate_quote(path, value)
    # These are valid shapes, so the schema alone accepts them: only the
    # template check can catch them. That is why the check exists.
    assert template_problems(quote, TEMPLATE_BY_NAME["electronics_repair"]), why


def test_missing_required_field_is_caught():
    quote = copy.deepcopy(example("quote"))
    del quote["fields"]["turnaround_minutes"]
    assert any("turnaround_minutes" in p for p in template_problems(quote, TEMPLATE_BY_NAME["electronics_repair"]))


# 5. Broken data is rejected -------------------------------------------------

DELETE = object()
TOO_MANY_QUESTIONS = ["أول سؤال", "ثاني سؤال", "ثالث سؤال"]

INVALID = [
    # (example to break, what is wrong, path to change, new value)
    ("quote", "found value without evidence", ["offers", 1, "price_sar", "evidence_quote"], None),
    ("quote", "value kept when not mentioned", ["offers", 1, "warranty_days", "status"], "not_mentioned"),
    ("quote", "exact value and range together", ["fields", "turnaround_minutes", "value"], 90),
    ("quote", "range missing one bound", ["fields", "turnaround_minutes", "value_max"], None),
    ("quote", "extra key inside a field", ["offers", 1, "price_sar", "evidence_qoute"], "x"),
    ("quote", "field name not snake_case", ["offers", 1, "Price SAR"], found(450, "x", 3)),
    ("quote", "missing key instead of null", ["fields", "availability", "confidence"], DELETE),
    ("quote", "empty offer", ["offers", 0], {}),
    ("quote", "custom answer without evidence", ["answers", 0, "evidence"], []),
    ("quote", "custom answer without summary", ["answers", 0, "summary_ar"], None),
    ("quote", "unanswered question keeps a summary", ["answers", 0, "status"], "not_mentioned"),
    ("task_spec", "ready to call but no area", ["area"], None),
    ("task_spec", "category not snake_case", ["category"], "Electronics Repair"),
    ("task_spec", "three custom questions", ["custom_questions"], TOO_MANY_QUESTIONS),
    ("business", "phone not E.164", ["phone_e164"], "0501234567"),
    ("call_job", "second retry", ["attempt"], 3),
    ("call_job", "call over 150 s", ["max_duration_s"], 300),
    ("call_job", "three custom questions in a call", ["custom_questions"], TOO_MANY_QUESTIONS),
    ("call_result", "impossible date", ["started_at"], "2026-13-45T18:01:30Z"),
    ("call_result", "timestamp not UTC", ["started_at"], "2026-10-25T21:01:30+03:00"),
    ("call_result", "ElevenLabs speaker name", ["transcript", 1, "speaker"], "user"),
    ("comparison", "cannot_compare with a ranking", ["status"], "cannot_compare"),
    ("comparison", "side_by_side with a ranking", ["status"], "side_by_side"),
    ("comparison", "partial with nothing excluded", ["excluded"], []),
    ("events/call.ended", "call.ended without a human", ["data", "outcome"], "no_answer"),
    ("events/quote.ready", "data does not match type", ["type"], "call.started"),
    ("events/call.started", "seq starts at 0", ["seq"], 0),
]


@pytest.mark.parametrize("name, why, path, value", INVALID, ids=[case[1] for case in INVALID])
def test_invalid_data_is_rejected(name, why, path, value):
    data = copy.deepcopy(load_json(EXAMPLES / f"{name}.json"))
    *parents, last = path
    target = data
    for key in parents:
        target = target[key]
    if value is DELETE:
        del target[last]
    else:
        target[last] = value

    contract = "event" if name.startswith("events/") else name
    assert errors(contract, data), f"schema accepted: {why}"
