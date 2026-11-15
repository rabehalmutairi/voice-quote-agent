"""The evidence checker: no quote, no value (architecture §3, contracts/README "rules a schema cannot check").

    quote = verify_quote(quote, call_result, template)

does, in order:

1. `enforce_template`: values must fit the category template. A value of the wrong type,
   a choice not in the template's list, a range on a non-number or an upside-down range
   is dropped (set to `not_mentioned`) and logged. A key the template doesn't define, or
   one in the wrong place (a per-call field inside an offer), is removed. Missing template
   keys are filled in as `not_mentioned`, so every required field is always present.
   The `evidence_issues` reasons in the contract are about evidence only, so these
   template problems are logged as warnings, not recorded there.
2. `check_evidence`: for every value that claims evidence (`found`, `refused`, `unclear`)
   and every custom-answer evidence item:
     - the quote must appear, as whole words after Arabic normalization, in transcript
       turn `evidence_turn`                                  -> else `quote_not_found`
     - that turn must be a **shop** turn (the agent repeating a price back is not
       evidence)                                             -> else `quote_in_agent_turn`
     - for prices (template unit `SAR`) that were `found`, the number itself must be
       said in the quote (`value`, or both `value_min` and `value_max`)
                                                             -> else `number_not_in_quote`
   A failing value is replaced by `not_mentioned` and recorded in `evidence_issues`.
   A custom answer loses each failing evidence item; with none left it becomes
   `not_mentioned` (summary removed), since an unsupported summary can't be shown.
3. The result is validated against the Quote contract.

Every function returns a new Quote and never changes its input.
"""

from __future__ import annotations

import copy
import logging

from app.contracts import validate
from app.extraction.arabic import contains_words
from app.extraction.numbers import number_in_text

log = logging.getLogger(__name__)

QUOTE_NOT_FOUND = "quote_not_found"
QUOTE_IN_AGENT_TURN = "quote_in_agent_turn"
NUMBER_NOT_IN_QUOTE = "number_not_in_quote"

# Template units whose numbers must be said in the quote. Other numbers (warranty days,
# minutes) are converted from words like "شهر" or "ساعتين", so they can't be checked this way.
NUMBER_CHECKED_UNITS = frozenset({"SAR"})

SHOP = "shop"
NOT_MENTIONED = "not_mentioned"
FOUND = "found"


def not_mentioned() -> dict:
    """An evidence-backed field with nothing in it."""
    return {
        "value": None, "value_min": None, "value_max": None, "status": NOT_MENTIONED,
        "confidence": None, "evidence_quote": None, "evidence_turn": None,
    }


# -- 1. template ------------------------------------------------------------------------


def field_problem(field: dict, definition: dict) -> str | None:
    """Why this value doesn't fit its template definition, or None if it fits."""
    if field.get("status") != FOUND:
        return None
    kind, value = definition["type"], field.get("value")
    low, high = field.get("value_min"), field.get("value_max")
    if low is not None or high is not None:
        if kind != "number":
            return "only a number can be a range"
        if low is None or high is None:
            return "a range needs both bounds"
        if low > high:
            return "value_min is above value_max"
        return None
    if kind == "number":
        if isinstance(value, bool) or not isinstance(value, (int, float)) or value < 0:
            return f"expected a non-negative number, got {value!r}"
    elif kind == "choice":
        if value not in definition["choices"]:
            return f"{value!r} is not one of {definition['choices']}"
    elif kind == "text":
        if not isinstance(value, str) or not value.strip():
            return f"expected text, got {value!r}"
    elif kind == "boolean":
        if not isinstance(value, bool):
            return f"expected true/false, got {value!r}"
    return None


def template_problems(quote: dict, template: dict) -> list[str]:
    """Everything in `quote` that doesn't fit `template`. Empty means it fits."""
    problems = []
    fields = template["fields"]

    def check(where: str, key: str, field: dict, allowed: list[str]) -> None:
        if key not in fields:
            problems.append(f"{where}: unknown field {key!r}")
        elif key not in allowed:
            problems.append(f"{where}: {key!r} is not allowed here")
        else:
            problem = field_problem(field, fields[key])
            if problem:
                problems.append(f"{where}: {problem}")

    seen = set()
    for index, offer in enumerate(quote["offers"]):
        for key, field in offer.items():
            seen.add(key)
            check(f"offers[{index}].{key}", key, field, template["offer_fields"])
    for key, field in quote["fields"].items():
        seen.add(key)
        check(f"fields.{key}", key, field, template["quote_fields"])
    if quote["offers"]:  # a shop that quoted nothing has no offers (the schema allows it)
        missing = [key for key in template["required_fields"] if key not in seen]
    else:
        missing = [key for key in template["required_fields"] if key in template["quote_fields"] and key not in seen]
    problems += [f"required field {key!r} is missing" for key in missing]
    return problems


