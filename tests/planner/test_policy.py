"""Outbound content policy: nothing the user typed may make the agent book, pay, or share
personal data. Best-effort by design (see app/planner/policy.py); these tests pin what
it does catch, and that ordinary questions still pass."""

import pytest
from conftest import CUSTOM_QUESTION, run

from app.mocks import MockAreaResolver, MockRequestParser
from app.planner import ParsedRequest, Planner
from app.planner.policy import BOOKING, PAYMENT, PERSONAL_INFO, check_outbound, check_outbound_text

COMPLETE = "أبي أغير شاشة آيفون 15 برو في الملقا"


@pytest.mark.parametrize(
    "text, reason",
    [
        # actions for the user
        ("احجز لي موعد بكرة", BOOKING),
        ("احجزوه لي لين أجي", BOOKING),
        ("خلوه لي لين المغرب", BOOKING),
        ("please book it for tomorrow", BOOKING),
        ("can you reserve one for me", BOOKING),
        ("أبي أدفع العربون الحين", PAYMENT),
        ("I will pay the deposit now", PAYMENT),
        # phone numbers in every common shape, Western and Arabic-Indic digits
        ("اتصلوا على 0551234567", PERSONAL_INFO),
        ("رقمي ٠٥٥١٢٣٤٥٦٧", PERSONAL_INFO),
        ("+966 55 123 4567", PERSONAL_INFO),
        ("00966551234567", PERSONAL_INFO),
        ("055-123-4567", PERSONAL_INFO),
        # other long numbers: national ID, IBAN, IMEI
        ("هويتي 1012345678", PERSONAL_INFO),
        ("SA03 8000 0000 6080 1016 7519", PERSONAL_INFO),
        ("IMEI 356938035643809", PERSONAL_INFO),
        # email
        ("راسلوني على ahmed.k@example.com", PERSONAL_INFO),
        ("my email is a@b.co", PERSONAL_INFO),
        # phrases that introduce personal details
        ("اسمي محمد وأبي أعرف السعر", PERSONAL_INFO),
        ("عنواني حي النرجس", PERSONAL_INFO),
        ("اتصلوا علي إذا خلص", PERSONAL_INFO),
        ("my name is Sara", PERSONAL_INFO),
        ("call me when it's ready", PERSONAL_INFO),
    ],
)
def test_blocked(text, reason):
    issue = check_outbound_text(text)
    assert issue is not None and issue.reason == reason


@pytest.mark.parametrize(
    "text",
    [
        CUSTOM_QUESTION,
        "هل يحتاج موعد ولا أجي على طول؟",  # asking ABOUT appointments is fine
        "تقبلون الدفع بالبطاقة؟",  # asking ABOUT payment is fine
        "Do I need to book an appointment?",
        "عندكم آيفون 16 برو 256 جيجا؟",
        "السعر أقل من 1200 ريال؟",
        "فيه ضمان سنة؟",
        "يصلحون شاشة جوالي قدامي؟",
        "سامسونج جالكسي S24",
        "ماك بوك اير M4",
        "كم ياخذ وقت؟ ساعة ولا ساعتين؟",
    ],
)
def test_ordinary_questions_pass(text):
    assert check_outbound_text(text) is None


def test_issue_detail_never_repeats_the_personal_data():
    issue = check_outbound_text("رقمي 0551234567")
    assert "0551234567" not in issue.detail


def test_check_outbound_names_every_bad_field():
    problems = check_outbound({"device_model": "0551234567", "repair_type": "الشاشة"}, ["سؤال عادي؟", "احجز لي"])
    assert [field for field, _ in problems] == ["device_model", "custom_questions[1]"]


# -- the planner refuses instead of passing it on ---------------------------------------------


def planner(parser=None):
    return Planner(parser or MockRequestParser(), MockAreaResolver())


@pytest.mark.parametrize(
    "questions, index",
    [
        (["احجز لي موعد بكرة"], 0),
        ([CUSTOM_QUESTION, "اتصلوا علي على 0551234567"], 1),
        (["راسلوني على a@b.com"], 0),
    ],
)
def test_unsafe_custom_question_is_invalid_and_named(questions, index):
    result = run(planner().plan(COMPLETE, custom_questions=questions))
    assert result.status == "invalid"
    assert result.task_spec is None
    assert result.error.code == "unsafe_custom_question"
    assert result.error.field == f"custom_questions[{index}]"
    assert result.error.message_ar
    assert "0551234567" not in result.error.message


def test_unsafe_follow_up_answer_is_invalid_and_spec_unchanged():
    p = planner()
    first = run(p.plan("تصليح جوالي"))
    result = run(p.answer(first.task_spec, {"device_model": "آيفون 15، رقمي 0551234567", "area": "الملقا"}))
    assert (result.status, result.error.code, result.error.field) == ("invalid", "unsafe_answer", "device_model")
    assert first.task_spec["slots"] == {}  # nothing was saved


def test_booking_hidden_in_an_answer_is_refused():
    p = planner()
    first = run(p.plan("تصليح جوالي"))
    result = run(p.answer(first.task_spec, {"repair_type": "الشاشة واحجزوه لي"}))
    assert result.error.code == "unsafe_answer"


def test_unsafe_slot_copied_by_the_parser_is_refused():
    class LeakyParser:  # e.g. an LLM that copies the user's number into a slot
        async def parse(self, text, templates):
            return ParsedRequest(category="electronics_repair",
                                 slots={"device_model": "آيفون 15 0551234567", "repair_type": "الشاشة"})

    result = run(planner(LeakyParser()).plan("أي شي"))
    assert (result.status, result.error.code, result.error.field) == ("invalid", "unsafe_answer", "device_model")


def test_safe_request_is_unaffected():
    result = run(planner().plan(COMPLETE, custom_questions=[CUSTOM_QUESTION, "هل يحتاج موعد؟"]))
    assert result.status == "ready"
