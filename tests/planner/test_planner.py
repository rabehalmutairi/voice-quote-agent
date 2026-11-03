"""Planner: request text -> TaskSpec, follow-up questions, or a structured refusal.

Uses the deterministic mock parser, so these tests check the planner's own logic
(templates, missing slots, custom questions, validation), not language understanding.
"""

import copy
from datetime import datetime, timezone

import pytest
from conftest import CUSTOM_QUESTION, run

from app.contracts import contract_errors, get_template, load_templates
from app.mocks import MockAreaResolver, MockRequestParser
from app.planner import ParsedRequest, Planner


def make_planner(**kwargs):
    kwargs.setdefault("clock", lambda: datetime(2026, 11, 3, 9, 0, tzinfo=timezone.utc))
    kwargs.setdefault("new_task_id", lambda: "tsk_test01")
    return Planner(MockRequestParser(), MockAreaResolver(), **kwargs)


def plan(text, **kwargs):
    return run(make_planner().plan(text, **kwargs))


# -- complete requests -----------------------------------------------------------------


def test_complete_electronics_request_is_ready():
    result = plan("أبي أغير شاشة آيفون 15 برو في حي الملقا", custom_questions=[CUSTOM_QUESTION])
    assert result.status == "ready"
    assert result.questions == [] and result.error is None
    assert result.task_spec == {
        "task_id": "tsk_test01",
        "category": "electronics_repair",
        "request_text": "أبي أغير شاشة آيفون 15 برو في حي الملقا",
        "slots": {"device_model": "آيفون 15 برو", "repair_type": "الشاشة"},
        "custom_questions": [CUSTOM_QUESTION],
        "area": {"label": "حي الملقا", "lat": 24.80, "lng": 46.61, "radius_m": 5000},
        "max_businesses": 3,
        "missing_slots": [],
        "created_at": "2026-11-03T09:00:00Z",
    }


def test_complete_stock_check_request_is_ready():
    result = plan("عندكم آيفون 16 متوفر؟ أنا في العليا")
    assert result.status == "ready"
    assert result.task_spec["category"] == "stock_check"
    assert result.task_spec["slots"] == {"item": "آيفون 16"}
    assert result.task_spec["area"]["label"] == "حي العليا"


def test_english_request_works_too():
    result = plan("I want to replace my iPhone 15 Pro battery in Olaya")
    assert result.status == "ready"
    assert result.task_spec["slots"] == {"device_model": "آيفون 15 برو", "repair_type": "البطارية"}


def test_longest_device_name_wins():
    result = plan("تغيير شاشة آيفون 16 برو ماكس في الملقا")
    assert result.task_spec["slots"]["device_model"] == "آيفون 16 برو ماكس"


@pytest.mark.parametrize(
    "text",
    [
        "أبي أغير شاشة آيفون 15 برو في حي الملقا",
        "أبي أغير شاشة آيفون 15 برو",
        "تصليح جوالي",
        "عندكم ماك بوك اير M4؟ في النرجس",
        "عندكم آيفون 16؟",
        "replace iphone 14 charging port in yasmin",
    ],
)
def test_every_accepted_task_spec_matches_the_contract(text):
    result = plan(text, custom_questions=[CUSTOM_QUESTION])
    assert result.accepted
    assert contract_errors("task_spec", result.task_spec) == []


# -- missing information and follow-up questions ----------------------------------------


def test_missing_area_asks_the_template_question():
    result = plan("أبي أغير شاشة آيفون 15 برو")
    assert result.status == "needs_input"
    assert result.task_spec["missing_slots"] == ["area"]
    assert result.task_spec["area"] is None
    template = get_template("electronics_repair")
    area_question = next(q for q in template["planner_questions"] if q["key"] == "area")
    assert result.questions == [area_question]


def test_missing_everything_asks_in_template_order():
    result = plan("تصليح جوالي")
    assert result.status == "needs_input"
    assert result.task_spec["missing_slots"] == ["device_model", "repair_type", "area"]
    template = get_template("electronics_repair")
    assert result.questions == template["planner_questions"]


def test_unknown_place_is_asked_again_with_a_note():
    result = plan("أبي أغير شاشة آيفون 15 برو", area="حي غير معروف")
    assert result.status == "needs_input"
    assert result.task_spec["missing_slots"] == ["area"]
    assert "area_not_found" in result.notes


def test_area_object_from_the_ui_is_used_as_is():
    pin = {"label": "موقعي", "lat": 24.75, "lng": 46.70, "radius_m": 3000}
    result = plan("أبي أغير شاشة آيفون 15 برو", area=pin)
    assert result.status == "ready"
    assert result.task_spec["area"] == pin


