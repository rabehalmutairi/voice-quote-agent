"""The evidence checker on the contract examples and the mock fixtures.

No quote, no value: a value survives only if its evidence quote is in the shop turn it
names (whole words, after Arabic normalization) and, for prices, the number is in it.
"""

import copy
import json

import pytest

from app.contracts import CONTRACTS_DIR, contract_errors, load_templates
from app.extraction import (
    NUMBER_NOT_IN_QUOTE,
    QUOTE_IN_AGENT_TURN,
    QUOTE_NOT_FOUND,
    check_evidence,
    enforce_template,
    template_problems,
    verify_quote,
)
from app.extraction.arabic import contains_words
from app.mocks.providers import _fixtures, mock_script

EXAMPLES = CONTRACTS_DIR / "examples"
TEMPLATES = load_templates()
ELECTRONICS = TEMPLATES["electronics_repair"]
SCRIPTED = [(category, place_id) for category, shops in _fixtures()["scripts"].items() for place_id in shops]


def example(name):
    return json.loads((EXAMPLES / f"{name}.json").read_text(encoding="utf-8"))


def found(value, quote, turn):
    return {"value": value, "value_min": None, "value_max": None, "status": "found",
            "confidence": 0.9, "evidence_quote": quote, "evidence_turn": turn}


def script_pair(category, place_id):
    """The mock CallResult transcript and the Quote it supports."""
    script = mock_script(category, place_id)
    call_result = {**example("call_result"), "place_id": place_id, "transcript": script["transcript"]}
    quote = {"call_id": call_result["call_id"], "task_id": call_result["task_id"], "place_id": place_id,
             "offers": script["offers"], "fields": script["fields"], "answers": [], "evidence_issues": []}
    return quote, call_result


# -- whole-word matching ----------------------------------------------------------------


@pytest.mark.parametrize(
    "turn, quote, expected",
    [
        ("الأصلي بألف ومتين، والتجاري بأربعمية وخمسين", "الأصلي بألف ومتين", True),
        ("الاصلي بالف ومتين", "الأصلي بألف ومتين", True),          # hamza forms
        ("الأسود ١٢٨ جيجا", "الأسود 128 جيجا", True),               # Arabic-Indic digits
        ("ضمانها ثلاث شهور.", "ضمانها ثلاث شهور", True),            # punctuation
        ("ضمانها شهرين", "ضمانها ثلاث شهور", False),
        ("بخمسمية وعشرين", "بخمسمي", False),                        # part of a word
        ("آيفون 155", "آيفون 15", False),
        ("أي شي", "", False),
    ],
)
def test_contains_words(turn, quote, expected):
    assert contains_words(turn, quote) is expected


# -- honest data passes untouched -------------------------------------------------------


def test_example_quote_passes_with_no_issues():
    quote, result = example("quote"), example("call_result")
    checked = verify_quote(quote, result, ELECTRONICS)
    assert checked["evidence_issues"] == []
    assert checked["offers"] == [{k: offer[k] for k in ELECTRONICS["offer_fields"]} for offer in quote["offers"]]
    assert checked["fields"] == quote["fields"]
    assert checked["answers"] == quote["answers"]


@pytest.mark.parametrize("category, place_id", SCRIPTED)
def test_every_mock_quote_passes_with_no_issues(category, place_id):
    quote, result = script_pair(category, place_id)
    checked = verify_quote(quote, result, TEMPLATES[category])
    assert checked["evidence_issues"] == []
    assert contract_errors("quote", checked) == []
    assert template_problems(checked, TEMPLATES[category]) == []


def test_input_is_not_changed():
    quote, result = example("quote"), example("call_result")
    quote["offers"][1]["price_sar"]["value"] = 999
    before = copy.deepcopy(quote)
    verify_quote(quote, result, ELECTRONICS)
    assert quote == before


# -- each rejection reason --------------------------------------------------------------


