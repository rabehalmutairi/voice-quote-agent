"""Short-lived cache of usable shop answers, with original evidence."""

from collections import OrderedDict
from collections.abc import Callable
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from app.contracts import contract_errors, get_template

CacheKey = tuple[str, str, str, tuple[tuple[str, str], ...], tuple[str, ...]]


def _key(task: dict, shop: dict) -> CacheKey:
    return (
        shop["place_id"], shop["phone_e164"], task["category"],
        tuple(sorted(task["slots"].items())), tuple(task["custom_questions"]),
    )


def _eligible(task: dict, result: dict, quote: dict) -> bool:
    if contract_errors("call_result", result) or contract_errors("quote", quote):
        return False
    if result["outcome"] not in {"human_completed", "human_partial"} or quote["evidence_issues"]:
        return False
    if (quote["task_id"], quote["place_id"], quote["call_id"]) != (
        task["task_id"], result["place_id"], result["call_id"],
    ) or result["task_id"] != task["task_id"]:
        return False

    turns = {turn["i"]: turn["text"] for turn in result["transcript"] if turn["speaker"] == "shop"}

    def has_evidence(words: str | None, turn: int | None) -> bool:
        return bool(words and words in turns.get(turn, ""))

    def found(fields: dict) -> set[str]:
        return {
            name for name, value in fields.items()
            if value["status"] == "found"
            and has_evidence(value["evidence_quote"], value["evidence_turn"])
        }

    required = set(get_template(task["category"])["required_fields"])
    common = found(quote["fields"])
    if not any(required <= common | found(offer) for offer in quote["offers"] or [{}]):
        return False

    answers = quote["answers"]
    questions = task["custom_questions"]
    return len(answers) == len(questions) and all(
        answer["question_index"] == index
        and answer["question"] == question
        and answer["status"] == "found"
        and all(has_evidence(item["quote"], item["turn"]) for item in answer["evidence"])
        for index, (answer, question) in enumerate(zip(answers, questions))
    )


@dataclass(frozen=True)
class SavedAnswer:
    recorded_at: datetime
    quote: dict
    call_result: dict


class AnswerCache:
    """Process-local cache. Use a separate instance for each provider mode."""

    def __init__(
        self,
        *,
        ttl: timedelta = timedelta(hours=24),
        max_entries: int = 256,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        if ttl <= timedelta(0) or max_entries < 1:
            raise ValueError("Cache TTL and size must be positive")
        self.ttl = ttl
        self.max_entries = max_entries
        self._clock = clock or (lambda: datetime.now(timezone.utc))
        self._answers: OrderedDict[CacheKey, SavedAnswer] = OrderedDict()

    def get(self, task: dict, shop: dict) -> SavedAnswer | None:
        key = _key(task, shop)
        saved = self._answers.get(key)
        if saved is None:
            return None
        if self._clock() - saved.recorded_at >= self.ttl:
            del self._answers[key]
            return None
        self._answers.move_to_end(key)
        return deepcopy(saved)

    def remember(self, task: dict, shop: dict, result: dict, quote: dict) -> bool:
        if not _eligible(task, result, quote) or result["place_id"] != shop["place_id"]:
            return False
        if result["started_at"] is None:
            return False
        recorded_at = datetime.fromisoformat(result["started_at"].replace("Z", "+00:00"))
        age = self._clock() - recorded_at
        if not timedelta(0) <= age < self.ttl:
            return False

        key = _key(task, shop)
        existing = self._answers.get(key)
        if existing is not None and existing.recorded_at >= recorded_at:
            return False
        self._answers[key] = SavedAnswer(recorded_at, deepcopy(quote), deepcopy(result))
        self._answers.move_to_end(key)
        if len(self._answers) > self.max_entries:
            self._answers.popitem(last=False)
        return True
