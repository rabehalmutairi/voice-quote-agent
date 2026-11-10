"""Usable-quote rules per category."""

import json

from app.comparison.usable import is_usable, not_rankable_reason, rankable_offers
from app.contracts import CONTRACTS_DIR, load_templates
from app.mocks import mock_script

TEMPLATES = load_templates()
NOT_MENTIONED = {"value": None, "value_min": None, "value_max": None, "status": "not_mentioned",
                 "confidence": None, "evidence_quote": None, "evidence_turn": None}


def example_quote():
    return json.loads((CONTRACTS_DIR / "examples" / "quote.json").read_text(encoding="utf-8"))


def script_quote(category, place_id):
    script = mock_script(category, place_id)
    return {"call_id": "call_01", "task_id": "tsk_01", "place_id": place_id,
            "offers": script["offers"], "fields": script["fields"], "answers": [], "evidence_issues": []}


def test_electronics_quote_with_verified_price_and_part_is_usable():
    quote = example_quote()
    assert is_usable(quote, TEMPLATES["electronics_repair"])
    assert [key for key, _ in rankable_offers(quote, TEMPLATES["electronics_repair"])] == [("original",), ("commercial",)]


def test_electronics_price_without_part_type_is_not_usable():
    quote = example_quote()
    for offer in quote["offers"]:
        offer["part_type"] = dict(NOT_MENTIONED)
    template = TEMPLATES["electronics_repair"]
    assert not is_usable(quote, template)
    assert not_rankable_reason(quote, template) == "price given without a known part type"


def test_unknown_part_type_is_not_comparable():
    quote = example_quote()
    for offer in quote["offers"]:
        offer["part_type"]["value"] = "unknown"
    assert not is_usable(quote, TEMPLATES["electronics_repair"])


def test_price_range_is_not_rankable():
    quote = example_quote()
    quote["offers"] = [quote["offers"][1]]
    quote["offers"][0]["price_sar"].update(value=None, value_min=400, value_max=500)
    template = TEMPLATES["electronics_repair"]
    assert not is_usable(quote, template)
    assert "range" in not_rankable_reason(quote, template)


def test_refused_price():
    quote = example_quote()
    quote["offers"] = [quote["offers"][0]]
    quote["offers"][0]["price_sar"] = {**quote["offers"][0]["warranty_days"]}  # a refused field
    assert not_rankable_reason(quote, TEMPLATES["electronics_repair"]) == "would not give a price over the phone"


def test_stock_check_usable_on_verified_availability_even_without_price():
    template = TEMPLATES["stock_check"]
    quote = script_quote("stock_check", "ChIJexample03")  # used, in stock, no price
    assert is_usable(quote, template)
    assert rankable_offers(quote, template) == []
    assert not_rankable_reason(quote, template) == "no verified price"


def test_out_of_stock_is_usable_but_not_rankable():
    template = TEMPLATES["stock_check"]
    quote = script_quote("stock_check", "ChIJexample01")
    for offer in quote["offers"]:
        offer["availability"]["value"] = "out_of_stock"
    assert is_usable(quote, template)
    assert rankable_offers(quote, template) == []
    assert not_rankable_reason(quote, template) == "out of stock"


def test_every_mock_quote_is_usable():
    for category in ("electronics_repair", "stock_check"):
        for place_id in ("ChIJexample01", "ChIJexample02", "ChIJexample03"):
            assert is_usable(script_quote(category, place_id), TEMPLATES[category]), (category, place_id)
