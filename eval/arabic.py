"""Shared Arabic and English text comparison for R3 and extraction."""

from __future__ import annotations

import re
import unicodedata

from app.planner.text import normalize as planner_normalize
from app.planner.text import western_digits

# Remove valid grouping separators before tokenizing, and keep decimals intact.
_GROUPED = re.compile(r"(?<![0-9.,٬٫])[0-9]{1,3}(?:[,٬][0-9]{3})+(?![0-9])")
_DECIMAL = re.compile(r"[0-9]+\.[0-9]+")


def normalize_digits(text: str) -> str:
    """Unify decimal digits and numeric separators without changing word boundaries."""
    text = western_digits(unicodedata.normalize("NFKC", text))
    return _GROUPED.sub(lambda match: match[0].replace(",", "").replace("٬", ""), text).replace("٫", ".")


def normalize(text: str) -> str:
    """Normalize letters, digits and punctuation while retaining complete decimal tokens."""
    parts = re.split(r"([0-9]+\.[0-9]+)", normalize_digits(text))
    return " ".join(
        normalized for part in parts
        if (normalized := part if _DECIMAL.fullmatch(part) else planner_normalize(part))
    )


def tokens(text: str) -> list[str]:
    return normalize(text).split()


def contains_words(haystack: str, needle: str) -> bool:
    """Check for a contiguous run of whole normalized words."""
    words, phrase = tokens(haystack), tokens(needle)
    return bool(phrase) and any(
        words[i : i + len(phrase)] == phrase
        for i in range(len(words) - len(phrase) + 1)
    )