def enforce_template(quote: dict, template: dict) -> dict:
    """Make `quote` fit `template`: drop what doesn't fit, fill in what's missing."""
    quote = copy.deepcopy(quote)
    fields = template["fields"]

    def clean(where: str, values: dict, allowed: list[str]) -> dict:
        result = {}
        for key, field in values.items():
            if key not in allowed:
                log.warning("%s: removed %r (not a field allowed here by %s)", where, key, template["category"])
                continue
            problem = field_problem(field, fields[key])
            if problem:
                log.warning("%s.%s dropped: %s", where, key, problem)
                field = not_mentioned()
            result[key] = field
        for key in allowed:
            result.setdefault(key, not_mentioned())
        return {key: result[key] for key in allowed}  # template order, for stable output

    quote["offers"] = [
        clean(f"offers[{index}]", offer, template["offer_fields"]) for index, offer in enumerate(quote["offers"])
    ]
    quote["fields"] = clean("fields", quote["fields"], template["quote_fields"])
    return quote


# -- 2. evidence ------------------------------------------------------------------------


def quote_problem(text: object, turn_index: object, turns: dict[int, dict]) -> str | None:
    """Is `text` really what the shop said in turn `turn_index`? None if yes, else the reason."""
    turn = turns.get(turn_index) if isinstance(turn_index, int) and not isinstance(turn_index, bool) else None
    if turn is None or not isinstance(text, str) or not contains_words(turn["text"], text):
        return QUOTE_NOT_FOUND
    if turn["speaker"] != SHOP:
        return QUOTE_IN_AGENT_TURN
    return None


def evidence_problem(name: str, field: dict, turns: dict[int, dict], template: dict) -> str | None:
    """The evidence_issues reason for one evidence-backed value, or None if it is supported."""
    if field["status"] == NOT_MENTIONED:
        return None
    problem = quote_problem(field["evidence_quote"], field["evidence_turn"], turns)
    if problem:
        return problem
    definition = template["fields"].get(name, {})
    if field["status"] == FOUND and definition.get("unit") in NUMBER_CHECKED_UNITS:
        said = field["evidence_quote"]
        numbers = [field["value"]] if field["value"] is not None else [field["value_min"], field["value_max"]]
        if not all(isinstance(n, (int, float)) and number_in_text(n, said) for n in numbers):
            return NUMBER_NOT_IN_QUOTE
    return None


def check_evidence(quote: dict, call_result: dict, template: dict) -> dict:
    """Drop every value whose evidence isn't in a shop turn; record why in `evidence_issues`."""
    if quote["call_id"] != call_result["call_id"]:
        raise ValueError(f"quote is for {quote['call_id']}, transcript is for {call_result['call_id']}")
    quote = copy.deepcopy(quote)
    turns = {turn["i"]: turn for turn in call_result["transcript"]}
    issues = list(quote["evidence_issues"])

    def check_values(values: dict, option_index: int | None) -> None:
        for name, field in values.items():
            reason = evidence_problem(name, field, turns, template)
            if reason:
                values[name] = not_mentioned()
                issues.append({"field": name, "option_index": option_index, "reason": reason})

    for index, offer in enumerate(quote["offers"]):
        check_values(offer, index)
    check_values(quote["fields"], None)

    for index, answer in enumerate(quote["answers"]):
        kept = []
        for item in answer["evidence"]:
            reason = quote_problem(item["quote"], item["turn"], turns)
            if reason:
                issues.append({"field": "answers", "option_index": index, "reason": reason})
            else:
                kept.append(item)
        answer["evidence"] = kept
        if answer["status"] != NOT_MENTIONED and not kept:
            answer["status"], answer["summary_ar"] = NOT_MENTIONED, None

    quote["evidence_issues"] = issues
    return quote


# -- 3. both ----------------------------------------------------------------------------


def verify_quote(quote: dict, call_result: dict, template: dict) -> dict:
    """Template check, then evidence check, then the Quote contract. Returns a new Quote."""
    checked = check_evidence(enforce_template(quote, template), call_result, template)
    return validate("quote", checked)
