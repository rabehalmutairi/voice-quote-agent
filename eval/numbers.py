"""Read spoken Saudi Arabic and English prices, quantities and other numbers."""

from __future__ import annotations

import math
import re

from eval.arabic import normalize, normalize_digits

# Normalized spellings, including common Saudi variants.
_UNITS = {
    "صفر": 0, "واحد": 1, "واحده": 1, "وحده": 1, "اثنين": 2, "ثنين": 2, "اثنان": 2,
    "اثنتان": 2, "اثنتين": 2,
    "ثلاث": 3, "ثلاثه": 3, "اربع": 4, "اربعه": 4, "خمس": 5, "خمسه": 5,
    "ست": 6, "سته": 6, "سبع": 7, "سبعه": 7, "ثمان": 8, "ثمانيه": 8,
    "ثمنيه": 8, "تسع": 9, "تسعه": 9, "عشر": 10, "عشره": 10,
    "احدعش": 11, "احدعشر": 11, "اطنعش": 12, "اثنعش": 12,
    "ثلطعش": 13, "ثلاثطعش": 13, "ثلتعش": 13, "اربعطعش": 14, "اربعتعش": 14,
    "خمسطعش": 15, "خمستعش": 15, "ستطعش": 16, "سطعش": 16,
    "سبعطعش": 17, "سبعتعش": 17, "ثمنطعش": 18, "ثمانطعش": 18,
    "تسعطعش": 19, "تسعتعش": 19,
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11,
    "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15, "sixteen": 16,
    "seventeen": 17, "eighteen": 18, "nineteen": 19,
}
_TENS = {
    "عشرين": 20, "عشرون": 20, "ثلاثين": 30, "اربعين": 40, "خمسين": 50,
    "ستين": 60, "سبعين": 70, "ثمانين": 80, "ثمنين": 80, "تسعين": 90,
    "ثلاثون": 30, "اربعون": 40, "خمسون": 50, "ستون": 60, "سبعون": 70,
    "ثمانون": 80, "تسعون": 90,
    "twenty": 20, "thirty": 30, "forty": 40, "fourty": 40, "fifty": 50,
    "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90,
}
_HUNDREDS = {
    "ميه": 100, "مئه": 100, "مايه": 100, "مائه": 100, "hundred": 100,
    "متين": 200, "ميتين": 200, "مئتين": 200, "مئتان": 200, "ميتان": 200,
    "ثلاثميه": 300, "ثلثميه": 300, "ثلاثمئه": 300, "اربعميه": 400,
    "اربعمئه": 400, "خمسميه": 500, "خمسمئه": 500, "ستميه": 600,
    "ستمئه": 600, "سبعميه": 700, "سبعمئه": 700, "ثمانميه": 800,
    "ثمنميه": 800, "ثمانمئه": 800, "تسعميه": 900, "تسعمئه": 900,
    "مائتان": 200, "مائتين": 200, "ثلاثمائه": 300, "اربعمائه": 400,
    "خمسمائه": 500, "ستمائه": 600, "سبعمائه": 700, "ثمانمائه": 800, "تسعمائه": 900,
}
_FRACTIONS = {"نص": 0.5, "نصف": 0.5, "half": 0.5, "ربع": 0.25, "quarter": 0.25}
_THOUSANDS = {"الف", "الاف", "thousand", "thousands"}
_VALUES = _UNITS | _TENS | _HUNDREDS | {"الفين": 2000, "الفان": 2000}
_CONNECTORS = {"و", "and", "a", "an"}
_PREFIXES = ("", "وب", "ول", "و", "ب", "ل", "ف")
_TEEN_STARTS = {
    "احد": "احدعشر", "احدي": "احدعشر", "اثنا": "اثنعش", "اثني": "اثنعش",
    "اثنتا": "اثنعش", "اثنتي": "اثنعش",
}
_TOKEN = re.compile(r"[0-9]+(?:\.[0-9]+)?(?:\s*k\b)?|[^\W\d_]+|[^\w\s]", re.IGNORECASE)


