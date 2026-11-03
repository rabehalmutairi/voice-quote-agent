"""Planner: a user's request -> a valid TaskSpec, follow-up questions, or a clear refusal.

How it works:
1. Check the inputs (text, up to 2 custom questions, area, max_businesses).
2. Ask the injected `RequestParser` which category the request is and which slots it answers.
   This is the only step that needs language understanding (mock now, LLM later).
3. From the category's template, work out which planner questions are still unanswered.
4. Build the TaskSpec and validate it against contracts/task_spec.schema.json.

Nothing category-specific lives here: the questions, their keys and their Arabic wording
all come from /templates. Adding a category is a new YAML file, not a code change.

The planner never raises for bad user input or a failing parser. It returns a PlanResult
whose `status` says what happened and whose `error` says why.
"""

from __future__ import annotations

import copy
import logging
import math
import uuid
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from datetime import datetime
from typing import Protocol

from app.contracts import contract_errors, load_templates, timestamp, validate
from app.planner.parser import OUT_OF_SCOPE_REASONS, ParsedRequest, RequestParser

log = logging.getLogger(__name__)

# Committed categories (architecture §2). car_repair is the Gate C stretch: pass it in
# `enabled_categories` only after Gate C says go.
DEFAULT_ENABLED_CATEGORIES = ("electronics_repair", "stock_check")

AREA_KEY = "area"  # the planner question whose answer fills TaskSpec.area instead of slots
MAX_CUSTOM_QUESTIONS = 2
MAX_REQUEST_CHARS = 1000
MAX_ANSWER_CHARS = 200
MAX_QUESTION_CHARS = 300


class AreaResolver(Protocol):
    async def resolve(self, text: str) -> dict | None:
        """Turn a place name ("حي الملقا") into a TaskSpec `area` object, or None if unknown."""
        ...


# PlanResult.status values
READY = "ready"  # complete TaskSpec, can be started
NEEDS_INPUT = "needs_input"  # TaskSpec saved with missing_slots; ask `questions` first
REJECTED = "rejected"  # understood, but we don't do this (out of scope / category off)
INVALID = "invalid"  # the caller sent bad input (an HTTP 422 for R5)
ERROR = "error"  # our side failed (parser down, bug); safe to retry later


@dataclass(frozen=True)
class PlanError:
    code: str
    message: str
    message_ar: str | None = None  # set when the message is meant for the end user


@dataclass(frozen=True)
class PlanResult:
    status: str
    task_spec: dict | None = None
    questions: list[dict] = field(default_factory=list)  # [{key, ask_ar}], same shape as task.needs_input
    error: PlanError | None = None
    notes: list[str] = field(default_factory=list)  # hints for the UI, e.g. "area_not_found"

    @property
    def accepted(self) -> bool:
        """True when there is a TaskSpec to hand to the orchestrator."""
        return self.status in (READY, NEEDS_INPUT)

    def to_dict(self) -> dict:
        return {
            "status": self.status,
            "task_spec": copy.deepcopy(self.task_spec),
            "questions": copy.deepcopy(self.questions),
            "error": None if self.error is None else vars(self.error).copy(),
            "notes": list(self.notes),
        }


def _invalid(code: str, message: str) -> PlanResult:
    return PlanResult(status=INVALID, error=PlanError(code, message))


def _new_task_id() -> str:
    return f"tsk_{uuid.uuid4().hex[:12]}"


