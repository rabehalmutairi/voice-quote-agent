"""LLM-backed RequestParser, ready for when we get an LLM key.

Everything except the HTTP call is here and tested: the prompt is built from the
templates, and the model's JSON answer is checked strictly before the planner uses it.
To go live, write a small class with this method for whichever LLM API we get,
and pass it in:

    class MyLLMClient:
        async def complete_json(self, *, system: str, user: str) -> dict:
            ...  # call the API in JSON mode, return the parsed object

    planner = Planner(LLMRequestParser(MyLLMClient()), area_resolver)

Put that client in /app/planner (R1). Never commit the key: read it from .env.
"""

from __future__ import annotations

import json
from typing import Protocol

from app.planner.parser import OUT_OF_SCOPE_REASONS, ParsedRequest

AREA_KEY = "area"


class LLMClient(Protocol):
    async def complete_json(self, *, system: str, user: str) -> dict:
        """Send one system + user message, return the model's reply parsed as a JSON object."""
        ...


class LLMResponseError(ValueError):
    """The model's reply doesn't have the shape we asked for."""


RESPONSE_SHAPE = {
    "category": "one of the category names below, or null if none fits",
    "slots": {"<slot key>": "the user's own words for that slot, only if they said it"},
    "area_text": "the neighbourhood or place the user mentioned, or null",
    "out_of_scope": f"null, or one of {sorted(OUT_OF_SCOPE_REASONS)} if the request asks for that",
}


def build_system_prompt(templates: dict[str, dict]) -> str:
    """The planner instructions, generated from the templates so a new category needs no prompt edit."""
    lines = [
        "You read one request from a user in Saudi Arabia (Arabic or English).",
        "We phone shops on the user's behalf to ask questions. Classify the request and copy",
        "out the details it already contains. Reply with ONE JSON object and nothing else.",
        "",
        "Rules:",
        "- Copy slot values in the user's own words. Never guess or invent a value; leave the slot out.",
        "- Only use the slot keys listed for the chosen category.",
        "- Do not answer the request and do not add questions.",
        "- If the request asks us to book, reserve, order, pay, share personal details, involves",
        "  hospitals/clinics or hotels, or asks to diagnose an unclear fault, set out_of_scope.",
        "",
        "Categories:",
    ]
    for name, template in sorted(templates.items()):
        lines.append(f"- {name} (search terms: {', '.join(template['places_queries']['en'])})")
        for question in template["planner_questions"]:
            if question["key"] == AREA_KEY:
                continue
            lines.append(f"    slot {question['key']}: answers \"{question['ask_ar']}\"")
    lines += ["", "Reply shape:", json.dumps(RESPONSE_SHAPE, ensure_ascii=False, indent=2)]
    return "\n".join(lines)


def parse_response(reply: object, templates: dict[str, dict]) -> ParsedRequest:
    """Check the model's JSON strictly and turn it into a ParsedRequest."""
    if not isinstance(reply, dict):
        raise LLMResponseError("reply is not a JSON object")
    expected = set(RESPONSE_SHAPE)
    if set(reply) != expected:
        raise LLMResponseError(f"reply keys must be exactly {sorted(expected)}, got {sorted(reply)}")

    category = reply["category"]
    if category is not None and (not isinstance(category, str) or category not in templates):
        raise LLMResponseError(f"unknown category {category!r}")

    slots = reply["slots"]
    if not isinstance(slots, dict) or not all(isinstance(k, str) and isinstance(v, str) for k, v in slots.items()):
        raise LLMResponseError("slots must be an object of string -> string")
    slots = dict(slots)

    area_text = reply["area_text"]
    if area_text is not None and not isinstance(area_text, str):
        raise LLMResponseError("area_text must be a string or null")
    # Models sometimes put the place in slots["area"]; the TaskSpec keeps it apart.
    if AREA_KEY in slots:
        area_text = area_text or slots.pop(AREA_KEY)

    out_of_scope = reply["out_of_scope"]
    if out_of_scope is not None and out_of_scope not in OUT_OF_SCOPE_REASONS:
        raise LLMResponseError(f"unknown out_of_scope reason {out_of_scope!r}")

    return ParsedRequest(
        category=category,
        slots=slots,
        area_text=(area_text or "").strip() or None,
        out_of_scope=out_of_scope,
    )


class LLMRequestParser:
    """RequestParser backed by any LLMClient. The Planner checks everything it returns again."""

    def __init__(self, client: LLMClient):
        self._client = client

    async def parse(self, request_text: str, templates: dict[str, dict]) -> ParsedRequest:
        reply = await self._client.complete_json(system=build_system_prompt(templates), user=request_text)
        return parse_response(reply, templates)