def _words(text: str):
    text = normalize_digits(text)
    # Normalize whole letter runs so Arabic combining marks stay with the word.
    text = re.sub(r"[ً-ْٰـ]", "", text.lower())
    text = re.sub(r"(?<=[a-z])-(?=[a-z])", " ", text)
    words = [match[0] if match[0][0].isdigit() else normalize(match[0]) for match in _TOKEN.finditer(text)]
    index = 0
    while index < len(words):
        token = words[index]
        if index + 1 < len(words) and words[index + 1] in {"عشر", "عشره"}:
            for prefix in _PREFIXES:
                if token.startswith(prefix) and token[len(prefix):] in _TEEN_STARTS:
                    token = prefix + _TEEN_STARTS[token[len(prefix):]]
                    index += 1
                    break
        yield token
        index += 1


def _word(token: str) -> tuple[str, str]:
    for prefix in _PREFIXES:
        if token.startswith(prefix):
            word = token[len(prefix) :]
            if word in _VALUES or word in _THOUSANDS or word in _FRACTIONS:
                return prefix, word
    return "", ""


def _occupied(current: float, value: int, word: str) -> bool:
    """Does the next additive part collide with a place already filled?"""
    if value >= 1000:
        return current != 0
    if value >= 100:
        return current % 1000 != 0
    tail = current % 100
    if value >= 20:
        return tail >= 10
    if value == 10 and word in {"عشر", "عشره"}:
        return tail >= 10
    return tail != 0 and (value >= 10 or tail % 10 != 0)


def parse_numbers(text: str, *, standalone_fractions: bool = False) -> list[float]:
    """Read numbers in order; opt into bare halves/quarters for the speech benchmark."""
    numbers: list[float] = []
    total = current = 0.0
    active = digits = joined = english_prefix = fraction_only = False

    def flush() -> None:
        nonlocal total, current, active, digits, joined, english_prefix, fraction_only
        if active and (standalone_fractions or not fraction_only):
            numbers.append(total + current)
        total = current = 0.0
        active = digits = joined = english_prefix = fraction_only = False

    for token in _words(text):
        if not token:
            flush()
            continue
        if token[0].isdigit():
            flush()
            current = float(token.removesuffix("k")) * (1000 if token.endswith("k") else 1)
            if not math.isfinite(current):
                raise ValueError("number exceeds supported range")
            active = digits = True
            continue
        if token in _CONNECTORS:
            joined = joined or token in {"and", "و"}
            english_prefix = False
            continue

        prefix, word = _word(token)
        if not word:
            flush()
            continue
        if prefix in {"ب", "وب", "ل", "ول", "ف"}:
            flush()
        connected = joined or prefix == "و"
        joined = False

        if word in _FRACTIONS:
            if active and connected:
                scale = 1
                if (total and not current) or (current >= 1000 and current % 1000 == 0):
                    scale = 1000
                elif current >= 100 and current % 100 == 0:
                    scale = 100
                current += _FRACTIONS[word] * scale
                flush()
            else:
                flush()
                current, active = _FRACTIONS[word], True
                fraction_only = True
            continue
        if word in _THOUSANDS:
            if total and not current:
                flush()
            total += (current if active and current else 1) * 1000
            current = 0
            active, digits, english_prefix = True, False, False
            fraction_only = False
            continue

        value = _VALUES[word]
        multiply = value == 100 and not connected and 0 < current < 100
        colloquial = english_prefix and word.isascii() and 10 <= value < 100
        if multiply:
            current *= 100
        elif colloquial:
            current = current * 100 + value
        else:
            if active and (
                (digits and (not connected or not current.is_integer()))
                or (not total and not current) or value == 0
                or (total and value >= 1000) or _occupied(current, value, word)
            ):
                flush()
            current += value
        active, digits = True, False
        fraction_only = False
        english_prefix = word.isascii() and 0 < value == current < 20 and not total
    flush()
    return numbers


def number_in_text(number: float, text: str) -> bool:
    return any(math.isclose(found, number, rel_tol=0, abs_tol=1e-9) for found in parse_numbers(text))
