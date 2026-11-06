"""R4's RetryPolicy (app/orchestrator/interfaces.py): at most one retry, 10 minutes later,
only if the shop simply didn't pick up, and only if the retry falls inside calling hours.

    orchestrator = Orchestrator(..., retry_policy=R4RetryPolicy())

Rules (architecture §6 R4, §9 "retry at most once ... so we don't pester shops"):
- Only after attempt 1. The orchestrator never asks after attempt 2, but we check anyway.
- Only `no_answer` and `busy`. Voicemail, IVR, wrong business, hang-up and invalid numbers
  won't change in 10 minutes, and a shop that talked to us is never called twice.
- Not after a timeout or provider crash (`call_result` is None): we can't tell whether the
  shop's phone rang or someone answered, so calling again could mean calling twice.
- The whole retry (start + `call_budget_s`) must fit in calling hours (calling_hours.py).
  If not, no retry: waiting longer would overrun the task's 20-minute limit.

Owner: R4.
"""

from __future__ import annotations

import logging
from collections.abc import Callable
from datetime import datetime, timedelta, timezone

from app.telephony.calling_hours import blocked

log = logging.getLogger(__name__)

RETRY_OUTCOMES = frozenset({"no_answer", "busy"})


class R4RetryPolicy:
    def __init__(
        self,
        *,
        delay_s: float = 600,
        call_budget_s: float = 210,  # OrchestratorConfig.call_timeout_s: the longest an attempt can take
        clock: Callable[[], datetime] | None = None,
    ):
        if delay_s < 0 or call_budget_s < 0:
            raise ValueError("delay_s and call_budget_s must not be negative")
        self.delay_s = delay_s
        self.call_budget_s = call_budget_s
        self._clock = clock or (lambda: datetime.now(timezone.utc))

    def retry_delay_s(self, call_job: dict, call_result: dict | None) -> float | None:
        if call_job["attempt"] != 1:
            return None
        if call_result is None or call_result["outcome"] not in RETRY_OUTCOMES:
            return None
        retry_at = self._clock() + timedelta(seconds=self.delay_s)
        reason = blocked(retry_at, self.call_budget_s)
        if reason:
            log.info("no retry for %s: the retry would be %s", call_job["call_id"], reason)
            return None
        return float(self.delay_s)
