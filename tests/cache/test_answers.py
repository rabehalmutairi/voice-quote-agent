import asyncio
import json
from datetime import datetime, timedelta
from pathlib import Path

import pytest

from app.cache.answers import AnswerCache
from app.cache.demo import _demo

EXAMPLES = Path(__file__).resolve().parents[2] / "contracts/examples"


def example(name):
    return json.loads((EXAMPLES / f"{name}.json").read_text(encoding="utf-8"))


@pytest.fixture
def sample():
    return tuple(example(name) for name in ("task_spec", "business", "call_result", "quote"))


def test_reuse_keeps_original_date_ids_and_evidence_without_extending_expiry(sample):
    task, shop, call, quote = sample
    recorded_at = datetime.fromisoformat(call["started_at"])
    now = recorded_at + timedelta(hours=1)
    cache = AnswerCache(clock=lambda: now)
    assert cache.remember(task, shop, call, quote)

    repeated = {**task, "task_id": "tsk_02"}
    saved = cache.get(repeated, shop)
    assert saved.recorded_at == recorded_at
    assert saved.quote == quote
    assert saved.call_result == call
    saved.quote["offers"].clear()
    assert cache.get(repeated, shop).quote == quote

    now = recorded_at + timedelta(hours=24)
    assert cache.get(repeated, shop) is None


@pytest.mark.parametrize(
    ("task_change", "shop_change"),
    [
        ({"custom_questions": ["هل عندكم ضمان على الشاشة؟"]}, {}),
        ({"slots": {"device_model": "آيفون 16 برو", "repair_type": "الشاشة"}}, {}),
        ({"slots": {"device_model": "آيفون 15 برو", "repair_type": "البطارية"}}, {}),
        ({"category": "stock_check"}, {}),
        ({}, {"place_id": "ChIJexample02"}),
        ({}, {"phone_e164": "+966500000099"}),
    ],
)
def test_changed_request_or_shop_cannot_reuse_answer(sample, task_change, shop_change):
    task, shop, call, quote = sample
    cache = AnswerCache(clock=lambda: datetime.fromisoformat(call["started_at"]))
    assert cache.remember(task, shop, call, quote)

    assert cache.get({**task, **task_change}, {**shop, **shop_change}) is None


@pytest.mark.parametrize("issue", ["unanswered", "wrong_evidence", "failed_call", "missing_field"])
def test_unusable_answers_do_not_enter_cache(sample, issue):
    task, shop, call, quote = sample
    cache = AnswerCache(clock=lambda: datetime.fromisoformat(call["started_at"]))
    if issue == "unanswered":
        quote["answers"][0].update(status="not_mentioned", summary_ar=None, evidence=[])
    elif issue == "wrong_evidence":
        quote["answers"][0]["evidence"][0]["turn"] = 12  # The agent's question.
    elif issue == "failed_call":
        call["outcome"] = "no_answer"
    else:
        quote["offers"][1].pop("price_sar")
    assert not cache.remember(task, shop, call, quote)
    assert cache.get(task, shop) is None


def test_demo_uses_mock_calls_on_misses_only(capsys):
    asyncio.run(_demo())
    output = capsys.readouterr().out
    counts = [line.strip() for line in output.splitlines() if "New simulated calls:" in line]
    assert counts == ["New simulated calls: 1", "New simulated calls: 0", "New simulated calls: 1"]
    assert "Reused answer from " in output
    assert "Original shop words: تقعد وتشوفه قدامك" in output
