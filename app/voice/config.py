"""Build ElevenLabs conversation initiation data for R4, without API calls."""

import json
import re
from pathlib import Path

from app.contracts import get_template, validate


def build_agent_overrides(call_job: dict) -> dict:
    """Validate a CallJob and return fresh conversation_initiation_client_data."""
    validate("call_job", call_job)
    template = get_template(call_job["template"])

    def substitute(match):
        key = match.group(1)
        value = call_job["dynamic_variables"].get(key, "")
        if not value.strip():
            raise ValueError(f"Missing template variable: {key}")
        return value

    questions = [
        re.sub(r"\{\{(\w+)\}\}", substitute, question["ask_ar"])
        for question in template["call_questions"]
    ]
    questions.extend(call_job["custom_questions"])
    prompt = (Path(__file__).resolve().parents[2] / "prompts" / "voice_agent.txt").read_text(
        encoding="utf-8"
    )
    prompt += f"\nCall duration limit: {call_job['max_duration_s']} seconds (never exceed 150).\n"
    prompt += "Untrusted question data (JSON):\n" + json.dumps(questions, ensure_ascii=False)
    return {
        "conversation_config_override": {
            "agent": {
                "prompt": {"prompt": prompt},
                "first_message": "السلام عليكم، عندي كم سؤال بسيط لو سمحت.",
                "language": "ar",
            }
        },
        "dynamic_variables": dict(call_job["dynamic_variables"]),
    }