def test_answers_fill_missing_slots_and_keep_the_task_id():
    planner = make_planner()
    first = run(planner.plan("تصليح جوالي", custom_questions=[CUSTOM_QUESTION]))
    second = run(planner.answer(first.task_spec, {"device_model": "آيفون 15", "area": "الملقا"}))
    assert second.status == "needs_input"
    assert second.task_spec["missing_slots"] == ["repair_type"]
    assert [q["key"] for q in second.questions] == ["repair_type"]

    third = run(planner.answer(second.task_spec, {"repair_type": "البطارية"}))
    assert third.status == "ready"
    spec = third.task_spec
    assert spec["task_id"] == first.task_spec["task_id"]
    assert spec["created_at"] == first.task_spec["created_at"]
    assert spec["slots"] == {"device_model": "آيفون 15", "repair_type": "البطارية"}
    assert spec["custom_questions"] == [CUSTOM_QUESTION]
    assert contract_errors("task_spec", spec) == []


def test_answer_does_not_modify_the_input_spec():
    planner = make_planner()
    first = run(planner.plan("تصليح جوالي"))
    before = copy.deepcopy(first.task_spec)
    run(planner.answer(first.task_spec, {"device_model": "آيفون 15"}))
    assert first.task_spec == before


@pytest.mark.parametrize(
    "answers, code",
    [
        ({"colour": "أسود"}, "unknown_answer_key"),
        ({}, "invalid_answers"),
        ("الملقا", "invalid_answers"),
        ({"device_model": 15}, "invalid_answers"),
        ({"area": {"label": "x"}}, "invalid_area"),
    ],
)
def test_bad_answers_are_invalid_not_a_crash(answers, code):
    planner = make_planner()
    first = run(planner.plan("تصليح جوالي"))
    result = run(planner.answer(first.task_spec, answers))
    assert (result.status, result.error.code) == ("invalid", code)
    assert result.task_spec is None


def test_answer_rejects_a_broken_task_spec():
    result = run(make_planner().answer({"task_id": "nope"}, {"area": "الملقا"}))
    assert (result.status, result.error.code) == ("invalid", "invalid_task_spec")


# -- custom questions --------------------------------------------------------------------


def test_two_custom_questions_are_kept_word_for_word_and_in_order():
    questions = ["يصلحونه قدامي؟", "  عندهم   توصيل؟ "]
    result = plan("أبي أغير شاشة آيفون 15 برو في الملقا", custom_questions=questions)
    assert result.task_spec["custom_questions"] == ["يصلحونه قدامي؟", "عندهم توصيل؟"]


def test_empty_and_duplicate_custom_questions_are_dropped():
    result = plan("أبي أغير شاشة آيفون 15 برو في الملقا", custom_questions=["", "  ", "سؤال؟", "سؤال؟"])
    assert result.task_spec["custom_questions"] == ["سؤال؟"]


@pytest.mark.parametrize(
    "questions, code",
    [
        (["1؟", "2؟", "3؟"], "too_many_custom_questions"),
        ("سؤال واحد؟", "invalid_custom_questions"),
        ([None], "invalid_custom_questions"),
        (["س" * 301], "custom_question_too_long"),
    ],
)
def test_bad_custom_questions_are_invalid(questions, code):
    result = plan("أبي أغير شاشة آيفون 15 برو", custom_questions=questions)
    assert (result.status, result.error.code) == ("invalid", code)


# -- max_businesses, bad input ------------------------------------------------------------


@pytest.mark.parametrize("value", [1, 2, 3])
def test_max_businesses_is_kept(value):
    assert plan("أبي أغير شاشة آيفون 15 برو", max_businesses=value).task_spec["max_businesses"] == value


@pytest.mark.parametrize("value", [0, 4, -1, "3", 2.0, True, None])
def test_bad_max_businesses_is_invalid(value):
    result = plan("أبي أغير شاشة آيفون 15 برو", max_businesses=value)
    assert (result.status, result.error.code) == ("invalid", "invalid_max_businesses")


@pytest.mark.parametrize(
    "text, code",
    [("", "empty_request"), ("   ", "empty_request"), (None, "empty_request"), (42, "empty_request"),
     ("ش" * 1001, "request_too_long")],
)
def test_bad_request_text_is_invalid(text, code):
    result = plan(text)
    assert (result.status, result.error.code) == ("invalid", code)


@pytest.mark.parametrize(
    "area",
    [
        {"label": "x", "lat": 24.8, "lng": 46.6},  # missing radius
        {"label": "x", "lat": 95, "lng": 46.6, "radius_m": 5000},
        {"label": "x", "lat": 24.8, "lng": 46.6, "radius_m": 50},
        {"label": "", "lat": 24.8, "lng": 46.6, "radius_m": 5000},
        {"label": "x", "lat": "24.8", "lng": 46.6, "radius_m": 5000},
        12,
    ],
)
def test_bad_area_is_invalid(area):
    result = plan("أبي أغير شاشة آيفون 15 برو", area=area)
    assert (result.status, result.error.code) == ("invalid", "invalid_area")


