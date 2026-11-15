"""R6Extractor: CallResult -> Quote with an LLM in JSON mode, then the evidence checker.

Everything except the HTTP call is here and tested on fake replies. When we get an LLM
key, write a small client with this one method (same shape as the planner's, so one
client can serve both) and pass it in:

    class MyLLMClient:
        async def complete_json(self, *, system: str, user: str) -> dict:
            ...  # call the API in JSON mode with an async client; return the parsed object

    extractor = R6Extractor(MyLLMClient())

Never commit the key: read it from .env. Use an async HTTP client (or asyncio.to_thread):
a blocking call would freeze the orchestrator's event loop (integration.md §2).

Pipeline per call: prompt -> model reply -> `parse_reply` (strict shape, fills contract
nulls, one answer per custom question) -> `verify_quote` (template + evidence checks +
contract). The model is never trusted: a value survives only if the shop's own words,
in a shop turn, support it.
"""

from __future__ import annotations

import json
import logging
from typing import Protocol

from app.extraction.evidence import NOT_MENTIONED, not_mentioned, verify_quote

log = logging.getLogger(__name__)

STATUSES = ("found", "not_mentioned", "refused", "unclear")
FIELD_KEYS = ("status", "value", "value_min", "value_max", "confidence", "evidence_quote", "evidence_turn")
REPLY_KEYS = {"offers", "fields", "answers"}


class LLMClient(Protocol):
    async def complete_json(self, *, system: str, user: str) -> dict:
        """Send one system + user message, return the model's reply parsed as a JSON object."""
        ...


class ExtractionError(ValueError):
    """The model's reply doesn't have the shape we asked for. The orchestrator excludes the shop."""


# -- prompt -----------------------------------------------------------------------------

_FIELD_SHAPE = {
    "status": "found | not_mentioned | refused | unclear",
    "value": "the value (found + exact only), else null",
    "value_min": "lower bound if the shop gave a range (found only), else null",
    "value_max": "upper bound if the shop gave a range (found only), else null",
    "confidence": "0 to 1; null only when not_mentioned",
    "evidence_quote": "the shop's exact words copied from ONE shop turn; null only when not_mentioned",
    "evidence_turn": "the number of that shop turn; null only when not_mentioned",
}


def _describe_field(name: str, definition: dict) -> str:
    kind = definition["type"]
    if kind == "choice":
        return f"{name}: one of {definition['choices']}"
    if kind == "number":
        return f"{name}: number in {definition.get('unit', 'plain units')}"
    if kind == "boolean":
        return f"{name}: true or false"
    return f"{name}: short text in the shop's words"


def build_system_prompt(template: dict) -> str:
    """Extraction instructions generated from the template, so a new category needs no prompt edit."""
    fields = template["fields"]
    lines = [
        "You read the transcript of one phone call between our agent and a shop in Saudi Arabia",
        "(Saudi Arabic or English) and record what the SHOP said. Reply with ONE JSON object only.",
        "",
        "Rules:",
        "- Use only what the shop said. Never guess, never use general knowledge, never use the agent's words.",
        "- Every value needs evidence: copy the shop's exact words from one turn whose speaker is shop,",
        "  and give that turn's number. The agent repeating a price back is NOT evidence.",
        "- If the shop didn't say it, use status not_mentioned with every other key null.",
        "- refused: the shop declined to say (e.g. 'come to the shop'). unclear: said but ambiguous.",
        "  Both still need evidence, and value stays null.",
        "- Convert units but keep the original words as evidence: 'شهر' -> 30 days, '3 شهور' -> 90 days,",
        "  'سنة' -> 365 days, 'ساعة لساعتين' -> value_min 60, value_max 120 minutes. Prices in SAR as numbers.",
        "- A number is either an exact value or a range, never both.",
        "- One entry in offers per option the shop quoted (e.g. original vs commercial part, each variant).",
        "",
        "Per-option fields (inside each item of offers):",
        *[f"  {_describe_field(name, fields[name])}" for name in template["offer_fields"]],
        "Whole-call fields (inside fields):",
        *[f"  {_describe_field(name, fields[name])}" for name in template["quote_fields"]],
        "",
        "Each field value has this shape:",
        json.dumps(_FIELD_SHAPE, ensure_ascii=False, indent=2),
        "",
        "Reply shape:",
        json.dumps(
            {
                "offers": [{"<per-option field>": "<field value>"}],
                "fields": {"<whole-call field>": "<field value>"},
                "answers": [
                    {
                        "question_index": "index of the user's question",
                        "status": "found | not_mentioned | refused | unclear",
                        "summary_ar": "one or two short Arabic sentences of what the shop said; null if not_mentioned",
                        "evidence": [{"quote": "the shop's exact words", "turn": "shop turn number"}],
                    }
                ],
            },
            ensure_ascii=False,
            indent=2,
        ),
    ]
    return "\n".join(lines)


def build_user_message(call_result: dict, task_spec: dict) -> str:
    """The numbered transcript, plus the user's own questions to answer."""
    lines = ["Transcript (turn number, speaker, words):"]
    lines += [f"[{turn['i']}] {turn['speaker']}: {turn['text']}" for turn in call_result["transcript"]]
    lines.append("")
    if task_spec["custom_questions"]:
        lines.append("The user's own questions (answer each in `answers`, by question_index):")
        lines += [f"{index}. {question}" for index, question in enumerate(task_spec["custom_questions"])]
    else:
        lines.append("The user asked no questions of their own: answers must be [].")
    return "\n".join(lines)


