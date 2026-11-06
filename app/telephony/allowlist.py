"""The allowlist: the only numbers we may call until Tuwaiq/KSU sign-off (architecture §9).

The numbers belong to people who agreed to be called (teammates, friends, shops we know),
so they are personal data and never go in git. They come from the environment:

    TELEPHONY_ALLOWLIST=+966500000001,+966500000002     # comma-separated E.164
    TELEPHONY_ALLOWLIST_FILE=data/allowlist.txt          # one number per line, `#` comments

Both may be set; the numbers are combined. Nothing set means an EMPTY allowlist, which
refuses every number: forgetting the setting can never make the agent call a stranger.

    allowlist = Allowlist.from_env()
    allowlist.check(call_job["to_number"])   # raises NumberNotAllowed if not on the list

Owner: R4.
"""

from __future__ import annotations

import os
import re
from collections.abc import Iterable, Mapping
from pathlib import Path

E164 = re.compile(r"^\+[1-9][0-9]{7,14}$")  # same rule as common.schema.json#/$defs/phone_e164

ENV_NUMBERS = "TELEPHONY_ALLOWLIST"
ENV_FILE = "TELEPHONY_ALLOWLIST_FILE"


class NumberNotAllowed(PermissionError):
    """The number is not on the allowlist, so no call may be placed to it."""

    code = "number_not_allowed"

    def __init__(self, number: object):
        self.number = number
        super().__init__(f"refusing to call {mask(number)}: not on the allowlist")


def mask(number: object) -> str:
    """A number safe to log: country code and last 2 digits only (`+966*******01`)."""
    if not isinstance(number, str) or not E164.match(number):
        return "<not an E.164 number>"
    return number[:4] + "*" * (len(number) - 6) + number[-2:]


class Allowlist:
    """A fixed set of E.164 numbers. Exact match only: `0500000001` or `+966 50…` never match."""

    def __init__(self, numbers: Iterable[str] = ()):
        allowed = set()
        for raw in numbers:
            number = raw.strip() if isinstance(raw, str) else raw
            if not isinstance(number, str) or not E164.match(number):
                # Fail loudly at startup: a typo would otherwise silently refuse a friend's number.
                raise ValueError(f"allowlist entry {raw!r} is not an E.164 number like +9665XXXXXXXX")
            allowed.add(number)
        self._numbers = frozenset(allowed)

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> Allowlist:
        """Read TELEPHONY_ALLOWLIST and TELEPHONY_ALLOWLIST_FILE (see the module docstring)."""
        env = os.environ if env is None else env
        numbers = [n for n in env.get(ENV_NUMBERS, "").split(",") if n.strip()]
        path = env.get(ENV_FILE, "").strip()
        if path:
            numbers += _read_file(Path(path))
        return cls(numbers)

    def allows(self, number: object) -> bool:
        return isinstance(number, str) and number in self._numbers

    def check(self, number: object) -> str:
        """Return the number if it may be called, else raise NumberNotAllowed."""
        if not self.allows(number):
            raise NumberNotAllowed(number)
        return number

    def __contains__(self, number: object) -> bool:
        return self.allows(number)

    def __len__(self) -> int:
        return len(self._numbers)

    def __repr__(self) -> str:  # never print the numbers themselves
        return f"Allowlist({len(self)} numbers)"


def _read_file(path: Path) -> list[str]:
    """One number per line; blank lines and `#` comments (whole-line or trailing) are ignored."""
    lines = path.read_text(encoding="utf-8").splitlines()  # a missing file raises: the setting is wrong
    return [line.split("#", 1)[0].strip() for line in lines if line.split("#", 1)[0].strip()]
