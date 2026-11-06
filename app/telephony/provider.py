"""The real CallProvider (app/orchestrator/interfaces.py): ElevenLabs Agents over Twilio.

    calls = TwilioElevenLabsCalls.from_env(build_client_data=build_agent_overrides)  # R2's builder
    orchestrator = Orchestrator(..., calls=calls, retry_policy=R4RetryPolicy())

`place_call(call_job)` places ONE attempt and waits for it to end (integration §3):

1. Refuse unless `to_number` is on the allowlist, and (except for pre-arranged numbers)
   unless it is calling hours now. Both raise, so the orchestrator records a failed call.
2. Ask R2's builder for the agent settings for this job (`conversation_initiation_client_data`).
3. Start the call: ElevenLabs `POST /v1/convai/twilio/outbound-call`.
4. Poll Twilio for the call's status until it ends, then poll ElevenLabs until its post-call
   processing is done (transcript, analysis).
5. Map the status to our `outcome` (outcomes.py), convert the transcript (`user` -> `shop`),
   add cost and timing, and return a validated CallResult.

On cancellation (task timeout or user cancel) it hangs up through Twilio, then re-raises.
It never retries: the orchestrator asks R4RetryPolicy.

Settings come from the environment (never from git):

    ELEVENLABS_API_KEY, ELEVENLABS_AGENT_ID, ELEVENLABS_PHONE_NUMBER_ID,
    TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN,
    TELEPHONY_ALLOWLIST / TELEPHONY_ALLOWLIST_FILE   (allowlist.py)
    TELEPHONY_PRE_ARRANGED                           (comma-separated numbers that agreed in advance)

STATUS: written against the public API docs and tested on synthetic responses only. Not
activated: the activation policy (plan §4) needs keys and a live smoke test first.
Owner: R4.
"""

from __future__ import annotations

import asyncio
import base64
import copy
import logging
import os
import re
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

from app.contracts import timestamp, validate
from app.telephony.allowlist import Allowlist, mask
from app.telephony.calling_hours import blocked
from app.telephony.http import TelephonyHTTPError, Transport, UrllibTransport
from app.telephony.outcomes import ELEVENLABS_RUNNING, TWILIO_FINAL, map_outcome

log = logging.getLogger(__name__)

ARABIC = re.compile(r"[؀-ۿ]")
LATIN = re.compile(r"[A-Za-z]")


class MissingSetting(RuntimeError):
    """Real mode was asked to start without a required environment variable."""


class OutsideCallingHours(PermissionError):
    code = "outside_calling_hours"


@dataclass(frozen=True)
class TelephonyConfig:
    elevenlabs_api_key: str = field(repr=False)
    agent_id: str
    agent_phone_number_id: str
    twilio_account_sid: str
    twilio_auth_token: str = field(repr=False)
    elevenlabs_base_url: str = "https://api.elevenlabs.io"
    twilio_base_url: str = "https://api.twilio.com"
    poll_interval_s: float = 3.0
    ringing_timeout_s: int = 30  # how long the phone rings before Twilio reports no-answer

    ENV = {
        "elevenlabs_api_key": "ELEVENLABS_API_KEY",
        "agent_id": "ELEVENLABS_AGENT_ID",
        "agent_phone_number_id": "ELEVENLABS_PHONE_NUMBER_ID",
        "twilio_account_sid": "TWILIO_ACCOUNT_SID",
        "twilio_auth_token": "TWILIO_AUTH_TOKEN",
    }

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> TelephonyConfig:
        """Read the settings; raise MissingSetting naming every missing variable (never values)."""
        env = os.environ if env is None else env
        values = {key: env.get(var, "").strip() for key, var in cls.ENV.items()}
        missing = [cls.ENV[key] for key, value in values.items() if not value]
        if missing:
            raise MissingSetting(f"real telephony needs {', '.join(missing)} in .env")
        return cls(**values)


