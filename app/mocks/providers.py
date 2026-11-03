"""Mock providers for every external service the orchestrator uses. Offline, free, deterministic.

    MockDiscovery       (stands in for R5's Places search)
    MockCallProvider    (stands in for R4 + R2: Twilio + ElevenLabs)
    MockRetryPolicy     (stands in for R4's retry rules)
    MockExtractor       (stands in for R6's LLM extraction + evidence checker)
    MockComparator      (stands in for R6's comparison; NOT like-for-like, cheapest price only)
    InMemoryEventSink   (stands in for R5's Postgres + SSE)

Everything they return passes the contracts. They know nothing about real shops: data
comes from fixtures/calls.yaml and contracts/examples/. Never use them for metrics.
"""

from __future__ import annotations

import asyncio
import copy
import json
import re
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path

import yaml

from app.contracts import CONTRACTS_DIR, timestamp

CALLS_PATH = Path(__file__).parent / "fixtures" / "calls.yaml"
EXAMPLES_DIR = CONTRACTS_DIR / "examples"
FAKE_NUMBER = re.compile(r"^\+9665000000\d\d$")  # the only numbers mock mode will ever "call"


class MockSafetyError(RuntimeError):
    """Mock mode was asked to do something only a real provider could (e.g. a real number)."""


# -- fixture loading ---------------------------------------------------------------------


def _example(name: str) -> dict:
    return json.loads((EXAMPLES_DIR / f"{name}.json").read_text(encoding="utf-8"))


def _evidence_field(spec: object) -> dict:
    """Expand the compact fixture form into a full evidence-backed field."""
    if spec == "not_mentioned":
        return {"value": None, "value_min": None, "value_max": None, "status": "not_mentioned",
                "confidence": None, "evidence_quote": None, "evidence_turn": None}
    status = spec.get("status", "found")
    return {
        "value": spec.get("value") if status == "found" else None,
        "value_min": spec.get("min"),
        "value_max": spec.get("max"),
        "status": status,
        "confidence": spec.get("confidence", 0.9),
        "evidence_quote": spec["quote"],
        "evidence_turn": spec["turn"],
    }


@lru_cache(maxsize=1)
def _fixtures() -> dict:
    raw = yaml.safe_load(CALLS_PATH.read_text(encoding="utf-8"))
    businesses = [_example("business") if b.get("from_contract_example") else b for b in raw["businesses"]]
    for business in businesses:
        if not FAKE_NUMBER.match(business["phone_e164"]):
            raise MockSafetyError(f"fixture number {business['phone_e164']} is not a +9665000000NN fake number")

    scripts: dict[str, dict[str, dict]] = {}
    for category, shops in raw["scripts"].items():
        scripts[category] = {}
        for place_id, script in shops.items():
            if script.get("from_contract_example"):
                result, quote = _example("call_result"), _example("quote")
                scripts[category][place_id] = {
                    "outcome": result["outcome"],
                    "language_final": result["language_final"],
                    "transcript": result["transcript"],
                    "offers": quote["offers"],
                    "fields": quote["fields"],
                    "answers": [{k: v for k, v in a.items() if k != "question_index"} for a in quote["answers"]],
                }
                continue
            scripts[category][place_id] = {
                "outcome": script["outcome"],
                "language_final": script.get("language_final", "ar"),
                "transcript": [
                    {"i": i, "speaker": speaker, "t": t, "text": text}
                    for i, (speaker, t, text) in enumerate(script["transcript"])
                ],
                "offers": [{k: _evidence_field(v) for k, v in offer.items()} for offer in script["offers"]],
                "fields": {k: _evidence_field(v) for k, v in script["fields"].items()},
                "answers": script["answers"],
            }
    return {"businesses": businesses, "scripts": scripts}


def mock_businesses() -> list[dict]:
    """The 3 fictional shops, as Business objects."""
    return copy.deepcopy(_fixtures()["businesses"])


def mock_script(category: str, place_id: str) -> dict:
    """The scripted call for one shop in one category (transcript + the quote it supports)."""
    try:
        return copy.deepcopy(_fixtures()["scripts"][category][place_id])
    except KeyError:
        raise MockSafetyError(f"no mock script for {category} / {place_id}") from None


# -- providers ---------------------------------------------------------------------------


