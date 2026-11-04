"""Mock RequestParser and AreaResolver: deterministic, offline, for tests and demos.

They recognise the phrasings in fixtures/planner_lexicon.yaml and nothing else. A request
they don't recognise is "unsupported", even if a person would understand it. That's on
purpose: tests must be repeatable. Real language understanding is LLMRequestParser's job.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import yaml

from app.planner.parser import ParsedRequest
from app.planner.text import contains_phrase as _matches
from app.planner.text import normalize

LEXICON_PATH = Path(__file__).parent / "fixtures" / "planner_lexicon.yaml"


@lru_cache(maxsize=1)
def _lexicon() -> dict:
    raw = yaml.safe_load(LEXICON_PATH.read_text(encoding="utf-8"))
    return {
        "out_of_scope": {code: [normalize(w) for w in words] for code, words in raw["out_of_scope"].items()},
        "categories": [(c["category"], [normalize(w) for w in c["keywords"]]) for c in raw["categories"]],
        "slots": {
            key: [(v["value"], [normalize(p) for p in v["match"]]) for v in values]
            for key, values in raw["slots"].items()
        },
        "radius_m": raw["areas"]["radius_m"],
        "areas": [
            ({"label": a["label"], "lat": a["lat"], "lng": a["lng"]}, [normalize(p) for p in a["match"]])
            for a in raw["areas"]["known"]
        ],
    }


def _longest_match(text: str, options: list[tuple[object, list[str]]]):
    best, best_len = None, 0
    for value, patterns in options:
        for pattern in patterns:
            if len(pattern) > best_len and _matches(text, pattern):
                best, best_len = value, len(pattern)
    return best


class MockRequestParser:
    async def parse(self, request_text: str, templates: dict[str, dict]) -> ParsedRequest:
        lexicon = _lexicon()
        text = normalize(request_text)

        for code, words in lexicon["out_of_scope"].items():
            if any(_matches(text, w) for w in words):
                return ParsedRequest(category=None, out_of_scope=code)

        category = next(
            (name for name, words in lexicon["categories"] if name in templates and any(_matches(text, w) for w in words)),
            None,
        )
        area = _longest_match(text, lexicon["areas"])
        area_text = area["label"] if area else None
        if category is None:
            return ParsedRequest(category=None, area_text=area_text)

        slots = {}
        for question in templates[category]["planner_questions"]:  # the template decides the slots
            options = lexicon["slots"].get(question["key"])
            if options:
                value = _longest_match(text, options)
                if value:
                    slots[question["key"]] = value
        return ParsedRequest(category=category, slots=slots, area_text=area_text)


class MockAreaResolver:
    """Knows a few Riyadh districts (approximate centres). Unknown places resolve to None."""

    async def resolve(self, text: str) -> dict | None:
        lexicon = _lexicon()
        area = _longest_match(normalize(text), lexicon["areas"])
        if area is None:
            return None
        return {**area, "radius_m": lexicon["radius_m"]}