class TwilioElevenLabsCalls:
    def __init__(
        self,
        config: TelephonyConfig,
        *,
        allowlist: Allowlist,
        build_client_data: Callable[[dict], dict],
        pre_arranged: Allowlist | None = None,
        transport: Transport | None = None,
        enforce_calling_hours: bool = True,
        clock: Callable[[], datetime] | None = None,
        sleep: Callable[[float], object] = asyncio.sleep,
    ):
        self.config = config
        self.allowlist = allowlist
        self.pre_arranged = pre_arranged or Allowlist()
        self.enforce_calling_hours = enforce_calling_hours
        self._build = build_client_data  # R2: CallJob -> conversation_initiation_client_data
        self._http = transport or UrllibTransport()
        self._clock = clock or (lambda: datetime.now(timezone.utc))
        self._sleep = sleep

    @classmethod
    def from_env(cls, *, build_client_data: Callable[[dict], dict], env: Mapping[str, str] | None = None, **kwargs):
        env = os.environ if env is None else env
        pre_arranged = [n for n in env.get("TELEPHONY_PRE_ARRANGED", "").split(",") if n.strip()]
        return cls(
            TelephonyConfig.from_env(env),
            allowlist=Allowlist.from_env(env),
            pre_arranged=Allowlist(pre_arranged),
            build_client_data=build_client_data,
            **kwargs,
        )

    # -- the CallProvider interface ------------------------------------------------

    async def place_call(self, call_job: dict) -> dict:
        validate("call_job", call_job)
        number = self.allowlist.check(call_job["to_number"])  # raises NumberNotAllowed
        pre_arranged = number in self.pre_arranged
        if self.enforce_calling_hours and not pre_arranged:
            reason = blocked(self._clock(), call_job["max_duration_s"])
            if reason:
                raise OutsideCallingHours(f"not calling {mask(number)}: {reason}")

        client_data = self._build(copy.deepcopy(call_job))
        if not isinstance(client_data, dict):
            raise TypeError("build_client_data must return a dict (conversation_initiation_client_data)")
        started = await self._start(call_job, client_data)
        call_sid, conversation_id = started.get("callSid"), started.get("conversation_id")
        if not started.get("success") or not (call_sid or conversation_id):
            log.warning("call %s was not started: %s", call_job["call_id"], (started.get("message") or "")[:200])
            return self._result(call_job, "failed", None, None, conversation_id, pre_arranged)
        log.info("call %s started to %s (attempt %d)", call_job["call_id"], mask(number), call_job["attempt"])

        try:
            twilio_call = await self._wait_for_twilio(call_sid) if call_sid else None
            conversation = None
            if conversation_id and (twilio_call is None or twilio_call["status"] == "completed"):
                conversation = await self._wait_for_conversation(conversation_id)
        except asyncio.CancelledError:
            await self._hang_up(call_job, call_sid)
            raise

        outcome = map_outcome(twilio_call=twilio_call, conversation=conversation)
        return self._result(call_job, outcome, twilio_call, conversation, conversation_id, pre_arranged)

    # -- provider APIs ---------------------------------------------------------------

    def _elevenlabs_headers(self) -> dict[str, str]:
        return {"xi-api-key": self.config.elevenlabs_api_key, "Accept": "application/json"}

    def _twilio_headers(self) -> dict[str, str]:
        token = f"{self.config.twilio_account_sid}:{self.config.twilio_auth_token}".encode()
        return {"Authorization": "Basic " + base64.b64encode(token).decode(), "Accept": "application/json"}

    def _twilio_call_url(self, call_sid: str) -> str:
        sid = self.config.twilio_account_sid
        return f"{self.config.twilio_base_url}/2010-04-01/Accounts/{sid}/Calls/{call_sid}.json"

    async def _start(self, job: dict, client_data: dict) -> dict:
        body = {
            "agent_id": self.config.agent_id,
            "agent_phone_number_id": self.config.agent_phone_number_id,
            "to_number": job["to_number"],
            "conversation_initiation_client_data": client_data,
            "telephony_call_config": {"ringing_timeout_secs": self.config.ringing_timeout_s},
        }
        url = f"{self.config.elevenlabs_base_url}/v1/convai/twilio/outbound-call"
        return await self._http.request("POST", url, headers=self._elevenlabs_headers(), json_body=body)

    async def _wait_for_twilio(self, call_sid: str) -> dict:
        """Poll the Twilio call until it reaches a final status (completed, busy, no-answer, ...)."""
        while True:
            call = await self._http.request("GET", self._twilio_call_url(call_sid), headers=self._twilio_headers())
            if call.get("status") in TWILIO_FINAL:
                return call
            await self._sleep(self.config.poll_interval_s)

    async def _wait_for_conversation(self, conversation_id: str) -> dict:
        """Poll ElevenLabs until post-call processing is finished. A 404 right after the call
        means the record isn't there yet. The orchestrator's call timeout bounds the wait."""
        url = f"{self.config.elevenlabs_base_url}/v1/convai/conversations/{conversation_id}"
        while True:
            try:
                conversation = await self._http.request("GET", url, headers=self._elevenlabs_headers())
            except TelephonyHTTPError as error:
                if error.status != 404:
                    raise
            else:
                if conversation.get("status") not in ELEVENLABS_RUNNING:
                    return conversation
            await self._sleep(self.config.poll_interval_s)

    async def _hang_up(self, job: dict, call_sid: str | None) -> None:
        """Best effort, bounded: a failed hang-up is logged, never raised over the cancellation."""
        if not call_sid:
            return
        try:
            async with asyncio.timeout(10):
                await self._http.request(
                    "POST", self._twilio_call_url(call_sid), headers=self._twilio_headers(), form={"Status": "completed"}
                )
            log.info("call %s hung up after cancellation", job["call_id"])
        except Exception:
            log.exception("could not hang up call %s", job["call_id"])

    # -- building the CallResult ----------------------------------------------------

    def _result(self, job, outcome, twilio_call, conversation, conversation_id, pre_arranged) -> dict:
        transcript = to_transcript(conversation)
        connected = (twilio_call or {}).get("status") == "completed" or (
            twilio_call is None and conversation is not None and bool(transcript)
        )
        result = {
            "call_id": job["call_id"],
            "task_id": job["task_id"],
            "place_id": job["place_id"],
            "conversation_id": conversation_id or (conversation or {}).get("conversation_id"),
            "outcome": outcome,
            "started_at": _started_at(twilio_call, conversation) if connected else None,
            "duration_s": _duration_s(twilio_call, conversation) if connected else 0,
            "language_final": language_of(transcript),
            "transcript": transcript,
            "cost_usd": cost_usd(twilio_call, conversation),
            "pre_arranged": pre_arranged,
            "scenario_id": None,  # real call; role-play scenario IDs are set by R3's tooling
        }
        return validate("call_result", result)


