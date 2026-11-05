"""A tiny async HTTP layer for Twilio and ElevenLabs, with no third-party dependency.

The call provider talks to the network only through a `Transport`, so tests swap in a fake
one and CI never calls a paid API (plan §4). The real `UrllibTransport` runs the standard
library's blocking `urllib` in a worker thread (`asyncio.to_thread`), so it never freezes
the event loop the other calls run on (integration §2, "Async providers must not block").

Owner: R4.
"""

from __future__ import annotations

import asyncio
import json
import urllib.error
import urllib.parse
import urllib.request
from typing import Protocol


class TelephonyHTTPError(RuntimeError):
    """A provider API answered with an error status. Never includes headers or secrets."""

    def __init__(self, status: int, method: str, url: str, detail: str = ""):
        self.status = status
        path = urllib.parse.urlsplit(url).path
        super().__init__(f"{method} {path} -> HTTP {status}" + (f": {detail[:200]}" if detail else ""))


class Transport(Protocol):
    async def request(
        self,
        method: str,
        url: str,
        *,
        headers: dict[str, str],
        json_body: dict | None = None,
        form: dict[str, str] | None = None,
    ) -> dict:
        """Send one request and return the JSON body ({} if empty). Raise TelephonyHTTPError on 4xx/5xx."""
        ...


class UrllibTransport:
    def __init__(self, timeout_s: float = 15):
        self.timeout_s = timeout_s

    async def request(self, method, url, *, headers, json_body=None, form=None) -> dict:
        return await asyncio.to_thread(self._send, method, url, dict(headers), json_body, form)

    def _send(self, method, url, headers, json_body, form) -> dict:
        if not url.startswith("https://"):
            raise ValueError("refusing a non-HTTPS provider URL")
        data = None
        if json_body is not None:
            data = json.dumps(json_body, ensure_ascii=False).encode("utf-8")
            headers["Content-Type"] = "application/json"
        elif form is not None:
            data = urllib.parse.urlencode(form).encode("ascii")
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        request = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_s) as response:
                body = response.read()
        except urllib.error.HTTPError as error:
            detail = error.read().decode("utf-8", "replace") if error.fp else ""
            raise TelephonyHTTPError(error.code, method, url, detail) from None
        return json.loads(body) if body else {}
