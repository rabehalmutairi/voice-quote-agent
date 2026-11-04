"""The one part of planning that needs language understanding: reading the user's request.

Everything else (which questions to ask, what is missing, building and checking the
TaskSpec) is plain code driven by the templates, in `planner.py`.

Two implementations of `RequestParser`:
- `app.mocks.planner.MockRequestParser`: deterministic keyword lexicon, for tests and demos.
- `app.planner.llm.LLMRequestParser`: a strong LLM in JSON mode, once we have a key.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol


@dataclass(frozen=True)
class ParsedRequest:
    """What a parser read from the request text. It never decides what is missing."""

    category: str | None
    """Template name the request belongs to, or None if no template fits."""

    slots: dict[str, str] = field(default_factory=dict)
    """Planner-question keys (except `area`) the text answers, with the user's words."""

    area_text: str | None = None
    """The place the user mentioned ("حي الملقا"), if any. Resolved to coordinates later."""

    out_of_scope: str | None = None
    """Set when the request asks for something we never do: one of OUT_OF_SCOPE_REASONS."""


# Things the product never does (architecture §2). Kept here, not in templates,
# because they apply to every category. code -> (English for logs, Arabic for the user).
OUT_OF_SCOPE_REASONS = {
    "booking": (
        "We only ask shops questions. We never book, reserve or order anything for you.",
        "نقدر نسأل المحلات بس، ما نحجز ولا نطلب شي عنك.",
    ),
    "payment": (
        "We never pay or share payment details.",
        "ما ندفع ولا نشارك معلومات الدفع.",
    ),
    "personal_info": (
        "We never share your personal information with shops.",
        "ما نشارك معلوماتك الشخصية مع المحلات.",
    ),
    "medical": (
        "Hospitals and clinics are out of scope.",
        "المستشفيات والعيادات خارج نطاق الخدمة.",
    ),
    "hotel": (
        "Hotels are out of scope.",
        "الفنادق خارج نطاق الخدمة.",
    ),
    "diagnosis": (
        "We can't diagnose problems over the phone. Ask about a specific repair or part.",
        "ما نقدر نشخّص المشكلة بالتلفون. اسأل عن تصليح أو قطعة محددة.",
    ),
}


class RequestParser(Protocol):
    async def parse(self, request_text: str, templates: dict[str, dict]) -> ParsedRequest:
        """Read `request_text`. `templates` maps category name to template (every known one)."""
        ...
