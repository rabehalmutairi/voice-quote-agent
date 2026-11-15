"""Text helpers for the evidence checker: Arabic normalization and whole-word matching.

Normalization reuses R1's `app.planner.text.normalize` (read-only import) so the planner
and the evidence checker agree on letter forms and digits. When R3's shared normalizer
lands in `eval/`, it can replace this one function.
"""

from __future__ import annotations

import re

from app.planner.text import normalize

# "1,200" / "١٬٢٠٠" -> "1200" before punctuation is turned into spaces.
_THOUSANDS_SEP = re.compile(r"(?<=[0-9٠-٩])[,٬](?=[0-9٠-٩]{3})")


def tokens(text: str) -> list[str]:
    """Normalized words of `text`: unified letter forms, western digits, no punctuation."""
    return normalize(_THOUSANDS_SEP.sub("", text)).split()


def contains_words(haystack: str, needle: str) -> bool:
    """True if `needle` appears in `haystack` as whole words, after normalization.

    The needle's words must appear as one contiguous run of the haystack's words, so
    "بخمسمية" doesn't match inside "بخمسمية وعشرين" partially, and "15" never matches "155".
    An empty needle never matches.
    """
    hay, need = tokens(haystack), tokens(needle)
    if not need or len(need) > len(hay):
        return False
    width = len(need)
    return any(hay[i : i + width] == need for i in range(len(hay) - width + 1))
