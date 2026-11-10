"""Read the numbers a shop said: "بألف ومتين" -> 1200, "الأسود ١٢٨ بثلاثة آلاف وأربعمية" -> [128, 3400].

The evidence checker uses this to confirm that a price really is in its evidence quote.
R3 owns the shared Arabic number parser for the evaluation; until it is in `main`, this
small one covers spoken prices:

- Saudi Arabic: units, teens, tens, hundreds, thousands ("ألف ومية وخمسين" = 1150),
  "خمسطعش مية" = 1500, halves and quarters ("ألف ونص" = 1500, "ميتين ونص" = 250,
  "ألف وربع" = 1250);
- English (the agent's fallback language): "four hundred and fifty", "twelve hundred",
  "one thousand two hundred", "two thousand and a half", "1.2k", and colloquial prices
  ("four fifty" = 450, "twelve fifty" = 1250);
- digits, Arabic-Indic digits and thousands separators ("١٬٢٠٠", "1,200").

Swap `parse_numbers` for R3's when it lands; the tests stay the same.

Not handled (yet): other decimals ("1.5" alone), "إلا ربع" (a quarter less), and
"two and a half thousand".
"""

from __future__ import annotations

import re

from app.extraction.arabic import tokens
from app.planner.text import western_digits

# Normalized spellings (after app.planner.text.normalize: أإآ -> ا, ة -> ه, ى -> ي; lower case).
_UNITS = {
    "واحد": 1, "وحده": 1,
    "اثنين": 2, "ثنين": 2, "اثنان": 2,
    "ثلاث": 3, "ثلاثه": 3,
    "اربع": 4, "اربعه": 4,
    "خمس": 5, "خمسه": 5,
    "ست": 6, "سته": 6,
    "سبع": 7, "سبعه": 7,
    "ثمان": 8, "ثمانيه": 8, "ثمنيه": 8,
    "تسع": 9, "تسعه": 9,
    "عشر": 10, "عشره": 10,
    "احدعش": 11, "احدعشر": 11,
    "اطنعش": 12, "اثنعش": 12,
    "ثلطعش": 13, "ثلاثطعش": 13, "ثلتعش": 13,
    "اربعطعش": 14, "اربعتعش": 14,
    "خمسطعش": 15, "خمستعش": 15,
    "ستطعش": 16, "سطعش": 16,
    "سبعطعش": 17, "سبعتعش": 17,
    "ثمنطعش": 18, "ثمانطعش": 18,
    "تسعطعش": 19, "تسعتعش": 19,
    # English
    "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7,
    "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13,
    "fourteen": 14, "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18,
    "nineteen": 19,
}
_TENS = {
    "عشرين": 20, "ثلاثين": 30, "اربعين": 40, "خمسين": 50,
    "ستين": 60, "سبعين": 70, "ثمانين": 80, "ثمنين": 80, "تسعين": 90,
    "twenty": 20, "thirty": 30, "forty": 40, "fourty": 40, "fifty": 50,
    "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90,
}
_HUNDREDS = {
    "ميه": 100, "مئه": 100, "مايه": 100, "hundred": 100,
    "متين": 200, "ميتين": 200, "مئتين": 200, "مئتان": 200, "ميتان": 200,
    "ثلاثميه": 300, "ثلثميه": 300, "ثلاثمئه": 300,
    "اربعميه": 400, "اربعمئه": 400,
    "خمسميه": 500, "خمسمئه": 500,
    "ستميه": 600, "ستمئه": 600,
    "سبعميه": 700, "سبعمئه": 700,
    "ثمانميه": 800, "ثمنميه": 800, "ثمانمئه": 800,
    "تسعميه": 900, "تسعمئه": 900,
}
# "ألف" alone = 1000; "ثلاثة آلاف" / "three thousand" = 3 x 1000.
_THOUSAND_MULTIPLIERS = {"الف", "الاف", "thousand", "thousands"}
_FIXED = {"الفين": 2000}
# A fraction of the last place said: "ألف ونص" = 1500, "ميتين ونص" = 250.
_FRACTIONS = {"نص": 0.5, "نصف": 0.5, "half": 0.5, "ربع": 0.25, "quarter": 0.25}
# Words that join the parts of one number without ending it.
_CONNECTORS = {"و", "and", "a", "an"}

_VALUE, _HUNDRED, _THOUSAND, _FRACTION = "value", "hundred", "thousand", "fraction"

# Arabic words carry prefixes: و (and), ب (for/at), ف, ل, and combinations like "وب".
_PREFIXES = ("و", "ب", "ف", "ل", "وب", "فب", "ول")

# "1.2k" / "5 K" -> 1200 / 5000, before punctuation is dropped.
_THOUSANDS_K = re.compile(r"(\d+(?:[.٫]\d+)?)\s*k\b", re.IGNORECASE)


