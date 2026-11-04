"""Arabic/English text normalization shared by the planner, its policy check and the mocks."""

from __future__ import annotations

import re

_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")
_MARKS = re.compile(r"[ً-ْٰـ]")  # Arabic diacritics + tatweel


def western_digits(text: str) -> str:
    """Arabic-Indic and Persian digits -> 0-9."""
    return text.translate(_DIGITS)


def normalize(text: str) -> str:
    """Make Arabic/English text comparable: unify letter forms and digits, drop punctuation."""
    text = _MARKS.sub("", western_digits(text).lower())
    text = re.sub("[إأآ]", "ا", text).replace("ة", "ه").replace("ى", "ي")
    text = re.sub(r"[^\w\s]", " ", text)
    return " ".join(text.split())


def contains_phrase(normalized_text: str, normalized_phrase: str) -> bool:
    """Phrase search on normalized text. Arabic words may carry prefixes (ال، ب، و), so only
    Latin letters and digits mark a word boundary: "آيفون 15" must not match "آيفون 155"."""
    pattern = rf"(?<![0-9a-z]){re.escape(normalized_phrase)}(?![0-9a-z])"
    return re.search(pattern, normalized_text) is not None