class Planner:
    def __init__(
        self,
        parser: RequestParser,
        area_resolver: AreaResolver,
        *,
        templates: dict[str, dict] | None = None,
        enabled_categories: Iterable[str] = DEFAULT_ENABLED_CATEGORIES,
        clock: Callable[[], datetime] | None = None,
        new_task_id: Callable[[], str] = _new_task_id,
    ):
        self._parser = parser
        self._areas = area_resolver
        self._templates = copy.deepcopy(templates) if templates is not None else load_templates()
        for template in self._templates.values():
            validate("template", template)
        self._enabled = tuple(enabled_categories)
        unknown = [c for c in self._enabled if c not in self._templates]
        if unknown:
            raise ValueError(f"enabled categories without a template: {unknown}")
        self._clock = clock
        self._new_task_id = new_task_id

    # -- public API ----------------------------------------------------------------

    async def plan(
        self,
        request_text: object,
        *,
        custom_questions: object = (),
        area: object = None,
        max_businesses: object = 3,
    ) -> PlanResult:
        """Turn a new request into a TaskSpec.

        `custom_questions`: up to 2 questions the user wrote, kept word for word.
        `area`: None (take it from the text or ask), a place name, or a ready
        TaskSpec `area` object (e.g. from a map pin in the UI).
        """
        if not isinstance(request_text, str) or not request_text.strip():
            return _invalid("empty_request", "request_text must be a non-empty string")
        text = request_text.strip()
        if len(text) > MAX_REQUEST_CHARS:
            return _invalid("request_too_long", f"request_text is longer than {MAX_REQUEST_CHARS} characters")

        questions, problem = _clean_custom_questions(custom_questions)
        if problem:
            return problem

        if isinstance(max_businesses, bool) or not isinstance(max_businesses, int) or not 1 <= max_businesses <= 3:
            return _invalid("invalid_max_businesses", "max_businesses must be an integer from 1 to 3")

        explicit_area, area_text = None, None
        if isinstance(area, dict):
            area_problem = _area_problem(area)
            if area_problem:
                return _invalid("invalid_area", area_problem)
            explicit_area = copy.deepcopy(area)
        elif isinstance(area, str):
            area_text = area.strip() or None
        elif area is not None:
            return _invalid("invalid_area", "area must be null, a place name, or an area object")

        try:
            parsed = await self._parser.parse(text, copy.deepcopy(self._templates))
        except Exception:  # the parser is an external dependency (LLM): never crash the request
            log.exception("request parser failed")
            return PlanResult(status=ERROR, error=PlanError("parser_failed", "the request parser failed; try again"))
        if not isinstance(parsed, ParsedRequest):
            return PlanResult(status=ERROR, error=PlanError("parser_failed", "the request parser returned no result"))

        if parsed.out_of_scope:
            message, message_ar = OUT_OF_SCOPE_REASONS.get(
                parsed.out_of_scope, ("This request is out of scope.", "هذا الطلب خارج نطاق الخدمة.")
            )
            code = parsed.out_of_scope if parsed.out_of_scope in OUT_OF_SCOPE_REASONS else "out_of_scope"
            return PlanResult(status=REJECTED, error=PlanError(code, message, message_ar))
        if parsed.category is None or parsed.category not in self._templates:
            return PlanResult(
                status=REJECTED,
                error=PlanError(
                    "unsupported_category",
                    "We handle electronics repair quotes and stock checks only.",
                    "حاليًا نقدر نسأل عن أسعار تصليح الأجهزة أو توفّر المنتجات بس.",
                ),
            )
        if parsed.category not in self._enabled:
            return PlanResult(
                status=REJECTED,
                error=PlanError(
                    "category_not_enabled",
                    f"{parsed.category} is not enabled yet.",
                    "هذي الخدمة غير متاحة حاليًا.",
                ),
            )

        template = self._templates[parsed.category]
        notes: list[str] = []
        resolved_area = explicit_area
        if resolved_area is None:
            resolved_area = await self._resolve_area(area_text or parsed.area_text, notes)

        spec = {
            "task_id": self._new_task_id(),
            "category": parsed.category,
            "request_text": text,
            "slots": _clean_slots(template, parsed.slots),
            "custom_questions": questions,
            "area": resolved_area,
            "max_businesses": max_businesses,
            "missing_slots": [],
            "created_at": timestamp(self._clock() if self._clock else None),
        }
        return self._finish(spec, template, notes)

    async def answer(self, task_spec: object, answers: object) -> PlanResult:
        """Fill missing slots with the user's answers to follow-up questions.

        `answers` maps planner-question keys to the user's words, e.g.
        {"area": "حي الملقا"} or {"device_model": "آيفون 15 برو"}. The area may also be
        an area object. Returns the updated TaskSpec (same task_id).
        """
        problems = contract_errors("task_spec", task_spec)
        if problems:
            return _invalid("invalid_task_spec", "; ".join(problems[:3]))
        template = self._templates.get(task_spec["category"])
        if template is None:
            return _invalid("unknown_category", f"no template named {task_spec['category']!r}")
        if not isinstance(answers, dict) or not answers:
            return _invalid("invalid_answers", "answers must be a non-empty object of question key -> answer")

        keys = {q["key"] for q in template["planner_questions"]}
        spec = copy.deepcopy(task_spec)
        notes: list[str] = []
        for key, value in answers.items():
            if key not in keys:
                return _invalid("unknown_answer_key", f"{key!r} is not a question for {spec['category']}")
            if key == AREA_KEY:
                if isinstance(value, dict):
                    area_problem = _area_problem(value)
                    if area_problem:
                        return _invalid("invalid_area", area_problem)
                    spec["area"] = copy.deepcopy(value)
                elif isinstance(value, str):
                    resolved = await self._resolve_area(value.strip() or None, notes)
                    if resolved is not None:
                        spec["area"] = resolved
                elif value is not None:
                    return _invalid("invalid_area", "area must be a place name or an area object")
            else:
                if value is None:
                    continue
                if not isinstance(value, str):
                    return _invalid("invalid_answers", f"answer to {key!r} must be text")
                if value.strip():
                    spec["slots"][key] = value.strip()[:MAX_ANSWER_CHARS]
        return self._finish(spec, template, notes)

    def questions_for(self, category: str, missing_slots: Iterable[str]) -> list[dict]:
        """The template's follow-up questions for these keys, in the template's order."""
        missing = set(missing_slots)
        return [
            {"key": q["key"], "ask_ar": q["ask_ar"]}
            for q in self._templates[category]["planner_questions"]
            if q["key"] in missing
        ]

    def template(self, category: str) -> dict:
        return copy.deepcopy(self._templates[category])

    # -- helpers ---------------------------------------------------------------------

    def _finish(self, spec: dict, template: dict, notes: list[str]) -> PlanResult:
        spec["missing_slots"] = [
            q["key"]
            for q in template["planner_questions"]
            if (spec["area"] is None if q["key"] == AREA_KEY else q["key"] not in spec["slots"])
        ]
        problems = contract_errors("task_spec", spec)
        if problems:  # a bug in this file, not the user's fault
            log.error("planner built an invalid TaskSpec: %s", problems)
            return PlanResult(status=ERROR, error=PlanError("internal_error", "planner built an invalid TaskSpec"))
        status = NEEDS_INPUT if spec["missing_slots"] else READY
        return PlanResult(
            status=status,
            task_spec=spec,
            questions=self.questions_for(spec["category"], spec["missing_slots"]),
            notes=notes,
        )

    async def _resolve_area(self, text: str | None, notes: list[str]) -> dict | None:
        if not text:
            return None
        try:
            area = await self._areas.resolve(text)
        except Exception:
            log.exception("area resolver failed for %r", text)
            area = None
        if area is not None and _area_problem(area):
            log.error("area resolver returned an invalid area for %r: %s", text, _area_problem(area))
            area = None
        if area is None:
            notes.append("area_not_found")
        return copy.deepcopy(area)