def _classify(word: str) -> tuple[str, float] | None:
    if word in _THOUSAND_MULTIPLIERS:
        return _THOUSAND, 1000
    if word in _HUNDREDS:
        return _HUNDRED, _HUNDREDS[word]
    if word in _FRACTIONS:
        return _FRACTION, _FRACTIONS[word]
    for table in (_UNITS, _TENS, _FIXED):
        if word in table:
            return _VALUE, table[word]
    return None


def _lookup(token: str) -> tuple[str, float, bool] | None:
    """(kind, value, joined) for the number word in `token`, trying it as is first, then
    without a prefix. `joined` is True when it starts with "و" (and): "ومية" adds 100,
    while a bare "مية" after a small number multiplies ("خمسطعش مية" = 1500)."""
    found = _classify(token)
    if found:
        return (*found, False)
    for prefix in _PREFIXES:
        if token.startswith(prefix) and len(token) > len(prefix):
            found = _classify(token[len(prefix) :])
            if found:
                return (*found, "و" in prefix)
    return None


def _starts_new_number(total: float, current: float, value: float) -> bool:
    """True if adding `value` would fill a place already taken: "أربعمية لخمسمية" is two
    numbers (400, 500), not 900. Units may come before tens ("خمسة وعشرين" = 25)."""
    if value >= 1000:
        return bool(total or current)
    if value >= 100:
        return current % 1000 >= 100 or current % 100 > 0
    tail = current % 100
    if value >= 20:
        return tail >= 20
    return tail != 0 and (tail < 20 or tail % 10 != 0)


def _fraction_unit(total: float, current: float) -> float:
    """What a half or quarter is a fraction of: the last place said."""
    if current == 0 and total > 0:
        return 1000  # "ثلاثة آلاف ونص" = 3500
    if current >= 1000 and current % 1000 == 0:
        return 1000  # "الفين ونص" = 2500, "1000 ونص" = 1500
    if current >= 100 and current % 100 == 0:
        return 100  # "ميتين ونص" = 250
    return 1  # "عشرين ونص" = 20.5


def _expand_k(text: str) -> str:
    def thousands(match: re.Match) -> str:
        value = float(match.group(1).replace("٫", ".")) * 1000
        return str(int(value)) if value.is_integer() else str(value)

    return _THOUSANDS_K.sub(thousands, text)


def parse_numbers(text: str) -> list[float]:
    """Every number in `text`, in order. Digit runs and spelled-out numbers both count.

    A spelled-out number is a run of number words ("ألف ومية وخمسين" = 1150), possibly
    joined by "و" / "and". Any other word ends it, and so does a word whose place is
    already filled ("من أربعمية لخمسمية" = 400, 500) or a half/quarter ("ألف ونص").
    A digit run is its own number unless a multiplier or fraction follows ("3 آلاف").
    """
    numbers: list[float] = []
    total = current = 0.0
    active = from_digits = last_small_english = False

    def flush() -> None:
        nonlocal total, current, active, from_digits
        if active:
            numbers.append(float(total + current))
        total = current = 0.0
        active = from_digits = False

    for token in tokens(_expand_k(western_digits(text))):
        if token.isdigit():
            flush()
            current, active, from_digits, last_small_english = float(token), True, True, False
            continue
        if token in _CONNECTORS:
            last_small_english = False  # "four and fifty" is not "four fifty"
            continue  # keeps an open number open; outside a number it means nothing
        word = _lookup(token)
        if word is None:
            flush()
            last_small_english = False
            continue
        kind, value, joined = word
        small_english, last_small_english = last_small_english, False

        if kind == _FRACTION:
            if active:  # "نص ساعة" on its own is not a price
                current += value * _fraction_unit(total, current)
                flush()
            continue

        if small_english and token.isascii() and kind == _VALUE and value >= 10 and total == 0:
            current = current * 100 + value  # "four fifty" = 450, "twelve fifty" = 1250
            continue

        multiplies = kind == _THOUSAND or (kind == _HUNDRED and value == 100 and not joined and 0 < current < 100)
        if from_digits and not multiplies:
            flush()  # "١٢٨ بثلاثة آلاف" is two numbers, not 131000
        elif not multiplies and kind != _THOUSAND and active and _starts_new_number(total, current, value):
            flush()
        from_digits = False
        if kind == _THOUSAND:
            total += (current or 1) * 1000
            current = 0.0
        elif multiplies:  # "ثلاث مية" = 300, "twelve hundred" = 1200
            current *= 100
        else:
            current += value
        active = True
        # An English unit or teen said on its own ("four", "twelve") may start a colloquial price.
        last_small_english = token.isascii() and kind == _VALUE and value < 20 and 0 < current < 20 and total == 0
    flush()
    return numbers


def number_in_text(number: float, text: str) -> bool:
    """True if `number` is one of the numbers said in `text`."""
    return any(abs(found - number) < 1e-9 for found in parse_numbers(text))
