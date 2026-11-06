"""Telephony (R4): who we may call, and what happened on a call.

    from app.telephony import Allowlist, NumberNotAllowed, map_outcome

- allowlist.py: refuses every number not explicitly allowed (architecture §9).
- outcomes.py: Twilio + ElevenLabs call status -> our `outcome` value.

Coming next: the RetryPolicy (Sat 7 Nov) and the CallProvider (Thu 12 Nov).
See docs/mock-first-plan.md (R4) and docs/integration.md §3.
"""

from app.telephony.allowlist import Allowlist, NumberNotAllowed, mask
from app.telephony.outcomes import CallNotFinished, map_outcome, shop_spoke

__all__ = ["Allowlist", "CallNotFinished", "NumberNotAllowed", "map_outcome", "mask", "shop_spoke"]
