import pytest

from app.mocks import mock_script
from app.mocks.providers import _fixtures
from eval.arabic import contains_words, normalize
from eval.numbers import number_in_text, parse_numbers


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("ثَلاثـمية وخمسين", [350]),
        ("الأصلي بألف ومتين، والتجاري بأربعمية وخمسين", [1200, 450]),
        ("الأسود ١٢٨ بثلاثة آلاف وأربعمية", [128, 3400]),
        ("السعر ١٬٢٠٠٫٥٠ والضريبة ۲۵.۵", [1200.5, 25.5]),
        ("١٬٢٣٤٬٥٦٧", [1234567]),
        ("من أربعمية لخمسمية", [400, 500]),
        ("خمسطعش مية", [1500]),
        ("ألف ونص", [1500]),
        ("الفين ونص", [2500]),
        ("مية وخمسين ألف", [150000]),
        ("خمسة وعشرين", [25]),
        ("خمسة عشر", [15]),
        ("ما عندي سعر الحين", []),
        ("a hundred and twenty", [120]),
        ("four fifty or 1.2k", [450, 1200]),
        ("one thousand two hundred", [1200]),
        ("between 400 and 500", [400, 500]),
        ("zero and 0", [0, 0]),
        ("صفر واثنين", [0, 2]),
        ("١٠٠٠ وميتين", [1200]),
        ("تجاري بخمسمية وعشرين", [520]),
        ("twenty-five", [25]),
        ("one and a half", [1.5]),
        ("400,5000", [400, 5000]),
        ("ألف، ألف", [1000, 1000]),
    ],
)
def test_numbers(text, expected):
    assert parse_numbers(text) == expected


def test_evidence_text_helpers():
    assert normalize(" آلـسَّعْر ١٬٢٠٠، و الضَّمَان ") == "السعر 1200 و الضمان"
    assert contains_words("السعر ١٬٢٠٠ رِيَال", "1200 ريال")
    assert not contains_words("السعر ١٬٢٠٠٫٥٠", "1200")
    assert not contains_words("آيفون 155", "ايفون 15")
    assert not contains_words("أي كلام", "؟")
    assert number_in_text(1200, "بألف ومتين")
    assert not number_in_text(15, "آيفون 155")


def test_prices_in_mock_quotes_are_recognized_in_their_evidence():
    for category, shops in _fixtures()["scripts"].items():
        for place_id in shops:
            for offer in mock_script(category, place_id)["offers"]:
                price = offer.get("price_sar")
                if price and price["status"] == "found":
                    expected = [price["value"]] if price["value"] is not None else [
                        price["value_min"], price["value_max"]
                    ]
                    for value in expected:
                        assert number_in_text(value, price["evidence_quote"])