class MockDiscovery:
    def __init__(self, businesses: list[dict] | None = None, *, delay_s: float = 0.0):
        self.businesses = mock_businesses() if businesses is None else copy.deepcopy(businesses)
        self.delay_s = delay_s
        self.requests: list[dict] = []

    async def find_businesses(self, task_spec: dict, limit: int) -> list[dict]:
        self.requests.append({"task_id": task_spec["task_id"], "limit": limit})
        await asyncio.sleep(self.delay_s)
        return copy.deepcopy(self.businesses[:limit])


# What a mock shop does when called. "script" plays its scripted conversation.
SCRIPT = "script"
HANG = "hang"  # never answers: the orchestrator's call timeout must stop it
ERROR = "error"  # the provider raises, like a network error
NO_ANSWER_THEN_SCRIPT = "no_answer_then_script"  # first attempt no answer, retry succeeds
FAILED_OUTCOMES = {"voicemail", "ivr", "no_answer", "busy", "hung_up", "wrong_business", "failed"}


class MockCallProvider:
    """Plays scripted calls. Refuses any number that isn't one of the fixture shops.

    `behaviours` maps place_id -> SCRIPT | HANG | ERROR | NO_ANSWER_THEN_SCRIPT | a failed
    outcome ("no_answer", "busy", "voicemail", ...). `delays` maps place_id -> seconds the
    call "lasts", so concurrency is visible. Records every CallJob it received in `jobs`.
    """

    def __init__(
        self,
        behaviours: dict[str, str] | None = None,
        *,
        delays: dict[str, float] | None = None,
        clock: Callable[[], datetime] | None = None,
    ):
        self.behaviours = dict(behaviours or {})
        for behaviour in self.behaviours.values():
            if behaviour not in {SCRIPT, HANG, ERROR, NO_ANSWER_THEN_SCRIPT} | FAILED_OUTCOMES:
                raise ValueError(f"unknown mock behaviour {behaviour!r}")
        self.delays = dict(delays or {})
        self._clock = clock or (lambda: datetime.now(timezone.utc))
        self._allowed = {b["phone_e164"]: b["place_id"] for b in mock_businesses()}
        self.jobs: list[dict] = []
        self.in_flight = 0
        self.max_in_flight = 0

    async def place_call(self, call_job: dict) -> dict:
        number = call_job["to_number"]
        if not FAKE_NUMBER.match(number) or self._allowed.get(number) != call_job["place_id"]:
            raise MockSafetyError(f"mock mode refuses to call {number}: not a fixture shop")
        self.jobs.append(copy.deepcopy(call_job))
        behaviour = self.behaviours.get(call_job["place_id"], SCRIPT)
        if behaviour == NO_ANSWER_THEN_SCRIPT:
            behaviour = "no_answer" if call_job["attempt"] == 1 else SCRIPT

        self.in_flight += 1
        self.max_in_flight = max(self.max_in_flight, self.in_flight)
        try:
            if behaviour == HANG:
                await asyncio.Event().wait()  # forever, until cancelled
            await asyncio.sleep(self.delays.get(call_job["place_id"], 0.0))
            if behaviour == ERROR:
                raise ConnectionError("mock provider error")
            if behaviour == SCRIPT:
                return self._scripted(call_job)
            return self._failed(call_job, behaviour)
        finally:
            self.in_flight -= 1

    def _base(self, job: dict) -> dict:
        return {
            "call_id": job["call_id"],
            "task_id": job["task_id"],
            "place_id": job["place_id"],
            "cost_usd": 0.0,  # mocks cost nothing; real providers report their cost
            "pre_arranged": False,
            "scenario_id": f"mock_{job['template']}",  # marks the data as mock, never a real shop
        }

    def _scripted(self, job: dict) -> dict:
        script = mock_script(job["template"], job["place_id"])
        started = self._clock() - timedelta(seconds=script["transcript"][-1]["t"] + 3)
        return {
            **self._base(job),
            "conversation_id": f"conv_mock_{job['call_id']}",
            "outcome": script["outcome"],
            "started_at": timestamp(started),
            "duration_s": script["transcript"][-1]["t"] + 3,
            "language_final": script["language_final"],
            "transcript": script["transcript"],
        }

    def _failed(self, job: dict, outcome: str) -> dict:
        connected = outcome in {"voicemail", "ivr", "hung_up", "wrong_business"}
        return {
            **self._base(job),
            "conversation_id": f"conv_mock_{job['call_id']}" if connected else None,
            "outcome": outcome,
            "started_at": timestamp(self._clock()) if connected else None,
            "duration_s": 8 if connected else 0,
            "language_final": None,
            "transcript": [],
        }


