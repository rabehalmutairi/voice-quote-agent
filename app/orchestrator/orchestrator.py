"""Orchestrator: runs one task from TaskSpec to Comparison, calling up to 3 shops at once.

    submit(task_spec)  -> task.created (+ task.needs_input if slots are missing)
    answer(id, ...)    -> fills missing slots through the planner
    start(id)          -> runs it in the background: discovering -> calling -> extracting -> done | failed
    run(id)            -> the same, but waits for the end (tests, scripts)
    cancel(id)         -> stops a task; it ends in `failed` with reason "cancelled"

During `run`, each shop gets its own branch, and the branches run concurrently:

    call.started -> place_call -> call.ended -> extract -> quote.ready
                               `-> call.failed (no person reached, timeout, error)

So the UI sees each shop's result as soon as its call ends, and one failed call never
stops the others. When every branch is finished, the quotes go to the comparator and
the task ends with comparison.ready (done) or task.failed.

The orchestrator holds no business logic of other roles: discovery, calling, retry
rules, extraction and comparison are injected (see interfaces.py). It does own:
- the state machine and its checks (states.py),
- building valid CallJobs, and never calling while required info is missing,
- timeouts, cancellation, a cost cap on retries,
- numbering events 1, 2, 3... per task with no gaps, each validated against the Event contract,
- validating every object a provider returns before passing it on.
"""

from __future__ import annotations

import asyncio
import copy
import logging
import re
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime

from app.contracts import contract_errors, timestamp, validate
from app.orchestrator.interfaces import (
    CallProvider,
    Comparator,
    DiscoveryProvider,
    EventSink,
    Extractor,
    NoRetry,
    RetryPolicy,
)
from app.orchestrator.states import TaskState, check_transition
from app.planner import NEEDS_INPUT, Planner, PlanResult
from app.planner.policy import check_outbound

log = logging.getLogger(__name__)

HUMAN_OUTCOMES = frozenset({"human_completed", "human_partial"})
MAX_ATTEMPTS = 2  # CallJob.attempt maximum: one retry at most (R4's rule, enforced by the contract)

# Short reasons shown in call.failed and Comparison.excluded.
OUTCOME_REASONS = {
    "voicemail": "reached voicemail",
    "ivr": "reached an automated phone menu",
    "no_answer": "no answer",
    "busy": "line busy",
    "hung_up": "the shop hung up",
    "wrong_business": "wrong business",
    "failed": "the call failed",
}


@dataclass(frozen=True)
class OrchestratorConfig:
    max_parallel_calls: int = 3  # contract maximum for TaskSpec.max_businesses
    call_max_duration_s: int = 150  # CallJob.max_duration_s, enforced by the voice platform
    call_timeout_s: float = 210  # our own limit per attempt: max duration + ringing + post-call
    discovery_timeout_s: float = 30
    extraction_timeout_s: float = 90
    comparison_timeout_s: float = 60
    task_timeout_s: float = 1200  # 20 min, room for R4's 10-minute retry wait
    max_task_cost_usd: float = 5.0  # no retries once a task has spent this much

    def __post_init__(self):
        if not 1 <= self.max_parallel_calls <= 3:
            raise ValueError("max_parallel_calls must be 1 to 3")
        if not 30 <= self.call_max_duration_s <= 150:
            raise ValueError("call_max_duration_s must be 30 to 150 (CallJob contract)")


# -- errors the caller (R5's API) should turn into HTTP responses ---------------------


class OrchestratorError(Exception):
    """Base class. `code` is stable and safe to show in an API response."""

    code = "orchestrator_error"


class UnknownTask(OrchestratorError):
    code = "unknown_task"


class DuplicateTask(OrchestratorError):
    code = "duplicate_task"


class MissingInput(OrchestratorError):
    code = "missing_input"


class TaskAlreadyStarted(OrchestratorError):
    code = "task_already_started"


class InvalidTaskState(OrchestratorError):
    code = "invalid_task_state"


class UnsafeContent(OrchestratorError):
    """The TaskSpec holds something that must never be said to a shop (app/planner/policy.py)."""

    code = "unsafe_content"


class _TaskFailed(Exception):
    """Internal: stop the pipeline and fail the task with this reason."""

    def __init__(self, reason: str):
        super().__init__(reason)
        self.reason = reason


