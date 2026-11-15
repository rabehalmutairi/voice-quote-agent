"""Read the numbers a shop said: "بألف ومتين" -> 1200, "الأسود ١٢٨ بثلاثة آلاف وأربعمية" -> [128, 3400].

The evidence checker uses this to confirm that a price really is in its evidence quote.
It uses R3's shared parser (`eval/numbers.py`), so the evidence check and the evaluation
read numbers the same way. That parser also reads digits joined to a word or a currency,
which speech-to-text often writes: "بـ٤٥٠ ريال", "450ريال", "٣٠٠ر.س".

The tests in tests/extraction/test_numbers.py pin the behaviour the evidence check needs.
"""

from __future__ import annotations

from eval.numbers import number_in_text, parse_numbers

__all__ = ["number_in_text", "parse_numbers"]
