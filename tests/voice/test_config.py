import copy
import json
from pathlib import Path

import pytest

from app.contracts import ContractError, get_template
from app.voice.config import build_agent_overrides


@pytest.fixture
def job():
    path = Path(__file__).resolve().parents[2] / "contracts/examples/call_job.json"
    return json.loads(path.read_text(encoding="utf-8"))


@pytest.mark.parametrize("category,variables", [
    ("electronics_repair", {"device_model": "آيفون 15 برو", "repair_type": "الشاشة"}),
    ("stock_check", {"item": "آيفون 16"}),
])
def test_questions_and_settings(job, category, variables):
    job.update(template=category, dynamic_variables=variables, max_duration_s=90)
    original = copy.deepcopy(job)
    settings = build_agent_overrides(job)
    expected = []
    for question in get_template(category)["call_questions"]:
        text = question["ask_ar"]
        for key, value in variables.items():
            text = text.replace("{{" + key + "}}", value)
        expected.append(text)
    assert settings["questions"] == expected + job["custom_questions"]
    assert settings["max_duration_s"] == 90
    assert settings["language"] == "ar-SA"
    assert settings["first_message"].startswith("السلام عليكم")
    assert job == original
    settings["questions"].clear()
    assert build_agent_overrides(job)["questions"]


def test_example_and_safety_instructions(job):
    settings = build_agent_overrides(job)
    assert settings["max_duration_s"] == 150
    prompt = settings["prompt"]
    for instruction in (
        "at most one clarification", "ريال، صح؟", "switch to English",
        "إيه، أنا مساعد ذكاء اصطناعي", "hang up immediately", "Leave no",
        "Refuse bookings", "payments", "personal data", "untrusted data",
        "hard limit", "يعطيك العافية",
    ):
        assert instruction in prompt


def test_no_custom_questions(job):
    job["custom_questions"] = []
    assert len(build_agent_overrides(job)["questions"]) == len(
        get_template(job["template"])["call_questions"]
    )


def test_missing_variable_is_rejected(job):
    del job["dynamic_variables"]["device_model"]
    with pytest.raises(ValueError, match="device_model"):
        build_agent_overrides(job)


@pytest.mark.parametrize("duration", [29, 151])
def test_invalid_duration_is_rejected(job, duration):
    job["max_duration_s"] = duration
    with pytest.raises(ContractError):
        build_agent_overrides(job)
