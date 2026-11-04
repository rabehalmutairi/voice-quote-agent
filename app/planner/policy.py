"""What may be said to a shop on the user's behalf (architecture §2 and §11).

Everything the user writes that can reach a CallJob (custom questions and slot values,
which become `dynamic_variables`) is checked here, by the planner and again by the
orchestrator before any call. A violation is refused with a clear reason, never
silently edited.

Blocked:
- **Actions for the user**: asking the shop to book, reserve, hold, order or take a payment.
  Questions *about* a policy are fine ("هل يحتاج موعد؟", "تقبلون الدفع بالبطاقة؟").
- **Personal data**: phone numbers and other long digit runs (IDs, IBANs, IMEIs, cards),
  email addresses, and phrases that introduce personal details ("اسمي", "رقمي", "my email").

This is a best-effort, deterministic first line, NOT complete PII protection. It will miss
a name given without "اسمي", an address, or a number spelled out in words. The other
lines of defence: the voice agent's instructions (R2) never share personal data or accept
an action whatever its variables say; and an LLM screen can be added here when we have
a key (`check_outbound_text` is the single place to extend).
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.planner.text import contains_phrase, normalize, western_digits

# Reason codes match OUT_OF_SCOPE_REASONS in parser.py, which holds the user-facing messages.
BOOKING, PAYMENT, PERSONAL_INFO = "booking", "payment", "personal_info"

# Imperatives that ask the shop to DO something for the user. Nouns like "موعد" or "حجز"
# alone are not here: asking whether an appointment is needed is a fair question.
_ACTION_PHRASES = {
    BOOKING: [
        "احجز", "احجزوا", "احجزلي", "احجزوه", "احجزوها", "احجزولي",
        "اطلبوه لي", "اطلبوها لي", "اطلبوا لي", "خلوه لي", "خلوها لي", "ثبتوا لي",
        "book it", "book me", "book one", "book for me", "reserve it", "reserve one",
        "reserve for me", "hold it for me", "order it for me", "order one for me",
    ],
    PAYMENT: ["ادفع", "ادفعوا", "ادفعلكم", "i will pay", "pay for it", "pay them", "pay the deposit"],
    PERSONAL_INFO: [
        "اسمي", "رقمي", "رقم جوالي", "عنواني", "ايميلي", "بريدي", "هويتي",
        "رقم الهويه", "اقامتي", "اتصلوا علي", "كلموني", "تواصلوا معي",
        "my name", "my number", "my phone number", "my email", "my address", "my id",
        "call me", "contact me", "text me",
    ],
}
_NORMALIZED_PHRASES = {reason: [normalize(p) for p in phrases] for reason, phrases in _ACTION_PHRASES.items()}

_EMAIL = re.compile(r"[^\s@]+@[^\s@]+\.[^\s@]{2,}")
# 7+ digits, allowing spaces, dashes, dots or brackets between them, with an optional + or 00.
# Device models ("15", "S24"), storage ("256") and prices ("1200") have far fewer digits.
_LONG_NUMBER = re.compile(r"(?:\+|00)?\d(?:[\s\-.()]*\d){6,}")


@dataclass(frozen=True)
class PolicyIssue:
    reason: str  # BOOKING | PAYMENT | PERSONAL_INFO
    detail: str  # what was found, for logs and developers (never echoes the personal data)


def check_outbound_text(text: str) -> PolicyIssue | None:
    """The first problem in a piece of text that would be said to a shop, or None."""
    digits = western_digits(text)
    if _EMAIL.search(digits):
        return PolicyIssue(PERSONAL_INFO, "an email address")
    if _LONG_NUMBER.search(digits):
        return PolicyIssue(PERSONAL_INFO, "a phone or ID number (7+ digits)")
    normalized = normalize(text)
    for reason, phrases in _NORMALIZED_PHRASES.items():
        if any(contains_phrase(normalized, phrase) for phrase in phrases):
            return PolicyIssue(reason, f"a {reason.replace('_', ' ')} request")
    return None


def check_outbound(slots: dict[str, str], custom_questions: list[str]) -> list[tuple[str, PolicyIssue]]:
    """Every problem in what would become a CallJob's `dynamic_variables` and `custom_questions`.
    Returns (field, issue) pairs; field is the slot key or "custom_questions[i]"."""
    problems = []
    for key, value in slots.items():
        issue = check_outbound_text(value)
        if issue:
            problems.append((key, issue))
    for index, question in enumerate(custom_questions):
        issue = check_outbound_text(question)
        if issue:
            problems.append((f"custom_questions[{index}]", issue))
    return problems
