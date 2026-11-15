"""R6Comparator: like for like, or cannot_compare with reasons."""

import copy

import pytest
from conftest import run

from app.comparison import R6Comparator
from app.contracts import contract_errors, load_templates
from app.mocks import mock_script

TEMPLATES = load_templates()
SHOPS = ("ChIJexample01", "ChIJexample02", "ChIJexample03")


def task(category="electronics_repair"):
    return {"task_id": "tsk_01", "category": category}  # the comparator reads only these


def found(value, quote="x", turn=1):
    return {"value": value, "value_min": None, "value_max": None, "status": "found",
            "confidence": 0.9, "evidence_quote": quote, "evidence_turn": turn}


NOT_MENTIONED = {"value": None, "value_min": None, "value_max": None, "status": "not_mentioned",
                 "confidence": None, "evidence_quote": None, "evidence_turn": None}


def quote(place_id, offers, fields=None, answers=None):
    return {"call_id": f"call_{place_id[-2:]}", "task_id": "tsk_01", "place_id": place_id,
            "offers": offers, "fields": fields or {}, "answers": answers or [], "evidence_issues": []}


def screen(part, price, warranty=None):
    return {"part_type": found(part), "price_sar": found(price),
            "warranty_days": found(warranty) if warranty is not None else dict(NOT_MENTIONED)}


def script_quote(category, place_id):
    script = mock_script(category, place_id)
    return quote(place_id, script["offers"], script["fields"])


def compare(quotes, excluded=(), category="electronics_repair"):
    result = run(R6Comparator().compare(task(category), TEMPLATES[category], copy.deepcopy(quotes), list(excluded)))
    assert contract_errors("comparison", result) == []
    return result


# -- the mock shops ---------------------------------------------------------------------


def test_mock_electronics_shops_ranked_on_commercial_screens():
    result = compare([script_quote("electronics_repair", s) for s in SHOPS])
    assert result["status"] == "ranked"
    assert result["basis"].startswith("commercial part")
    assert [r["place_id"] for r in result["ranking"]] == list(SHOPS)  # 450, 480, 520
    assert result["ranking"][0]["reason"] == "cheapest commercial part: 450 SAR with a 30-day warranty, in stock"
    assert result["excluded"] == []


def test_mock_stock_check_ranks_new_phones_and_excludes_the_one_without_price():
    result = compare([script_quote("stock_check", s) for s in SHOPS], category="stock_check")
    assert result["status"] == "partial"
    assert [r["place_id"] for r in result["ranking"]] == ["ChIJexample02", "ChIJexample01"]  # 3300, 3400
    assert "needs order" in result["ranking"][0]["reason"]
    assert result["excluded"] == [{"place_id": "ChIJexample03", "reason": "no verified price"}]


def test_failed_calls_are_copied_into_excluded():
    quotes = [script_quote("electronics_repair", s) for s in ("ChIJexample01", "ChIJexample03")]
    result = compare(quotes, excluded=[{"place_id": "ChIJexample02", "reason": "no answer after one retry"}])
    assert result["status"] == "partial"
    assert [r["place_id"] for r in result["ranking"]] == ["ChIJexample01", "ChIJexample03"]
    assert result["excluded"] == [{"place_id": "ChIJexample02", "reason": "no answer after one retry"}]


# -- like for like ----------------------------------------------------------------------


def test_mismatched_parts_cannot_be_compared():
    # The "mismatched fixture" from architecture §6: original vs commercial is not like for like.
    result = compare([quote(SHOPS[0], [screen("original", 1200)]), quote(SHOPS[1], [screen("commercial", 450)])])
    assert result["status"] == "cannot_compare"
    assert result["ranking"] == [] and result["basis"] is None
    assert "different options" in result["cannot_compare_reasons"][0]
    assert "original part" in result["cannot_compare_reasons"][0]


def test_cheaper_but_different_part_never_wins():
    quotes = [
        quote(SHOPS[0], [screen("original", 1200)]),
        quote(SHOPS[1], [screen("original", 1100)]),
        quote(SHOPS[2], [screen("commercial", 300)]),  # cheapest overall, but not like for like
    ]
    result = compare(quotes)
    assert result["status"] == "partial"
    assert [r["place_id"] for r in result["ranking"]] == [SHOPS[1], SHOPS[0]]
    assert result["excluded"] == [{"place_id": SHOPS[2],
                                   "reason": "quoted only commercial part; not like for like with original part"}]


