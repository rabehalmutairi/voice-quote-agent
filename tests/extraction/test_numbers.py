"""Arabic number parsing for the price evidence check."""

import pytest

from app.extraction.numbers import number_in_text, parse_numbers


@pytest.mark.parametrize(
    "text, expected",
    [
        # every price in contracts/examples and app/mocks/fixtures/calls.yaml
        ("الأصلي بألف ومتين", [1200]),
        ("والتجاري بأربعمية وخمسين", [450]),
        ("الشاشة الأصلية بألف ومية وخمسين", [1150]),
        ("والتجارية بأربعمية وثمانين", [480]),
        ("تجاري بس، بخمسمية وعشرين", [520]),
        ("الأسود ١٢٨ بثلاثة آلاف وأربعمية", [128, 3400]),
        ("والأبيض ٢٥٦ بثلاثة آلاف وتسعمية", [256, 3900]),
        ("الـ ١٢٨ بثلاثة آلاف وثلاثمية", [128, 3300]),
        ("أربعة آلاف ومتين", [4200]),
        ("ستمية", [600]),
        # other spoken forms
        ("ثلاث مية ريال", [300]),
        ("الفين وخمسمية", [2500]),
        ("عشرين ألف", [20000]),
        ("خمسطعش", [15]),
        ("السعر 450 ريال", [450]),
        ("السعر ١٬٢٠٠ ريال", [1200]),
        ("3 آلاف", [3000]),
        ("من ٤٠٠ لـ ٥٠٠", [400, 500]),
        ("من أربعمية لخمسمية", [400, 500]),
        ("من ألف لألفين", [1000, 2000]),
        ("خمسة وعشرين", [25]),
        ("مية وخمسين ألف", [150000]),
        ("ما عندي سعر الحين", []),
        # hundreds after a small number, and a standalone "و"
        ("خمسطعش مية", [1500]),
        ("اطنعش مية ريال", [1200]),
        ("ألف و خمسمية", [1500]),
        ("15 مية", [1500]),
        # halves and quarters
        ("ألف ونص", [1500]),
        ("ميتين ونص", [250]),
        ("مية ونص", [150]),
        ("ثلاثة آلاف ونص", [3500]),
        ("الفين ونص", [2500]),
        ("1000 ونص", [1500]),
        ("ألف وربع", [1250]),
        ("عشرين ونص", [20.5]),
        ("نص ساعة بس", []),                       # a half on its own is not a number
        ("ساعة ونص", []),                          # "hour and a half" is not a price
        # English fallback
        ("four hundred and fifty riyals", [450]),
        ("Four Hundred Fifty", [450]),
        ("twelve hundred", [1200]),
        ("one thousand two hundred", [1200]),
        ("a hundred and twenty", [120]),
        ("twenty-five", [25]),
        ("two thousand and a half", [2500]),
        ("one and a half", [1.5]),
        ("1.2k", [1200]),
        ("it's 5K for the new phone", [5000]),
        ("between 400 and 500", [400, 500]),
        ("the original is 1,200 and the copy is four fifty", [1200, 450]),
        ("one fifty", [150]),
        ("twelve fifty", [1250]),
        ("nine ninety nine", [999]),
        ("four and fifty", [54]),                  # joined by "and": not the colloquial form
    ],
)
def test_parse_numbers(text, expected):
    assert parse_numbers(text) == expected


def test_number_in_text():
    assert number_in_text(1200, "الأصلي بألف ومتين")
    assert not number_in_text(1100, "الأصلي بألف ومتين")
    assert not number_in_text(15, "آيفون 155")