def _clean_custom_questions(raw: object) -> tuple[list[str], PlanResult | None]:
    if raw is None:
        return [], None
    if isinstance(raw, str) or not isinstance(raw, (list, tuple)):
        return [], _invalid("invalid_custom_questions", "custom_questions must be a list of strings")
    questions = []
    for item in raw:
        if not isinstance(item, str):
            return [], _invalid("invalid_custom_questions", "custom_questions must be a list of strings")
        item = " ".join(item.split())
        if not item:
            continue  # an empty box in the UI is not a question
        if len(item) > MAX_QUESTION_CHARS:
            return [], _invalid("custom_question_too_long", f"a custom question is longer than {MAX_QUESTION_CHARS} characters")
        if item not in questions:
            questions.append(item)
    if len(questions) > MAX_CUSTOM_QUESTIONS:
        return [], _invalid("too_many_custom_questions", f"at most {MAX_CUSTOM_QUESTIONS} custom questions per task")
    return questions, None


def _clean_slots(template: dict, slots: dict) -> dict[str, str]:
    """Keep only non-empty answers to this template's planner questions (never `area`)."""
    allowed = {q["key"] for q in template["planner_questions"]} - {AREA_KEY}
    clean = {}
    for key, value in (slots or {}).items():
        if key in allowed and isinstance(value, str) and value.strip():
            clean[key] = value.strip()[:MAX_ANSWER_CHARS]
        elif key not in allowed:
            log.warning("parser returned slot %r, which %s doesn't ask for; dropped", key, template["category"])
    return clean


def _area_problem(area: object) -> str | None:
    """Why `area` is not a valid TaskSpec area object, or None if it is."""
    if not isinstance(area, dict):
        return "area must be an object"
    if set(area) != {"label", "lat", "lng", "radius_m"}:
        return "area needs exactly: label, lat, lng, radius_m"
    if not isinstance(area["label"], str) or not area["label"].strip():
        return "area.label must be a non-empty string"
    for key, low, high in (("lat", -90, 90), ("lng", -180, 180)):
        value = area[key]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
            return f"area.{key} must be a number from {low} to {high}"
    radius = area["radius_m"]
    if isinstance(radius, bool) or not isinstance(radius, int) or not 100 <= radius <= 50000:
        return "area.radius_m must be an integer from 100 to 50000"
    return None