def test_agent_repeating_the_price_is_not_evidence():
    quote, result = example("quote"), example("call_result")
    quote["offers"][1]["price_sar"]["evidence_turn"] = 4  # the agent's read-back
    checked = verify_quote(quote, result, ELECTRONICS)
    assert checked["offers"][1]["price_sar"]["status"] == "not_mentioned"
    assert checked["offers"][1]["price_sar"]["value"] is None
    assert checked["evidence_issues"] == [{"field": "price_sar", "option_index": 1, "reason": QUOTE_IN_AGENT_TURN}]


def test_wrong_number_is_dropped():
    quote, result = example("quote"), example("call_result")
    quote["offers"][1]["price_sar"]["value"] = 400  # the shop said 450
    checked = verify_quote(quote, result, ELECTRONICS)
    assert checked["offers"][1]["price_sar"]["status"] == "not_mentioned"
    assert checked["offers"][1]["part_type"]["status"] == "found"  # the rest of the offer stays
    assert checked["evidence_issues"] == [{"field": "price_sar", "option_index": 1, "reason": NUMBER_NOT_IN_QUOTE}]


def test_invented_quote_is_dropped():
    quote, result = example("quote"), example("call_result")
    quote["fields"]["turnaround_minutes"]["evidence_quote"] = "نص ساعة بس"
    checked = verify_quote(quote, result, ELECTRONICS)
    assert checked["fields"]["turnaround_minutes"]["status"] == "not_mentioned"
    assert checked["evidence_issues"] == [{"field": "turnaround_minutes", "option_index": None, "reason": QUOTE_NOT_FOUND}]


def test_quote_from_the_wrong_turn_is_dropped():
    quote, result = example("quote"), example("call_result")
    quote["fields"]["availability"]["evidence_turn"] = 9  # "موجودة" is in turn 11
    checked = verify_quote(quote, result, ELECTRONICS)
    assert checked["evidence_issues"] == [{"field": "availability", "option_index": None, "reason": QUOTE_NOT_FOUND}]


def test_turn_that_does_not_exist():
    quote, result = example("quote"), example("call_result")
    quote["fields"]["availability"]["evidence_turn"] = 99
    checked = verify_quote(quote, result, ELECTRONICS)
    assert checked["evidence_issues"][0]["reason"] == QUOTE_NOT_FOUND


def test_refused_value_needs_evidence_too():
    quote, result = example("quote"), example("call_result")
    quote["offers"][0]["warranty_days"]["evidence_quote"] = "ما نعطي ضمان"
    checked = verify_quote(quote, result, ELECTRONICS)
    assert checked["offers"][0]["warranty_days"]["status"] == "not_mentioned"
    assert checked["evidence_issues"] == [{"field": "warranty_days", "option_index": 0, "reason": QUOTE_NOT_FOUND}]


def test_price_range_needs_both_numbers_in_the_quote():
    result = example("call_result")
    result["transcript"][3]["text"] = "من أربعمية لخمسمية"
    quote = example("quote")
    quote["offers"] = [quote["offers"][1]]
    quote["offers"][0]["price_sar"] = {**found(None, "من أربعمية لخمسمية", 3), "value_min": 400, "value_max": 500}
    quote["offers"][0]["part_type"] = found("commercial", "من أربعمية لخمسمية", 3)  # stays valid evidence
    assert verify_quote(quote, result, ELECTRONICS)["offers"][0]["price_sar"]["value_min"] == 400

    quote["offers"][0]["price_sar"]["value_max"] = 600
    checked = verify_quote(quote, result, ELECTRONICS)
    assert checked["evidence_issues"] == [{"field": "price_sar", "option_index": 0, "reason": NUMBER_NOT_IN_QUOTE}]