# -- pure helpers (tested directly) ------------------------------------------------------


def to_transcript(conversation: dict | None) -> list[dict]:
    """ElevenLabs transcript -> CallResult transcript. `user` becomes `shop`; turns with no words
    (tool calls only) are dropped and the rest renumbered from 0."""
    turns = []
    for turn in (conversation or {}).get("transcript") or []:
        text = (turn.get("message") or "").strip()
        if not text or turn.get("role") not in ("user", "agent"):
            continue
        turns.append({
            "i": len(turns),
            "speaker": "shop" if turn["role"] == "user" else "agent",
            "t": max(0, turn.get("time_in_call_secs") or 0),
            "text": text,
        })
    return turns


def language_of(transcript: list[dict]) -> str | None:
    """`ar` or `en` from the last turn with letters in it; None when nobody spoke."""
    for turn in reversed(transcript):
        if ARABIC.search(turn["text"]):
            return "ar"
        if LATIN.search(turn["text"]):
            return "en"
    return None


def cost_usd(twilio_call: dict | None, conversation: dict | None) -> float | None:
    """ElevenLabs `cost_fiat` (USD) + Twilio `price` (a negative string, e.g. "-0.31").
    None when neither provider has reported a cost yet (it counts as $0 toward the cap)."""
    parts = []
    fiat = ((conversation or {}).get("metadata") or {}).get("cost_fiat")
    if isinstance(fiat, (int, float)):
        parts.append(abs(fiat))
    if twilio_call and twilio_call.get("price") not in (None, ""):
        if (twilio_call.get("price_unit") or "USD").upper() == "USD":
            parts.append(abs(float(twilio_call["price"])))
        else:
            log.warning("Twilio price in %s ignored: cost is tracked in USD", twilio_call.get("price_unit"))
    return round(sum(parts), 4) if parts else None


def _started_at(twilio_call: dict | None, conversation: dict | None) -> str | None:
    if twilio_call and twilio_call.get("start_time"):
        return timestamp(parsedate_to_datetime(twilio_call["start_time"]))
    start = ((conversation or {}).get("metadata") or {}).get("start_time_unix_secs")
    return timestamp(datetime.fromtimestamp(start, timezone.utc)) if isinstance(start, (int, float)) else None


def _duration_s(twilio_call: dict | None, conversation: dict | None) -> float:
    if twilio_call and str(twilio_call.get("duration") or "").isdigit():
        return float(twilio_call["duration"])
    seconds = ((conversation or {}).get("metadata") or {}).get("call_duration_secs")
    return float(seconds) if isinstance(seconds, (int, float)) and seconds >= 0 else 0.0