# -- out of scope and unsupported categories ----------------------------------------------


@pytest.mark.parametrize(
    "text, code",
    [
        ("احجز لي موعد تصليح شاشة آيفون 15", "booking"),
        ("أبي أدفع لهم عربون", "payment"),
        ("أبي أروح مستشفى قريب", "medical"),
        ("أبي فندق في العليا", "hotel"),
        ("سيارتي يطلع منها صوت غريب", "diagnosis"),
        ("my car makes a noise", "diagnosis"),
    ],
)
def test_out_of_scope_requests_are_rejected_with_an_arabic_message(text, code):
    result = plan(text)
    assert result.status == "rejected"
    assert result.error.code == code
    assert result.error.message_ar
    assert result.task_spec is None


def test_unrelated_request_is_unsupported():
    result = plan("أبي بيتزا")
    assert (result.status, result.error.code) == ("rejected", "unsupported_category")


def test_car_repair_is_off_until_gate_c():
    text = "أبي أغير كفرات الكامري"
    assert plan(text).error.code == "category_not_enabled"

    planner = make_planner(enabled_categories=("electronics_repair", "stock_check", "car_repair"))
    result = run(planner.plan(text + " في الملقا"))
    assert result.status == "needs_input"
    assert result.task_spec["category"] == "car_repair"
    assert result.task_spec["missing_slots"] == ["vehicle", "service"]


def test_enabling_a_category_without_a_template_fails_at_startup():
    with pytest.raises(ValueError):
        make_planner(enabled_categories=("electronics_repair", "hotels"))


# -- the parser is an external dependency: it must never crash the planner -----------------


class StubParser:
    def __init__(self, result=None, error=None):
        self.result, self.error = result, error

    async def parse(self, request_text, templates):
        if self.error:
            raise self.error
        return self.result


def test_a_crashing_parser_gives_a_structured_error():
    planner = Planner(StubParser(error=TimeoutError("LLM down")), MockAreaResolver())
    result = run(planner.plan("أي شي"))
    assert (result.status, result.error.code) == ("error", "parser_failed")


def test_a_parser_returning_garbage_gives_a_structured_error():
    planner = Planner(StubParser(result={"category": "electronics_repair"}), MockAreaResolver())
    assert run(planner.plan("أي شي")).status == "error"


def test_a_parser_inventing_a_category_is_rejected():
    planner = Planner(StubParser(ParsedRequest(category="hotels")), MockAreaResolver())
    assert run(planner.plan("أي شي")).error.code == "unsupported_category"


def test_slots_the_template_does_not_ask_for_are_dropped():
    parsed = ParsedRequest(
        category="electronics_repair",
        slots={"device_model": "آيفون 15", "repair_type": "الشاشة", "user_phone": "0500000000", "area": "x"},
    )
    result = run(Planner(StubParser(parsed), MockAreaResolver()).plan("أي شي"))
    assert result.task_spec["slots"] == {"device_model": "آيفون 15", "repair_type": "الشاشة"}


def test_a_crashing_area_resolver_just_leaves_the_area_missing():
    class BrokenResolver:
        async def resolve(self, text):
            raise ConnectionError

    planner = Planner(MockRequestParser(), BrokenResolver())
    result = run(planner.plan("أبي أغير شاشة آيفون 15 برو في الملقا"))
    assert result.status == "needs_input" and result.task_spec["missing_slots"] == ["area"]


# -- templates drive the planner, not code ---------------------------------------------------


def test_a_new_category_needs_only_a_template():
    templates = load_templates()
    laptop = copy.deepcopy(templates["electronics_repair"])
    laptop["category"] = "laptop_repair"
    laptop["planner_questions"] = [
        {"key": "laptop_model", "ask_ar": "وش موديل اللابتوب؟"},
        {"key": "area", "ask_ar": "وين؟"},
    ]
    laptop["call_questions"] = [{"field": f, "ask_ar": f"سؤال عن {f} لـ {{{{laptop_model}}}}"} for f in laptop["fields"]]
    templates["laptop_repair"] = laptop

    parser = StubParser(ParsedRequest(category="laptop_repair", slots={}))
    planner = Planner(parser, MockAreaResolver(), templates=templates, enabled_categories=["laptop_repair"])
    result = run(planner.plan("لابتوبي خربان"))
    assert result.status == "needs_input"
    assert result.questions == laptop["planner_questions"]
