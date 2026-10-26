"""Contract tests.

1. Every schema is valid JSON Schema.
2. Every example (and template) matches its schema.
3. The examples tell one consistent story: same IDs everywhere, and every
   evidence quote really appears in a shop turn of the example transcript.
4. Broken data is rejected, so we know the rules are actually enforced.

Run: python -m pytest tests/contracts
"""

import copy
import json
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


SCHEMAS = {
    path.name.removesuffix(".schema.json"): load_json(path)
    for path in sorted(CONTRACTS.glob("*.schema.json"))
}
# Lets "$ref": "common.schema.json#/..." resolve without any network access.
REGISTRY = Registry().with_resources(
    (schema["$id"], Resource.from_contents(schema)) for schema in SCHEMAS.values()
)
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


@pytest.mark.parametrize("path", sorted(TEMPLATES.glob("*.yaml")), ids=lambda p: p.stem)
def test_template_matches_schema(path):
    template = yaml.safe_load(path.read_text(encoding="utf-8"))
    assert errors("template", template) == []
    assert template["category"] == path.stem
    asked = {q["field"] for q in template["call_questions"]}
    assert set(template["required_fields"]) <= asked
    assert set(template["compare_on"]) <= asked


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
    assert business["place_id"] in {r["place_id"] for r in comparison["ranking"]}


def test_transcript_turns_are_numbered_in_order():
    transcript = example("call_result")["transcript"]
    assert [turn["i"] for turn in transcript] == list(range(len(transcript)))
    times = [turn["t"] for turn in transcript]
    assert times == sorted(times)


def evidence_fields(quote):
    for index, option in enumerate(quote["options"]):
        for field, value in option.items():
            yield f"options[{index}].{field}", value
    yield "turnaround_minutes", quote["turnaround_minutes"]
    yield "availability", quote["availability"]


def test_quote_evidence_comes_from_shop_turns():
    # The runtime rule from contracts/README.md, applied to the examples.
    # R6's checker adds Arabic normalization; plain substring is enough here.
    turns = {turn["i"]: turn for turn in example("call_result")["transcript"]}
    for where, field in evidence_fields(example("quote")):
        if field["evidence_quote"] is None:
            continue
        turn = turns[field["evidence_turn"]]
        assert turn["speaker"] == "shop", where
        assert field["evidence_quote"] in turn["text"], where


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


# 4. Broken data is rejected -------------------------------------------------

DELETE = object()

INVALID = [
    # (example to break, what is wrong, path to change, new value)
    ("quote", "found value without evidence", ["options", 1, "price_sar", "evidence_quote"], None),
    ("quote", "value kept when not mentioned", ["options", 1, "warranty_days", "status"], "not_mentioned"),
    ("quote", "exact value and range together", ["turnaround_minutes", "value"], 90),
    ("quote", "range missing one bound", ["turnaround_minutes", "value_max"], None),
    ("quote", "misspelled field", ["options", 1, "price_sr"], 450),
    ("quote", "part type outside the list", ["options", 0, "part_type", "value"], "copy"),
    ("quote", "fractional warranty days", ["options", 1, "warranty_days", "value"], 30.5),
    ("quote", "missing key instead of null", ["availability", "confidence"], DELETE),
    ("quote", "no options", ["options"], []),
    ("task_spec", "ready to call but no area", ["area"], None),
    ("task_spec", "category not snake_case", ["category"], "Electronics Repair"),
    ("business", "phone not E.164", ["phone_e164"], "0501234567"),
    ("call_job", "second retry", ["attempt"], 3),
    ("call_job", "call over 150 s", ["max_duration_s"], 300),
    ("call_result", "impossible date", ["started_at"], "2026-13-45T18:01:30Z"),
    ("call_result", "timestamp not UTC", ["started_at"], "2026-10-25T21:01:30+03:00"),
    ("call_result", "ElevenLabs speaker name", ["transcript", 1, "speaker"], "user"),
    ("comparison", "cannot_compare with a ranking", ["status"], "cannot_compare"),
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