# -- reply parsing ----------------------------------------------------------------------


def _number(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def parse_field(raw: object, where: str) -> dict:
    """One field from the model, made contract-shaped. Anything unusable becomes not_mentioned."""
    if not isinstance(raw, dict) or raw.get("status") not in STATUSES:
        log.warning("%s: unusable field from the model, treated as not_mentioned: %r", where, raw)
        return not_mentioned()
    status = raw["status"]
    if status == NOT_MENTIONED:
        return not_mentioned()

    quote, turn = raw.get("evidence_quote"), raw.get("evidence_turn")
    if not isinstance(quote, str) or not quote.strip() or not isinstance(turn, int) or isinstance(turn, bool) or turn < 0:
        log.warning("%s: %s without evidence, treated as not_mentioned", where, status)
        return not_mentioned()  # no quote, no value
    confidence = raw.get("confidence")
    confidence = min(1.0, max(0.0, float(confidence))) if _number(confidence) else 0.5

    field = {
        "value": None, "value_min": None, "value_max": None, "status": status,
        "confidence": confidence, "evidence_quote": quote.strip(), "evidence_turn": turn,
    }
    if status != "found":
        return field
    value, low, high = raw.get("value"), raw.get("value_min"), raw.get("value_max")
    if value is not None:
        field["value"] = value  # exact wins if the model sent both
    elif _number(low) and _number(high):
        field["value_min"], field["value_max"] = low, high
    else:
        log.warning("%s: found with no value, treated as not_mentioned", where)
        return not_mentioned()
    return field


def _parse_answers(raw_answers: list, questions: list[str]) -> list[dict]:
    by_index = {}
    for raw in raw_answers:
        if isinstance(raw, dict) and isinstance(raw.get("question_index"), int):
            by_index.setdefault(raw["question_index"], raw)

    answers = []
    for index, question in enumerate(questions):
        raw = by_index.get(index, {})
        empty = {"question_index": index, "question": question, "status": NOT_MENTIONED, "summary_ar": None, "evidence": []}
        status, summary = raw.get("status"), raw.get("summary_ar")
        evidence = [
            {"quote": item["quote"].strip(), "turn": item["turn"]}
            for item in raw.get("evidence") or []
            if isinstance(item, dict)
            and isinstance(item.get("quote"), str) and item["quote"].strip()
            and isinstance(item.get("turn"), int) and not isinstance(item["turn"], bool) and item["turn"] >= 0
        ]
        if status in STATUSES and status != NOT_MENTIONED and isinstance(summary, str) and summary.strip() and evidence:
            answers.append({**empty, "status": status, "summary_ar": summary.strip(), "evidence": evidence})
        else:
            answers.append(empty)
    return answers


def parse_reply(reply: object, call_result: dict, task_spec: dict) -> dict:
    """Turn the model's JSON into a Quote (before the template and evidence checks).

    Raises ExtractionError if the reply's overall shape is wrong. Individual fields that
    are unusable become not_mentioned instead, so one bad value doesn't lose the quote.
    """
    if not isinstance(reply, dict):
        raise ExtractionError("reply is not a JSON object")
    if set(reply) != REPLY_KEYS:
        raise ExtractionError(f"reply keys must be exactly {sorted(REPLY_KEYS)}, got {sorted(reply)}")
    offers, fields, answers = reply["offers"], reply["fields"], reply["answers"]
    if not isinstance(offers, list) or not all(isinstance(o, dict) for o in offers):
        raise ExtractionError("offers must be a list of objects")
    if not isinstance(fields, dict):
        raise ExtractionError("fields must be an object")
    if not isinstance(answers, list):
        raise ExtractionError("answers must be a list")

    parsed_offers = []
    for index, offer in enumerate(offers):
        parsed = {key: parse_field(raw, f"offers[{index}].{key}") for key, raw in offer.items() if isinstance(key, str)}
        if any(field["status"] != NOT_MENTIONED for field in parsed.values()):
            parsed_offers.append(parsed)  # an option with nothing said about it isn't an option
    return {
        "call_id": call_result["call_id"],
        "task_id": call_result["task_id"],
        "place_id": call_result["place_id"],
        "offers": parsed_offers,
        "fields": {key: parse_field(raw, f"fields.{key}") for key, raw in fields.items() if isinstance(key, str)},
        "answers": _parse_answers(answers, task_spec["custom_questions"]),
        "evidence_issues": [],
    }


# -- the Extractor ----------------------------------------------------------------------


class R6Extractor:
    """The Extractor the orchestrator calls (app/orchestrator/interfaces.py)."""

    def __init__(self, client: LLMClient):
        self._client = client

    async def extract(self, call_result: dict, task_spec: dict, template: dict) -> dict:
        reply = await self._client.complete_json(
            system=build_system_prompt(template),
            user=build_user_message(call_result, task_spec),
        )
        quote = parse_reply(reply, call_result, task_spec)
        return verify_quote(quote, call_result, template)