# -- per-task bookkeeping -------------------------------------------------------------


@dataclass
class _Call:
    call_id: str
    place_id: str
    status: str = "pending"  # pending | calling | ended | failed
    attempts: int = 0
    outcome: str | None = None
    reason: str | None = None
    quote_ready: bool = False


@dataclass
class _Task:
    spec: dict
    state: TaskState = TaskState.CREATED
    history: list[str] = field(default_factory=lambda: [TaskState.CREATED.value])
    businesses: list[dict] = field(default_factory=list)
    calls: dict[str, _Call] = field(default_factory=dict)
    call_results: dict[str, dict] = field(default_factory=dict)
    quotes: dict[str, dict] = field(default_factory=dict)  # place_id -> Quote
    excluded: dict[str, str] = field(default_factory=dict)  # place_id -> reason
    comparison: dict | None = None
    failure_reason: str | None = None
    cost_usd: float = 0.0
    calls_pending: int = 0
    next_seq: int = 1
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)  # event numbering
    answer_lock: asyncio.Lock = field(default_factory=asyncio.Lock)
    runner: asyncio.Task | None = None


def _new_call_id() -> str:
    return f"call_{uuid.uuid4().hex[:12]}"


class Orchestrator:
    def __init__(
        self,
        *,
        planner: Planner,
        discovery: DiscoveryProvider,
        calls: CallProvider,
        extractor: Extractor,
        comparator: Comparator,
        events: EventSink,
        retry_policy: RetryPolicy | None = None,
        config: OrchestratorConfig | None = None,
        clock: Callable[[], datetime] | None = None,
        new_call_id: Callable[[], str] = _new_call_id,
    ):
        self._planner = planner
        self._discovery = discovery
        self._calls = calls
        self._extractor = extractor
        self._comparator = comparator
        self._events = events
        self._retry = retry_policy or NoRetry()
        self.config = config or OrchestratorConfig()
        self._clock = clock
        self._new_call_id = new_call_id
        self._tasks: dict[str, _Task] = {}
        self._running: set[asyncio.Task] = set()  # strong refs: asyncio only keeps weak ones

    # -- public API ----------------------------------------------------------------

    async def submit(self, task_spec: dict) -> dict:
        """Register a TaskSpec from the planner. Emits task.created, plus task.needs_input
        if slots are missing. Returns the task snapshot (see `get`)."""
        validate("task_spec", task_spec)
        task_id = task_spec["task_id"]
        if task_id in self._tasks:
            raise DuplicateTask(f"task {task_id} already exists")
        self._planner.template(task_spec["category"])  # KeyError if no such template
        problems = check_outbound(task_spec["slots"], task_spec["custom_questions"])
        if problems:  # the planner refuses these; this catches a TaskSpec built elsewhere
            raise UnsafeContent("; ".join(f"{field}: {issue.detail}" for field, issue in problems))
        task = _Task(spec=copy.deepcopy(task_spec))
        self._tasks[task_id] = task  # registered before any await, so a second submit fails

        await self._emit(task, "task.created", task.spec)
        if task.spec["missing_slots"]:
            self._transition(task, TaskState.NEEDS_INPUT)
            await self._emit_needs_input(task)
        return self.get(task_id)

    async def answer(self, task_id: str, answers: dict) -> PlanResult:
        """Give the user's answers to the follow-up questions. If something is still
        missing, emits task.needs_input again; when complete, the task is ready to run.
        Returns the planner's result (status `invalid` leaves the task unchanged)."""
        task = self._get(task_id)
        # One answer at a time per task: two quick submits must not overwrite each other.
        async with task.answer_lock:
            if task.state is not TaskState.NEEDS_INPUT:
                raise InvalidTaskState(f"task {task_id} is {task.state.value}, not waiting for answers")
            result = await self._planner.answer(task.spec, answers)
            if not result.accepted:
                return result
            if task.state is not TaskState.NEEDS_INPUT:  # cancelled while the planner was working
                raise InvalidTaskState(f"task {task_id} is {task.state.value}")
            if result.task_spec["task_id"] != task_id:
                raise RuntimeError("planner changed the task_id")
            task.spec = copy.deepcopy(result.task_spec)
            if result.status == NEEDS_INPUT:
                await self._emit_needs_input(task)
            else:
                self._transition(task, TaskState.CREATED)
            return result

    def start(self, task_id: str) -> asyncio.Task:
        """Start the task in the background and return its asyncio.Task. For R5's POST /start.

        Atomic: the checks and the state change happen with no `await` in between, so a
        second start (or run) raises TaskAlreadyStarted instead of calling the shops twice.
        Raises UnknownTask, TaskAlreadyStarted or MissingInput before anything is scheduled.
        The orchestrator keeps a reference to the returned task until it finishes, so it
        can't be garbage-collected mid-run. Call it from inside the running event loop
        (any FastAPI `async def` route is).
        """
        task = self._get(task_id)
        self.ensure_runnable(task_id)
        loop = asyncio.get_running_loop()  # RuntimeError outside a loop, before any state change
        self._transition(task, TaskState.DISCOVERING)
        coro = self._execute(task)
        try:
            runner = loop.create_task(coro, name=f"task-{task_id}")
        except BaseException:
            coro.close()
            # Nothing ran: undo the state change so the task can be started again. This is the
            # only place a task goes back from `discovering`, so it bypasses the state machine.
            task.state = TaskState.CREATED
            task.history.pop()
            raise
        task.runner = runner
        self._running.add(runner)
        runner.add_done_callback(lambda done: self._runner_done(task, done))
        return runner

    async def run(self, task_id: str) -> dict:
        """Start the task and wait for it to finish; returns the final snapshot.

        Same checks as start(). Everything that goes wrong after the start ends the task in
        `failed` with a task.failed event, not an exception. Cancelling the caller cancels
        the task (it ends in `failed`, reason "cancelled") and re-raises CancelledError.
        """
        return await self.start(task_id)

    async def _execute(self, task: _Task) -> dict:
        try:
            async with asyncio.timeout(self.config.task_timeout_s):
                await self._pipeline(task)
        except _TaskFailed as failure:
            await self._fail(task, failure.reason)
        except TimeoutError:
            await self._fail(task, f"task timed out after {self.config.task_timeout_s:g} s")
        except asyncio.CancelledError:
            await self._fail(task, "cancelled")
            raise
        except Exception as exc:  # a bug or a broken event sink: never leave a task half-running
            log.exception("task %s crashed", task.spec["task_id"])
            while isinstance(exc, ExceptionGroup):  # raised inside a call branch: name the real cause
                exc = exc.exceptions[0]
            await self._fail(task, f"internal error ({type(exc).__name__})")
        return self.get(task.spec["task_id"])

    def _runner_done(self, task: _Task, runner: asyncio.Task) -> None:
        self._running.discard(runner)
        if task.runner is runner:
            task.runner = None
        if runner.cancelled() and not task.state.is_final:
            # Cancelled before its first step, so _execute never ran its cleanup: do it now.
            cleanup = asyncio.get_running_loop().create_task(self._fail(task, "cancelled"))
            self._running.add(cleanup)
            cleanup.add_done_callback(self._running.discard)
        elif not runner.cancelled() and runner.exception() is not None:
            log.error("task %s runner crashed", task.spec["task_id"], exc_info=runner.exception())

    def ensure_runnable(self, task_id: str) -> None:
        """Raise what start() would raise: UnknownTask, TaskAlreadyStarted (running or
        finished) or MissingInput. A read-only check, e.g. to grey out a Start button."""
        task = self._get(task_id)
        if task.state not in (TaskState.CREATED, TaskState.NEEDS_INPUT):
            raise TaskAlreadyStarted(f"task {task_id} is {task.state.value}")
        if task.state is TaskState.NEEDS_INPUT or task.spec["missing_slots"]:
            raise MissingInput(f"task {task_id} still needs: {', '.join(task.spec['missing_slots'])}")

    async def cancel(self, task_id: str) -> bool:
        """Stop a task. Returns False if it had already finished."""
        task = self._get(task_id)
        if task.state.is_final:
            return False
        if task.runner is not None:
            task.runner.cancel()  # the runner emits task.failed (see _execute / _runner_done)
        else:
            await self._fail(task, "cancelled")
        return True

    def get(self, task_id: str) -> dict:
        """A copy of everything known about the task, for R5's GET /tasks/{id}."""
        task = self._get(task_id)
        order = {b["place_id"]: i for i, b in enumerate(task.businesses)}
        return copy.deepcopy(
            {
                "task_id": task_id,
                "state": task.state.value,
                "state_history": task.history,
                "task_spec": task.spec,
                "follow_up_questions": self._planner.questions_for(task.spec["category"], task.spec["missing_slots"]),
                "businesses": task.businesses,
                "calls": [vars(call) for call in task.calls.values()],
                "quotes": sorted(task.quotes.values(), key=lambda q: order.get(q["place_id"], 99)),
                "excluded": self._excluded_list(task),
                "comparison": task.comparison,
                "failure_reason": task.failure_reason,
                "cost_usd": round(task.cost_usd, 4),
                "last_seq": task.next_seq - 1,
            }
        )

    def forget(self, task_id: str) -> None:
        """Drop a finished task from memory once R5 has stored it."""
        if self._get(task_id).state.is_final:
            del self._tasks[task_id]
        else:
            raise InvalidTaskState(f"task {task_id} is still active")

    # -- the pipeline ------------------------------------------------------------------

    async def _pipeline(self, task: _Task) -> None:
        template = self._planner.template(task.spec["category"])
        self._check_call_variables(task.spec, template)
        problems = check_outbound(task.spec["slots"], task.spec["custom_questions"])
        if problems:  # last check before anything is said to a shop
            fields = ", ".join(field for field, _ in problems)
            raise _TaskFailed(f"refused before calling: {fields} failed the outbound content check")

        businesses = await self._discover(task)
        if not businesses:
            area = task.spec["area"]
            raise _TaskFailed(f"no callable shops found within {area['radius_m'] // 1000} km of {area['label']}")
        for business in businesses:
            task.businesses.append(business)
            await self._emit(task, "business.found", business)

        self._transition(task, TaskState.CALLING)
        task.calls_pending = len(businesses)
        # TaskGroup: if the task is cancelled or times out, every branch is cancelled too.
        async with asyncio.TaskGroup() as group:
            for business in businesses:
                group.create_task(self._shop_branch(task, business, template))

        if not task.quotes:  # from `calling` if no call reached a person, else from `extracting`
            reasons = "; ".join(sorted(set(task.excluded.values()))) or "no quotes"
            raise _TaskFailed(f"no shop gave a usable answer ({reasons})")
        if task.state is TaskState.CALLING:  # defensive: the last branch normally moved it
            self._transition(task, TaskState.EXTRACTING)

        task.comparison = await self._compare(task, template)
        await self._emit(task, "comparison.ready", task.comparison)
        self._transition(task, TaskState.DONE)

    async def _discover(self, task: _Task) -> list[dict]:
        limit = min(task.spec["max_businesses"], self.config.max_parallel_calls)
        try:
            async with asyncio.timeout(self.config.discovery_timeout_s):
                found = await self._discovery.find_businesses(copy.deepcopy(task.spec), limit)
        except TimeoutError:
            raise _TaskFailed(f"shop search timed out after {self.config.discovery_timeout_s:g} s") from None
        except Exception as exc:
            log.exception("discovery failed for %s", task.spec["task_id"])
            raise _TaskFailed(f"shop search failed ({type(exc).__name__})") from None
        if not isinstance(found, list):
            raise _TaskFailed("shop search returned no list")

        businesses, places, phones = [], set(), set()
        for business in found:
            problems = contract_errors("business", business)
            if problems:  # skip one bad record instead of failing the task; log it for R5
                log.warning("discovery returned an invalid Business, skipped: %s", problems)
                continue
            if business["place_id"] in places or business["phone_e164"] in phones:
                continue  # never call the same shop twice in one task
            places.add(business["place_id"])
            phones.add(business["phone_e164"])
            businesses.append(copy.deepcopy(business))
            if len(businesses) == limit:
                break
        return businesses

    async def _shop_branch(self, task: _Task, business: dict, template: dict) -> None:
        """One shop: call (with at most one retry), then extract. Never raises for a provider problem."""
        job = self._make_call_job(task, business)
        call = _Call(call_id=job["call_id"], place_id=business["place_id"])
        task.calls[call.call_id] = call

        result, reason = await self._call_with_retry(task, job, call)
        if result is not None and result["outcome"] in HUMAN_OUTCOMES:
            call.status, call.outcome = "ended", result["outcome"]
            task.call_results[call.call_id] = result
            await self._emit(task, "call.ended", result)
        else:
            call.status = "failed"
            call.outcome = result["outcome"] if result is not None else "failed"
            call.reason = reason
            task.excluded[business["place_id"]] = reason
            await self._emit(
                task,
                "call.failed",
                {"call_id": call.call_id, "place_id": call.place_id, "outcome": call.outcome, "reason": reason},
            )
        self._call_finished(task)
        if call.status != "ended":
            return

        quote = await self._extract(task, result, template)
        if quote is not None:
            task.quotes[business["place_id"]] = quote
            call.quote_ready = True
            await self._emit(task, "quote.ready", quote)

    def _call_finished(self, task: _Task) -> None:
        """When the last call ends, the task moves to `extracting` (if anyone answered)."""
        task.calls_pending -= 1
        if task.calls_pending == 0 and task.state is TaskState.CALLING and task.call_results:
            self._transition(task, TaskState.EXTRACTING)

    def _make_call_job(self, task: _Task, business: dict) -> dict:
        spec = task.spec
        job = {
            "call_id": self._new_call_id(),
            "task_id": spec["task_id"],
            "place_id": business["place_id"],
            "to_number": business["phone_e164"],
            "template": spec["category"],
            # Only the answers to planner questions: never personal data about the user (§11).
            "dynamic_variables": dict(spec["slots"]),
            "custom_questions": list(spec["custom_questions"]),
            "max_duration_s": self.config.call_max_duration_s,
            "attempt": 1,
        }
        return validate("call_job", job)

    async def _call_with_retry(self, task: _Task, job: dict, call: _Call) -> tuple[dict | None, str | None]:
        """Returns (CallResult or None, reason it failed or None)."""
        while True:
            call.attempts = job["attempt"]
            call.status = "calling"
            result, problem = await self._attempt(task, job)
            if result is not None:
                task.cost_usd += result["cost_usd"] or 0.0
                if result["outcome"] in HUMAN_OUTCOMES:
                    return result, None
            delay = self._retry_delay(task, job, result)
            if delay is None:
                break
            await asyncio.sleep(delay)
            job = {**job, "attempt": job["attempt"] + 1}

        reason = problem or OUTCOME_REASONS.get(result["outcome"], result["outcome"])
        if job["attempt"] > 1:
            reason += " after one retry"
        return result, reason

    def _retry_delay(self, task: _Task, job: dict, result: dict | None) -> float | None:
        if job["attempt"] >= MAX_ATTEMPTS:
            return None
        if task.cost_usd >= self.config.max_task_cost_usd:
            log.warning("task %s reached its cost cap; no retry", task.spec["task_id"])
            return None
        try:
            delay = self._retry.retry_delay_s(copy.deepcopy(job), copy.deepcopy(result))
        except Exception:
            log.exception("retry policy failed; no retry")
            return None
        if delay is None:
            return None
        return max(0.0, float(delay))

    async def _attempt(self, task: _Task, job: dict) -> tuple[dict | None, str | None]:
        """One call attempt. Returns (valid CallResult, None) or (None, reason)."""
        await self._emit(task, "call.started", {"call_id": job["call_id"], "place_id": job["place_id"]})
        try:
            async with asyncio.timeout(self.config.call_timeout_s):
                result = await self._calls.place_call(copy.deepcopy(job))
        except TimeoutError:
            return None, f"call timed out after {self.config.call_timeout_s:g} s"
        except Exception as exc:
            log.exception("call provider failed on %s", job["call_id"])
            return None, f"call provider error ({type(exc).__name__})"

        problems = contract_errors("call_result", result)
        if problems:
            log.error("invalid CallResult for %s: %s", job["call_id"], problems)
            return None, "call provider returned an invalid CallResult"
        if (result["call_id"], result["task_id"], result["place_id"]) != (job["call_id"], job["task_id"], job["place_id"]):
            log.error("CallResult ids don't match CallJob %s", job["call_id"])
            return None, "call provider returned a CallResult for a different call"
        return copy.deepcopy(result), None

    async def _extract(self, task: _Task, result: dict, template: dict) -> dict | None:
        place_id = result["place_id"]
        reason = None
        try:
            async with asyncio.timeout(self.config.extraction_timeout_s):
                quote = await self._extractor.extract(
                    copy.deepcopy(result), copy.deepcopy(task.spec), copy.deepcopy(template)
                )
        except TimeoutError:
            reason = "reading the answers timed out"
        except Exception:
            log.exception("extraction failed on %s", result["call_id"])
            reason = "reading the answers failed"
        else:
            problems = contract_errors("quote", quote)
            if problems:
                log.error("invalid Quote for %s: %s", result["call_id"], problems)
                reason = "extraction returned an invalid Quote"
            elif (quote["call_id"], quote["task_id"], quote["place_id"]) != (
                result["call_id"],
                result["task_id"],
                place_id,
            ):
                reason = "extraction returned a Quote for a different call"
        if reason:
            task.excluded[place_id] = reason
            return None
        return copy.deepcopy(quote)

    async def _compare(self, task: _Task, template: dict) -> dict:
        order = {b["place_id"]: i for i, b in enumerate(task.businesses)}
        quotes = sorted(task.quotes.values(), key=lambda q: order[q["place_id"]])
        try:
            async with asyncio.timeout(self.config.comparison_timeout_s):
                comparison = await self._comparator.compare(
                    copy.deepcopy(task.spec),
                    copy.deepcopy(template),
                    copy.deepcopy(quotes),
                    self._excluded_list(task),
                )
        except TimeoutError:
            raise _TaskFailed("comparison timed out") from None
        except Exception as exc:
            log.exception("comparison failed for %s", task.spec["task_id"])
            raise _TaskFailed(f"comparison failed ({type(exc).__name__})") from None
        problems = contract_errors("comparison", comparison)
        if problems:
            log.error("invalid Comparison: %s", problems)
            raise _TaskFailed("comparison returned an invalid Comparison")
        if comparison["task_id"] != task.spec["task_id"]:
            raise _TaskFailed("comparison returned a Comparison for a different task")
        return copy.deepcopy(comparison)

    # -- helpers ---------------------------------------------------------------------

    @staticmethod
    def _check_call_variables(spec: dict, template: dict) -> None:
        """Every {{slot}} in the template's call questions must have a value, or the agent
        would read a placeholder aloud."""
        needed = {name for q in template["call_questions"] for name in re.findall(r"\{\{(\w+)\}\}", q["ask_ar"])}
        missing = sorted(needed - set(spec["slots"]))
        if missing:
            raise _TaskFailed(f"missing values for the call questions: {', '.join(missing)}")

    def _excluded_list(self, task: _Task) -> list[dict]:
        order = {b["place_id"]: i for i, b in enumerate(task.businesses)}
        return [
            {"place_id": place_id, "reason": reason}
            for place_id, reason in sorted(task.excluded.items(), key=lambda item: order.get(item[0], 99))
        ]

    def _get(self, task_id: str) -> _Task:
        try:
            return self._tasks[task_id]
        except KeyError:
            raise UnknownTask(f"no task {task_id}") from None

    def _transition(self, task: _Task, new: TaskState) -> None:
        task.state = check_transition(task.state, new)
        task.history.append(new.value)

    async def _fail(self, task: _Task, reason: str) -> None:
        if task.state.is_final:
            return
        self._transition(task, TaskState.FAILED)
        task.failure_reason = reason
        try:
            await self._emit(task, "task.failed", {"reason": reason})
        except Exception:  # the sink itself may be what broke; the state is still recorded
            log.exception("could not emit task.failed for %s", task.spec["task_id"])

    async def _emit_needs_input(self, task: _Task) -> None:
        questions = self._planner.questions_for(task.spec["category"], task.spec["missing_slots"])
        await self._emit(task, "task.needs_input", {"questions": questions})

    async def _emit(self, task: _Task, event_type: str, data: dict) -> None:
        # The lock keeps numbering and publishing in one order even with 3 calls running.
        # `seq` only advances after a successful publish, so a sink error leaves no gap.
        async with task.lock:
            event = {
                "seq": task.next_seq,
                "type": event_type,
                "task_id": task.spec["task_id"],
                "at": timestamp(self._clock() if self._clock else None),
                "data": copy.deepcopy(data),
            }
            validate("event", event)
            await self._events.publish(copy.deepcopy(event))
            task.next_seq += 1