class MockRetryPolicy:
    """Retries once after `delay_s` when nobody answered. R4's real policy waits 10 minutes
    and checks calling hours; this one only shows that a policy plugs in."""

    def __init__(self, delay_s: float = 0.05):
        self.delay_s = delay_s

    def retry_delay_s(self, call_job: dict, call_result: dict | None) -> float | None:
        if call_result is None or call_result["outcome"] in {"no_answer", "busy"}:
            return self.delay_s
        return None


class MockExtractor:
    """Returns the fixture quote for the scripted call. Does no reading of the transcript."""

    def __init__(self, *, delay_s: float = 0.0, fail_for: set[str] | None = None):
        self.delay_s = delay_s
        self.fail_for = set(fail_for or ())  # place_ids whose extraction raises
        self.calls: list[str] = []

    async def extract(self, call_result: dict, task_spec: dict, template: dict) -> dict:
        self.calls.append(call_result["call_id"])
        await asyncio.sleep(self.delay_s)
        if call_result["place_id"] in self.fail_for:
            raise RuntimeError("mock extraction failure")
        script = mock_script(task_spec["category"], call_result["place_id"])
        by_question = {a["question"]: a for a in script["answers"]}
        answers = []
        for index, question in enumerate(task_spec["custom_questions"]):
            answer = by_question.get(question)
            if answer:
                answers.append({"question_index": index, **copy.deepcopy(answer)})
            else:  # the script never answered this question
                answers.append({"question_index": index, "question": question, "status": "not_mentioned",
                                "summary_ar": None, "evidence": []})
        return {
            "call_id": call_result["call_id"],
            "task_id": call_result["task_id"],
            "place_id": call_result["place_id"],
            "offers": script["offers"],
            "fields": script["fields"],
            "answers": answers,
            "evidence_issues": [],
        }


class MockComparator:
    """Ranks shops by their lowest exact `price_sar`. Deliberately simple and NOT R6's
    like-for-like comparison (it ignores part type, warranty and condition)."""

    PRICE = "price_sar"

    async def compare(self, task_spec: dict, template: dict, quotes: list[dict], excluded: list[dict]) -> dict:
        excluded = copy.deepcopy(excluded)
        priced = []
        for quote in quotes:
            prices = [
                offer[self.PRICE]["value"]
                for offer in quote["offers"]
                if offer.get(self.PRICE, {}).get("status") == "found"
                and isinstance(offer[self.PRICE]["value"], (int, float))
            ]
            if prices:
                priced.append((min(prices), quote["place_id"]))
            else:
                excluded.append({"place_id": quote["place_id"], "reason": "no exact price given"})
        priced.sort(key=lambda item: item[0])  # stable: ties keep discovery order

        base = {"task_id": task_spec["task_id"], "excluded": excluded}
        if not priced:
            return {**base, "status": "cannot_compare", "basis": None, "ranking": [],
                    "cannot_compare_reasons": ["no shop gave an exact price"]}
        return {
            **base,
            "status": "partial" if excluded else "ranked",
            "basis": "lowest quoted price (mock comparator, not like-for-like)",
            "ranking": [
                {"place_id": place_id, "rank": rank, "reason": f"lowest quoted price: {price:g} SAR"}
                for rank, (price, place_id) in enumerate(priced, start=1)
            ],
            "cannot_compare_reasons": [],
        }


@dataclass
class InMemoryEventSink:
    """Keeps every event in a list. `on_event` (optional) is called for each, e.g. to print."""

    events: list[dict] = field(default_factory=list)
    on_event: Callable[[dict], None] | None = None

    async def publish(self, event: dict) -> None:
        self.events.append(copy.deepcopy(event))
        if self.on_event:
            self.on_event(event)

    def for_task(self, task_id: str) -> list[dict]:
        return [e for e in self.events if e["task_id"] == task_id]
