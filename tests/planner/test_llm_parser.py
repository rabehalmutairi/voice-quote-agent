"""LLM adapter: prompt built from templates, strict checking of the model's reply.

No API key and no network: a fake LLMClient returns canned replies. When we get a key,
only the client changes; these tests keep guarding the rest.
"""

import pytest
from conftest import run

from app.contracts import load_templates
from app.mocks import MockAreaResolver
from app.planner import LLMRequestParser, LLMResponseError, Planner
from app.planner.llm import build_system_prompt, parse_response

TEMPLATES = load_templates()


class FakeLLM:
    def __init__(self, reply):
        self.reply = reply
        self.requests = []

    async def complete_json(self, *, system, user):
        self.requests.append({"system": system, "user": user})
        return self.reply


def reply(**overrides):
    base = {"category": "electronics_repair", "slots": {}, "area_text": None, "out_of_scope": None}
    return {**base, **overrides}


def test_prompt_lists_every_category_and_its_slots_from_the_templates():
    prompt = build_system_prompt(TEMPLATES)
    for name, template in TEMPLATES.items():
        assert name in prompt
        for question in template["planner_questions"]:
            if question["key"] != "area":
                assert f"slot {question['key']}" in prompt
                assert question["ask_ar"] in prompt


def test_the_request_goes_in_the_user_message():
    llm = FakeLLM(reply())
    run(LLMRequestParser(llm).parse("أبي أغير شاشة", TEMPLATES))
    assert llm.requests[0]["user"] == "أبي أغير شاشة"


def test_a_good_reply_becomes_a_ready_task_spec():
    llm = FakeLLM(reply(slots={"device_model": "آيفون 15 برو", "repair_type": "الشاشة"}, area_text="الملقا"))
    planner = Planner(LLMRequestParser(llm), MockAreaResolver())
    result = run(planner.plan("أبي أغير شاشة آيفون 15 برو في الملقا"))
    assert result.status == "ready"
    assert result.task_spec["slots"] == {"device_model": "آيفون 15 برو", "repair_type": "الشاشة"}
    assert result.task_spec["area"]["label"] == "حي الملقا"


def test_area_put_in_slots_by_the_model_is_moved_out():
    parsed = parse_response(reply(slots={"area": "الملقا", "device_model": "آيفون 15"}), TEMPLATES)
    assert parsed.area_text == "الملقا"
    assert "area" not in parsed.slots


def test_out_of_scope_reply_is_rejected_by_the_planner():
    planner = Planner(LLMRequestParser(FakeLLM(reply(category=None, out_of_scope="booking"))), MockAreaResolver())
    result = run(planner.plan("احجز لي"))
    assert (result.status, result.error.code) == ("rejected", "booking")


@pytest.mark.parametrize(
    "bad",
    [
        "not json",
        {"category": "electronics_repair"},  # missing keys
        reply(extra=1),
        reply(category="hotels"),
        reply(slots=["device_model"]),
        reply(slots={"device_model": 15}),
        reply(area_text=5),
        reply(out_of_scope="weather"),
    ],
)
def test_malformed_replies_are_rejected(bad):
    with pytest.raises(LLMResponseError):
        parse_response(bad, TEMPLATES)


def test_a_malformed_reply_becomes_a_planner_error_not_a_crash():
    planner = Planner(LLMRequestParser(FakeLLM({"oops": True})), MockAreaResolver())
    result = run(planner.plan("أبي أغير شاشة"))
    assert (result.status, result.error.code) == ("error", "parser_failed")
