"""Outcome mapping on hand-written Twilio + ElevenLabs payloads (tests/telephony/payloads/).

Each payload file is SYNTHETIC (see its `_note`) until we can save real responses. To add a
real one: save it there with `expected_outcome`, `twilio_call` and `conversation`, with no
personal data, and it is tested automatically.
"""

import copy
import json
from pathlib import Path

import pytest

from app.contracts import CONTRACTS_DIR
from app.telephony import CallNotFinished, map_outcome, shop_spoke

PAYLOADS = sorted((Path(__file__).parent / "payloads").glob("*.json"))
CONTRACT_OUTCOMES = set(
    json.loads((CONTRACTS_DIR / "common.schema.json").read_text(encoding="utf-8"))["$defs"]["outcome"]["enum"]
)


def load(name):
    return json.loads((Path(__file__).parent / "payloads" / f"{name}.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("path", PAYLOADS, ids=lambda p: p.stem)
def test_payload_maps_to_expected_outcome(path):
    case = json.loads(path.read_text(encoding="utf-8"))
    assert case["_note"].startswith(("SYNTHETIC", "REAL")), "say where the payload came from"
    assert case["expected_outcome"] in CONTRACT_OUTCOMES
    assert map_outcome(twilio_call=case["twilio_call"], conversation=case["conversation"]) == case["expected_outcome"]


def test_every_contract_outcome_has_a_payload():
    covered = {json.loads(p.read_text(encoding="utf-8"))["expected_outcome"] for p in PAYLOADS}
    assert covered == CONTRACT_OUTCOMES


def test_payloads_use_only_fake_numbers():
    for path in PAYLOADS:
        text = path.read_text(encoding="utf-8")
        for number in ("+966500000001", "+15005550006"):
            text = text.replace(number, "")
        assert "+966" not in text and "+1" not in text, f"{path.name} holds a number that isn't a fixture"


@pytest.mark.parametrize("status", ["queued", "initiated", "ringing", "in-progress"])
def test_running_twilio_call_is_not_mapped(status):
    with pytest.raises(CallNotFinished):
        map_outcome(twilio_call={"status": status, "answered_by": None})


@pytest.mark.parametrize("status", ["initiated", "in-progress", "processing"])
def test_running_conversation_is_not_mapped(status):
    conversation = load("human_completed")["conversation"]
    conversation["status"] = status
    with pytest.raises(CallNotFinished):
        map_outcome(conversation=conversation)


def test_unknown_twilio_status_is_loud():
    with pytest.raises(ValueError, match="unknown Twilio call status"):
        map_outcome(twilio_call={"status": "exploded"})


def test_needs_at_least_one_input():
    with pytest.raises(ValueError):
        map_outcome()


def test_twilio_not_connected_wins_over_a_conversation():
    """If the line never connected, a stray conversation record can't turn it into a quote."""
    case = load("human_completed")
    assert map_outcome(twilio_call={"status": "busy"}, conversation=case["conversation"]) == "busy"


@pytest.mark.parametrize("answered_by", ["machine_start", "machine_end_beep", "machine_end_silence", "machine_end_other"])
def test_any_machine_answer_is_voicemail(answered_by):
    case = load("human_completed")
    call = {**case["twilio_call"], "answered_by": answered_by}
    assert map_outcome(twilio_call=call, conversation=case["conversation"]) == "voicemail"


def test_success_needs_a_finished_conversation():
    conversation = load("human_completed")["conversation"]
    conversation["status"] = "failed"
    conversation["metadata"]["phone_call"]["call_result"] = None
    assert map_outcome(conversation=conversation) == "human_partial"


def test_agent_verdict_is_case_and_space_tolerant():
    conversation = load("ivr_agent_verdict")["conversation"]
    conversation["analysis"]["data_collection_results"]["call_outcome"]["value"] = " IVR "
    assert map_outcome(conversation=conversation) == "ivr"


def test_unknown_agent_verdict_falls_through():
    conversation = load("human_completed")["conversation"]
    conversation["analysis"]["data_collection_results"]["call_outcome"] = {
        "data_collection_id": "call_outcome", "value": "something_else", "rationale": "x"}
    assert map_outcome(conversation=conversation) == "human_completed"


def test_missing_optional_sections_are_tolerated():
    """`analysis`, `phone_call` and `tool_calls` are optional in the ElevenLabs schema."""
    conversation = load("human_completed")["conversation"]
    conversation["analysis"] = None
    conversation["metadata"] = {"start_time_unix_secs": 0, "call_duration_secs": 0, "cost_fiat": None}
    for turn in conversation["transcript"]:
        del turn["tool_calls"]
    assert map_outcome(conversation=conversation) == "human_partial"


def test_shop_spoke_ignores_empty_and_agent_turns():
    assert not shop_spoke({"transcript": [{"role": "user", "message": "  "}, {"role": "agent", "message": "هلا"}]})
    assert not shop_spoke({"transcript": None})
    assert shop_spoke({"transcript": [{"role": "user", "message": "تفضل"}]})


def test_inputs_are_not_modified():
    case = load("wrong_business")
    before = copy.deepcopy(case)
    map_outcome(twilio_call=case["twilio_call"], conversation=case["conversation"])
    assert case == before
