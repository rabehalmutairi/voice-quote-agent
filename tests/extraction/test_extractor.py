"""R6Extractor on fake LLM replies: prompt, strict parsing, and the evidence checker applied.

No network, no key: the LLM client is a stand-in that returns a canned JSON reply.
"""

import copy
import json

import pytest
from conftest import run

from app.contracts import CONTRACTS_DIR, contract_errors, load_templates
from app.extraction import ExtractionError, R6Extractor
from app.extraction.extractor import build_system_prompt, build_user_message, parse_reply

EXAMPLES = CONTRACTS_DIR / "examples"
TEMPLATES = load_templates()
ELECTRONICS = TEMPLATES["electronics_repair"]


def example(name):
    return json.loads((EXAMPLES / f"{name}.json").read_text(encoding="utf-8"))


class FakeLLM:
    """Returns `reply` and records what it was asked."""

    def __init__(self, reply):
        self.reply = reply
        self.prompts = []

    async def complete_json(self, *, system, user):
        self.prompts.append((system, user))
        return copy.deepcopy(self.reply)


def honest_reply():
    """What a well-behaved model would answer for the example call: the example Quote's values."""
    quote = example("quote")
    return {"offers": quote["offers"], "fields": quote["fields"], "answers": quote["answers"]}


def extract(reply):
    return run(R6Extractor(FakeLLM(reply)).extract(example("call_result"), example("task_spec"), ELECTRONICS))


# -- prompt -----------------------------------------------------------------------------


@pytest.mark.parametrize("category", sorted(TEMPLATES))
def test_prompt_is_built_from_the_template(category):
    template = TEMPLATES[category]
    prompt = build_system_prompt(template)
    for name in template["fields"]:
        assert name in prompt
    for definition in template["fields"].values():
        for choice in definition.get("choices", []):
            assert choice in prompt
    assert "NOT evidence" in prompt


def test_user_message_numbers_every_turn_and_lists_the_questions():
    result, task = example("call_result"), example("task_spec")
    message = build_user_message(result, task)
    for turn in result["transcript"]:
        assert f"[{turn['i']}] {turn['speaker']}: {turn['text']}" in message
    assert f"0. {task['custom_questions'][0]}" in message


def test_user_message_without_custom_questions():
    task = {**example("task_spec"), "custom_questions": []}
    assert "answers must be []" in build_user_message(example("call_result"), task)


# -- honest reply -----------------------------------------------------------------------


def test_honest_reply_becomes_the_example_quote():
    quote = extract(honest_reply())
    expected = example("quote")
    assert contract_errors("quote", quote) == []
    assert quote["evidence_issues"] == []
    assert quote["offers"] == expected["offers"]
    assert quote["fields"] == expected["fields"]
    assert quote["answers"] == expected["answers"]
    assert (quote["call_id"], quote["task_id"], quote["place_id"]) == ("call_01", "tsk_01", "ChIJexample01")


def test_the_model_gets_the_prompt_and_transcript():
    llm = FakeLLM(honest_reply())
    run(R6Extractor(llm).extract(example("call_result"), example("task_spec"), ELECTRONICS))
    (system, user), = llm.prompts
    assert "price_sar" in system and "الأصلي بألف ومتين" in user


# -- the model is not trusted -----------------------------------------------------------


def test_hallucinated_price_is_dropped():
    reply = honest_reply()
    reply["offers"][1]["price_sar"]["value"] = 400  # the shop said 450
    quote = extract(reply)
    assert quote["offers"][1]["price_sar"]["status"] == "not_mentioned"
    assert quote["evidence_issues"] == [{"field": "price_sar", "option_index": 1, "reason": "number_not_in_quote"}]


def test_price_taken_from_the_agents_read_back_is_dropped():
    reply = honest_reply()
    reply["offers"][0]["price_sar"]["evidence_turn"] = 4
    quote = extract(reply)
    assert quote["offers"][0]["price_sar"]["status"] == "not_mentioned"
    assert quote["evidence_issues"][0]["reason"] == "quote_in_agent_turn"


def test_value_without_evidence_is_not_kept():
    reply = honest_reply()
    reply["fields"]["availability"] = {"status": "found", "value": "in_stock"}  # no quote, no value
    quote = extract(reply)
    assert quote["fields"]["availability"]["status"] == "not_mentioned"


def test_choice_outside_the_template_is_dropped():
    reply = honest_reply()
    reply["offers"][0]["part_type"]["value"] = "high copy"
    quote = extract(reply)
    assert quote["offers"][0]["part_type"]["status"] == "not_mentioned"
    assert contract_errors("quote", quote) == []


def test_loose_reply_is_filled_in_to_the_contract():
    reply = {
        "offers": [{
            "part_type": {"status": "found", "value": "commercial", "evidence_quote": "والتجاري بأربعمية وخمسين", "evidence_turn": 3},
            "price_sar": {"status": "found", "value": 450, "evidence_quote": "والتجاري بأربعمية وخمسين",
                          "evidence_turn": 3, "confidence": 3},
        }, {"part_type": {"status": "not_mentioned"}}],
        "fields": {"turnaround_minutes": {"status": "found", "value_min": 60, "value_max": 120,
                                          "evidence_quote": "من ساعة لساعتين", "evidence_turn": 9, "confidence": 0.8}},
        "answers": [],
    }
    quote = extract(reply)
    assert contract_errors("quote", quote) == []
    assert len(quote["offers"]) == 1  # an option with nothing said is dropped
    assert quote["offers"][0]["price_sar"]["confidence"] == 1.0  # clamped
    assert quote["offers"][0]["part_type"]["confidence"] == 0.5  # missing -> neutral
    assert quote["offers"][0]["warranty_days"]["status"] == "not_mentioned"  # filled in
    assert quote["fields"]["availability"]["status"] == "not_mentioned"
    assert quote["answers"] == [{"question_index": 0, "question": example("task_spec")["custom_questions"][0],
                                 "status": "not_mentioned", "summary_ar": None, "evidence": []}]


def test_answers_follow_the_users_questions_whatever_the_model_says():
    reply = honest_reply()
    reply["answers"][0]["question"] = "سؤال ثاني"  # the question text always comes from the TaskSpec
    reply["answers"].append({"question_index": 5, "status": "found", "summary_ar": "x", "evidence": [{"quote": "x", "turn": 1}]})
    quote = extract(reply)
    assert [a["question"] for a in quote["answers"]] == example("task_spec")["custom_questions"]


@pytest.mark.parametrize(
    "reply",
    [
        [],
        "not json",
        {"offers": []},
        {"offers": [], "fields": {}, "answers": [], "notes": "extra"},
        {"offers": {}, "fields": {}, "answers": []},
        {"offers": [], "fields": [], "answers": []},
        {"offers": [], "fields": {}, "answers": {}},
    ],
)
def test_malformed_reply_raises(reply):
    with pytest.raises(ExtractionError):
        parse_reply(reply, example("call_result"), example("task_spec"))