def test_most_shops_decide_the_basis_then_the_cheapest():
    quotes = [
        quote(SHOPS[0], [screen("original", 1200), screen("commercial", 450)]),
        quote(SHOPS[1], [screen("original", 1150), screen("commercial", 480)]),
    ]
    result = compare(quotes)
    assert result["basis"].startswith("commercial part")  # both groups have 2 shops: cheaper wins
    assert result["status"] == "ranked"


def test_equal_price_longer_warranty_wins():
    quotes = [quote(SHOPS[0], [screen("commercial", 450, 14)]), quote(SHOPS[1], [screen("commercial", 450, 90)])]
    result = compare(quotes)
    assert [r["place_id"] for r in result["ranking"]] == [SHOPS[1], SHOPS[0]]
    assert "then longer warranty" in result["basis"]


def test_warranty_not_stated_ranks_after_stated():
    quotes = [quote(SHOPS[0], [screen("commercial", 450)]), quote(SHOPS[1], [screen("commercial", 450, 7)])]
    result = compare(quotes)
    assert [r["place_id"] for r in result["ranking"]] == [SHOPS[1], SHOPS[0]]
    assert "warranty not stated" in result["ranking"][1]["reason"]


def test_shop_best_offer_in_the_group_is_used():
    quotes = [
        quote(SHOPS[0], [screen("commercial", 600), screen("commercial", 400)]),
        quote(SHOPS[1], [screen("commercial", 450)]),
    ]
    result = compare(quotes)
    assert result["ranking"][0]["place_id"] == SHOPS[0]
    assert "400 SAR" in result["ranking"][0]["reason"]
    assert len(result["ranking"]) == 2


# -- not enough to compare --------------------------------------------------------------


def test_one_usable_shop_cannot_be_compared():
    quotes = [quote(SHOPS[0], [screen("commercial", 450)]), quote(SHOPS[1], [])]
    result = compare(quotes, excluded=[{"place_id": SHOPS[2], "reason": "no answer"}])
    assert result["status"] == "cannot_compare"
    assert "only one shop" in result["cannot_compare_reasons"][0]
    assert {e["place_id"] for e in result["excluded"]} == {SHOPS[1], SHOPS[2]}


def test_no_prices_and_no_answers_cannot_be_compared():
    result = compare([quote(SHOPS[0], []), quote(SHOPS[1], [])])
    assert result["status"] == "cannot_compare"
    assert result["cannot_compare_reasons"] == ["no shop gave a verified exact price"]


def test_only_answers_are_shown_side_by_side():
    answer = {"question_index": 0, "question": "يصلحونه قدامي؟", "status": "found",
              "summary_ar": "إيه يصلحونه قدامك.", "evidence": [{"quote": "قدامك", "turn": 3}]}
    result = compare([quote(SHOPS[0], [], answers=[answer]), quote(SHOPS[1], [])])
    assert result["status"] == "side_by_side"
    assert result["ranking"] == [] and result["basis"] is None


def test_no_quotes_at_all():
    result = compare([], excluded=[{"place_id": SHOPS[0], "reason": "no answer"}])
    assert result["status"] == "cannot_compare"
    assert result["excluded"] == [{"place_id": SHOPS[0], "reason": "no answer"}]


# -- other categories, same engine ------------------------------------------------------


def test_car_repair_compares_brand_and_labor_together():
    def brakes(brand, price, labor):
        return {"part_brand": found(brand), "price_sar": found(price), "labor_included": found(labor),
                "warranty_days": dict(NOT_MENTIONED)}

    quotes = [
        quote(SHOPS[0], [brakes("aftermarket", 600, True)]),
        quote(SHOPS[1], [brakes("aftermarket", 500, False)]),  # cheaper, but labor extra: not like for like
        quote(SHOPS[2], [brakes("aftermarket", 650, True)]),
    ]
    result = compare(quotes, category="car_repair")
    assert result["status"] == "partial"
    assert result["basis"].startswith("aftermarket, labor included parts")
    assert [r["place_id"] for r in result["ranking"]] == [SHOPS[0], SHOPS[2]]
    assert result["excluded"][0]["place_id"] == SHOPS[1]


@pytest.mark.parametrize("category", ["electronics_repair", "stock_check", "car_repair"])
def test_input_is_not_changed(category):
    quotes = [script_quote("electronics_repair", s) for s in SHOPS] if category == "electronics_repair" else []
    before = copy.deepcopy(quotes)
    excluded = [{"place_id": "x", "reason": "no answer"}]
    run(R6Comparator().compare(task(category), TEMPLATES[category], quotes, excluded))
    assert quotes == before and excluded == [{"place_id": "x", "reason": "no answer"}]
