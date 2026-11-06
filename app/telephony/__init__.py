"""Telephony (R4): who we may call, and what happened on a call.

    from app.telephony import Allowlist, NumberNotAllowed, map_outcome

- allowlist.py: refuses every number not explicitly allowed (architecture §9).
- outcomes.py: Twilio + ElevenLabs call status -> our `outcome` value.
- calling_hours.py: shop hours in Riyadh, prayer times, Friday morning.
- retry.py: R4RetryPolicy, at most one retry after 10 minutes, within calling hours.

Coming next: the CallProvider (Thu 12 Nov).
See docs/mock-first-plan.md (R4) and docs/integration.md §3.
"""

from app.telephony.allowlist import Allowlist, NumberNotAllowed, mask
from app.telephony.calling_hours import blocked, is_callable
from app.telephony.outcomes import CallNotFinished, map_outcome, shop_spoke
from app.telephony.retry import R4RetryPolicy

__all__ = [
    "Allowlist",
    "CallNotFinished",
    "NumberNotAllowed",
    "R4RetryPolicy",
    "blocked",
    "is_callable",
    "map_outcome",
    "mask",
    "shop_spoke",
]
