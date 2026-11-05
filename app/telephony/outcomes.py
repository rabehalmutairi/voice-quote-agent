"""Map what Twilio and ElevenLabs report about a call to our `outcome` (common.schema.json).

    outcome = map_outcome(twilio_call=call, conversation=conversation)

Inputs, as their public docs describe them (no real response saved yet: API access pending):
- `twilio_call`: a Twilio Call resource (or status callback) as a dict. We read `status`
  and `answered_by`. https://www.twilio.com/docs/voice/api/call-resource
- `conversation`: ElevenLabs "get conversation details" as a dict. We read `status`,
  `metadata.phone_call.call_result`, `transcript[].role/message/tool_calls`,
  `analysis.call_successful` and `analysis.data_collection_results`.
  https://elevenlabs.io/docs/api-reference/conversations/get

Either may be None (e.g. the call failed before ElevenLabs created a conversation), but not
both. The rules, first match wins:

1. Twilio says the call never connected: `busy`, `no-answer` (also a rejected call) ->
   busy / no_answer; `failed`, `canceled` -> failed.
2. A machine answered, or ElevenLabs says the call didn't connect: Twilio `answered_by`
   machine_* -> voicemail (`fax` -> failed); ElevenLabs `call_result` voicemail / busy /
   no_answer / failed as named; the agent called its `voicemail_detection` tool -> voicemail.
3. The agent's own verdict (R2): a data-collection item `call_outcome` with value `ivr` or
   `wrong_business`. ElevenLabs has no IVR detector, so only the agent can tell us.
4. Nobody at the shop said anything -> hung_up (connected, then silence or hang-up), or
   failed if there was no conversation at all / the platform reports it failed.
5. The shop spoke: human_completed if the agent's success evaluation is `success`,
   otherwise human_partial (the call ended before every question was answered).

A call that is still running raises CallNotFinished: map only final states.
Owner: R4.
"""

from __future__ import annotations

TWILIO_RUNNING = frozenset({"queued", "initiated", "ringing", "in-progress"})
TWILIO_NOT_CONNECTED = {"busy": "busy", "no-answer": "no_answer", "failed": "failed", "canceled": "failed"}
TWILIO_FINAL = frozenset(TWILIO_NOT_CONNECTED) | {"completed"}

ELEVENLABS_RUNNING = frozenset({"initiated", "in-progress", "processing"})
ELEVENLABS_CALL_RESULT = {"voicemail": "voicemail", "busy": "busy", "no_answer": "no_answer", "failed": "failed"}

VOICEMAIL_TOOL = "voicemail_detection"  # ElevenLabs system tool name
# Data-collection item the agent fills when it hangs up on a menu or the wrong business.
# The key and values are a proposal to R2 (app/voice); until R2 adds it, rule 3 never fires.
AGENT_VERDICT_KEY = "call_outcome"
AGENT_VERDICTS = frozenset({"ivr", "wrong_business"})


class CallNotFinished(ValueError):
    """The call (or its post-call processing) is still running; poll again or wait for the webhook."""


def map_outcome(*, twilio_call: dict | None = None, conversation: dict | None = None) -> str:
    """Return one of the contract's outcome values for a finished call. See the module docstring."""
    if twilio_call is None and conversation is None:
        raise ValueError("need the Twilio call, the ElevenLabs conversation, or both")

    # 1. Never connected: Twilio is the authority on the phone line.
    answered_by = ""
    if twilio_call is not None:
        status = twilio_call.get("status")
        if status in TWILIO_RUNNING:
            raise CallNotFinished(f"Twilio call is still {status}")
        if status not in TWILIO_FINAL:
            raise ValueError(f"unknown Twilio call status {status!r}")
        if status in TWILIO_NOT_CONNECTED:
            return TWILIO_NOT_CONNECTED[status]
        answered_by = twilio_call.get("answered_by") or ""

    # 2. A machine answered.
    if answered_by.startswith("machine"):
        return "voicemail"
    if answered_by == "fax":
        return "failed"
    if conversation is None:  # the line connected but the agent never ran
        return "failed"

    conv_status = conversation.get("status")
    if conv_status in ELEVENLABS_RUNNING:
        raise CallNotFinished(f"ElevenLabs conversation is still {conv_status}")
    phone_call = (conversation.get("metadata") or {}).get("phone_call") or {}
    call_result = phone_call.get("call_result")
    if call_result in ELEVENLABS_CALL_RESULT:
        return ELEVENLABS_CALL_RESULT[call_result]
    if _agent_called(conversation, VOICEMAIL_TOOL):
        return "voicemail"

    # 3. The agent recognised a phone menu or the wrong business and hung up.
    verdict = _agent_verdict(conversation)
    if verdict in AGENT_VERDICTS:
        return verdict

    # 4-5. Did a person at the shop talk to us, and did the agent get through its questions?
    if not shop_spoke(conversation):
        return "failed" if conv_status == "failed" else "hung_up"
    analysis = conversation.get("analysis") or {}
    if conv_status == "done" and analysis.get("call_successful") == "success":
        return "human_completed"
    return "human_partial"


def shop_spoke(conversation: dict) -> bool:
    """True if any `user` turn (ElevenLabs' name for the person called) has words in it."""
    return any(
        turn.get("role") == "user" and (turn.get("message") or "").strip()
        for turn in conversation.get("transcript") or []
    )


def _agent_called(conversation: dict, tool_name: str) -> bool:
    return any(
        call.get("tool_name") == tool_name
        for turn in conversation.get("transcript") or []
        for call in turn.get("tool_calls") or []
    )


def _agent_verdict(conversation: dict) -> str | None:
    results = (conversation.get("analysis") or {}).get("data_collection_results") or {}
    item = results.get(AGENT_VERDICT_KEY) or {}
    value = item.get("value")
    return value.strip().lower() if isinstance(value, str) else None