@pytest.mark.parametrize(
    "shop_said, price, kept",
    [
        ("The original is twelve hundred, the copy is four hundred and fifty.", 450, True),
        ("The copy screen is four fifty.", 450, True),
        ("The copy screen is four fifty.", 400, False),
        ("التجاري بألف ونص", 1500, True),
        ("التجاري بميتين ونص", 250, True),
        ("التجاري بألف ونص", 1000, False),
    ],
)
def test_prices_said_in_english_or_with_halves(shop_said, price, kept):
    result = example("call_result")
    result["transcript"][3]["text"] = shop_said
    quote = example("quote")
    quote["offers"] = [{
        "part_type": found("commercial", shop_said, 3),
        "price_sar": found(price, shop_said, 3),
        "warranty_days": quote["offers"][1]["warranty_days"],
    }]
    checked = verify_quote(quote, result, ELECTRONICS)
    assert (checked["offers"][0]["price_sar"]["status"] == "found") is kept
    assert checked["evidence_issues"] == ([] if kept else [{"field": "price_sar", "option_index": 0, "reason": NUMBER_NOT_IN_QUOTE}])


def test_custom_answer_without_valid_evidence_becomes_not_mentioned():
    quote, result = example("quote"), example("call_result")
    quote["answers"][0]["evidence"] = [{"quote": "يصلحونه قدامي", "turn": 12}]  # the agent's own question
    checked = verify_quote(quote, result, ELECTRONICS)
    answer = checked["answers"][0]
    assert (answer["status"], answer["summary_ar"], answer["evidence"]) == ("not_mentioned", None, [])
    assert checked["evidence_issues"] == [{"field": "answers", "option_index": 0, "reason": QUOTE_IN_AGENT_TURN}]


def test_custom_answer_keeps_its_good_evidence():
    quote, result = example("quote"), example("call_result")
    quote["answers"][0]["evidence"].append({"quote": "ما نصلح قدام أحد", "turn": 13})
    checked = verify_quote(quote, result, ELECTRONICS)
    assert checked["answers"][0]["status"] == "found"
    assert checked["answers"][0]["evidence"] == [{"quote": "تقعد وتشوفه قدامك", "turn": 13}]
    assert len(checked["evidence_issues"]) == 1


def test_mismatched_transcript_is_refused():
    quote, result = example("quote"), example("call_result")
    result["call_id"] = "call_other"
    with pytest.raises(ValueError):
        check_evidence(quote, result, ELECTRONICS)


# -- template rules ---------------------------------------------------------------------


@pytest.mark.parametrize(
    "why, path, value",
    [
        ("choice not in the template", ["offers", 0, "part_type", "value"], "copy"),
        ("number given as text", ["offers", 1, "price_sar", "value"], "450"),
        ("yes/no for a number", ["offers", 1, "price_sar", "value"], True),
        ("range upside down", ["fields", "turnaround_minutes", "value_max"], 30),
    ],
)
def test_value_that_breaks_the_template_is_dropped(why, path, value):
    quote = example("quote")
    target = quote
    for key in path[:-2]:
        target = target[key]
    target[path[-2]][path[-1]] = value
    assert template_problems(quote, ELECTRONICS), why
    fixed = enforce_template(quote, ELECTRONICS)
    assert fixed_field(fixed, path)["status"] == "not_mentioned", why
    assert template_problems(fixed, ELECTRONICS) == []


def fixed_field(quote, path):
    target = quote
    for key in path[:-1]:
        target = target[key]
    return target


def test_fields_in_the_wrong_place_are_removed_and_missing_ones_filled():
    quote = example("quote")
    quote["offers"][0]["availability"] = found("in_stock", "موجودة", 11)  # per-call field in an offer
    quote["offers"][0]["colour"] = found("red", "أحمر", 3)                # not in the template
    del quote["fields"]["turnaround_minutes"]                             # required, missing
    fixed = enforce_template(quote, ELECTRONICS)
    assert set(fixed["offers"][0]) == set(ELECTRONICS["offer_fields"])
    assert fixed["fields"]["turnaround_minutes"]["status"] == "not_mentioned"
    assert template_problems(fixed, ELECTRONICS) == []
    assert contract_errors("quote", fixed) == []
