"""TwilioElevenLabsCalls on SYNTHETIC responses (payloads/*.json + the start response below),
through a fake transport: no network, no keys, no cost. Real saved responses replace these
once API access arrives (plan §4)."""

import asyncio
import base64
import json
from dataclasses import replace
from datetime import datetime
from pathlib import Path

import pytest

from app.contracts import CONTRACTS_DIR, contract_errors
from app.mocks import build_mock_stack, mock_businesses
from app.orchestrator import Orchestrator
from app.telephony import Allowlist, NumberNotAllowed
from app.telephony.calling_hours import RIYADH
from app.telephony.http import TelephonyHTTPError, UrllibTransport
from app.telephony.provider import (
    MissingSetting,
    OutsideCallingHours,
    TelephonyConfig,
    TwilioElevenLabsCalls,
    cost_usd,
    language_of,
    to_transcript,
)
from conftest import run, submit_ready_task

PAYLOADS = Path(__file__).parent / "payloads"
JOB = json.loads((CONTRACTS_DIR / "examples" / "call_job.json").read_text(encoding="utf-8"))
OPEN = datetime(2026, 11, 5, 20, 0, tzinfo=RIYADH)  # Thursday evening
NIGHT = datetime(2026, 11, 5, 23, 30, tzinfo=RIYADH)
CONFIG = TelephonyConfig(
    elevenlabs_api_key="xi_test_key",
    agent_id="agent_synthetic01",
    agent_phone_number_id="phnum_synthetic01",
    twilio_account_sid="AC" + "0" * 32,
    twilio_auth_token="twilio_test_token",
    poll_interval_s=0,
)
# SYNTHETIC: shape from ElevenLabs' outbound-call API reference.
STARTED = {"success": True, "message": "Success", "conversation_id": "conv_synthetic01", "callSid": "CA" + "0" * 31 + "1"}


def payload(name):
    return json.loads((PAYLOADS / f"{name}.json").read_text(encoding="utf-8"))


class FakeTransport:
    """Answers requests from scripted queues, matched by method + a URL fragment. The last
    response in a queue repeats forever (e.g. a phone that keeps ringing)."""

    def __init__(self, routes):
        self.routes = {key: list(responses) for key, responses in routes.items()}
        self.requests = []

    async def request(self, method, url, *, headers, json_body=None, form=None):
        self.requests.append({"method": method, "url": url, "headers": headers, "json": json_body, "form": form})
        await asyncio.sleep(0)
        for (route_method, fragment), queue in self.routes.items():
            if route_method == method and fragment in url:
                response = queue.pop(0) if len(queue) > 1 else queue[0]
                if isinstance(response, Exception):
                    raise response
                return json.loads(json.dumps(response))
        raise AssertionError(f"unexpected request {method} {url}")

    def sent(self, method, fragment):
        return [r for r in self.requests if r["method"] == method and fragment in r["url"]]


def routes(twilio_calls, conversations=(), started=STARTED):
    return {
        ("POST", "outbound-call"): [started],
        ("GET", "/Calls/"): list(twilio_calls),
        ("GET", "/conversations/"): list(conversations) or [{}],
        ("POST", "/Calls/"): [{"status": "completed"}],
    }


def with_status(call, status):
    return {**call, "status": status}


def build_client_data(job):  # stands in for R2's builder
    return {"dynamic_variables": dict(job["dynamic_variables"]), "conversation_config_override": {}}


def provider(transport, *, allow=(JOB["to_number"],), pre_arranged=(), at=OPEN, **kwargs):
    async def no_wait(_):
        await asyncio.sleep(0)

    return TwilioElevenLabsCalls(
        CONFIG,
        allowlist=Allowlist(allow),
        pre_arranged=Allowlist(pre_arranged),
        build_client_data=build_client_data,
        transport=transport,
        clock=lambda: at,
        sleep=no_wait,
        **kwargs,
    )


def completed_call_routes():
    case = payload("human_completed")
    call, conversation = case["twilio_call"], case["conversation"]
    return routes(
        [with_status(call, "queued"), with_status(call, "ringing"), with_status(call, "in-progress"), call],
        [TelephonyHTTPError(404, "GET", "https://x/v1/convai/conversations/c"), {**conversation, "status": "processing"}, conversation],
    )


# -- a call that reached the shop ------------------------------------------------------


def test_completed_call_returns_a_valid_call_result():
    transport = FakeTransport(completed_call_routes())
    result = run(provider(transport).place_call(JOB))

    assert contract_errors("call_result", result) == []
    assert (result["call_id"], result["task_id"], result["place_id"]) == (JOB["call_id"], JOB["task_id"], JOB["place_id"])
    assert result["outcome"] == "human_completed"
    assert result["conversation_id"] == "conv_synthetic01"
    assert result["started_at"] == "2026-11-05T15:01:30Z"
    assert result["duration_s"] == 70
    assert result["language_final"] == "ar"
    assert result["cost_usd"] == 0.4  # ElevenLabs 0.09 + Twilio 0.31
    assert result["pre_arranged"] is False and result["scenario_id"] is None
    assert [t["speaker"] for t in result["transcript"]] == ["agent", "shop", "agent", "shop"]
    assert [t["i"] for t in result["transcript"]] == [0, 1, 2, 3]


def test_start_request_carries_the_job_and_r2_settings():
    transport = FakeTransport(completed_call_routes())
    run(provider(transport).place_call(JOB))
    (start,) = transport.sent("POST", "outbound-call")
    assert start["url"] == "https://api.elevenlabs.io/v1/convai/twilio/outbound-call"
    assert start["headers"]["xi-api-key"] == "xi_test_key"
    assert start["json"]["agent_id"] == "agent_synthetic01"
    assert start["json"]["agent_phone_number_id"] == "phnum_synthetic01"
    assert start["json"]["to_number"] == JOB["to_number"]
    assert start["json"]["conversation_initiation_client_data"]["dynamic_variables"] == JOB["dynamic_variables"]


def test_twilio_requests_use_basic_auth():
    transport = FakeTransport(completed_call_routes())
    run(provider(transport).place_call(JOB))
    request = transport.sent("GET", "/Calls/")[0]
    assert request["url"].endswith(f"/2010-04-01/Accounts/{CONFIG.twilio_account_sid}/Calls/{STARTED['callSid']}.json")
    expected = base64.b64encode(f"{CONFIG.twilio_account_sid}:twilio_test_token".encode()).decode()
    assert request["headers"]["Authorization"] == f"Basic {expected}"


def test_pre_arranged_numbers_are_marked():
    result = run(provider(FakeTransport(completed_call_routes()), pre_arranged=[JOB["to_number"]]).place_call(JOB))
    assert result["pre_arranged"] is True


# -- calls that didn't reach anyone ----------------------------------------------------


@pytest.mark.parametrize("name, outcome", [("no_answer", "no_answer"), ("busy", "busy"), ("failed_invalid_number", "failed")])
def test_unconnected_call(name, outcome):
    call = payload(name)["twilio_call"]
    transport = FakeTransport(routes([with_status(call, "ringing"), call]))
    result = run(provider(transport).place_call(JOB))
    assert contract_errors("call_result", result) == []
    assert result["outcome"] == outcome
    assert result["started_at"] is None and result["duration_s"] == 0 and result["transcript"] == []
    assert result["language_final"] is None
    assert transport.sent("GET", "/conversations/") == []  # nothing to fetch


def test_voicemail_call():
    case = payload("voicemail_tool")
    transport = FakeTransport(routes([case["twilio_call"]], [case["conversation"]]))
    result = run(provider(transport).place_call(JOB))
    assert result["outcome"] == "voicemail"
    assert [t["speaker"] for t in result["transcript"]] == ["shop"]  # the tool-only turn is dropped


def test_platform_refuses_to_start():
    started = {"success": False, "message": "agent misconfigured", "conversation_id": None, "callSid": None}
    transport = FakeTransport(routes([{}], started=started))
    result = run(provider(transport).place_call(JOB))
    assert result["outcome"] == "failed" and result["conversation_id"] is None
    assert contract_errors("call_result", result) == []


def test_http_error_raises_for_the_orchestrator():
    transport = FakeTransport({("POST", "outbound-call"): [TelephonyHTTPError(401, "POST", "https://x/y")]})
    with pytest.raises(TelephonyHTTPError):
        run(provider(transport).place_call(JOB))


def test_conversation_only_when_twilio_gives_no_sid():
    case = payload("human_completed")
    started = {**STARTED, "callSid": None}
    transport = FakeTransport(routes([{}], [case["conversation"]], started=started))
    result = run(provider(transport).place_call(JOB))
    assert result["outcome"] == "human_completed"
    assert transport.sent("GET", "/Calls/") == []


# -- refusals: nothing is sent ---------------------------------------------------------


def test_number_not_on_allowlist_is_refused_before_any_request():
    transport = FakeTransport(completed_call_routes())
    with pytest.raises(NumberNotAllowed):
        run(provider(transport, allow=()).place_call(JOB))
    assert transport.requests == []


def test_outside_calling_hours_is_refused_before_any_request():
    transport = FakeTransport(completed_call_routes())
    with pytest.raises(OutsideCallingHours):
        run(provider(transport, at=NIGHT).place_call(JOB))
    assert transport.requests == []


def test_pre_arranged_numbers_may_be_called_any_time():
    transport = FakeTransport(completed_call_routes())
    result = run(provider(transport, at=NIGHT, pre_arranged=[JOB["to_number"]]).place_call(JOB))
    assert result["outcome"] == "human_completed"


def test_bad_builder_output_is_refused():
    p = provider(FakeTransport(completed_call_routes()))
    p._build = lambda job: "not a dict"
    with pytest.raises(TypeError):
        run(p.place_call(JOB))


# -- cancellation ------------------------------------------------------------------------


def test_cancel_hangs_up_then_reraises():
    ringing = with_status(payload("no_answer")["twilio_call"], "ringing")
    transport = FakeTransport(routes([ringing]))  # rings forever

    async def go():
        task = asyncio.create_task(provider(transport).place_call(JOB))
        while not transport.sent("GET", "/Calls/"):
            await asyncio.sleep(0)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    run(go())
    (hang_up,) = transport.sent("POST", "/Calls/")
    assert hang_up["form"] == {"Status": "completed"}


def test_failed_hang_up_does_not_hide_the_cancellation():
    ringing = with_status(payload("no_answer")["twilio_call"], "ringing")
    transport = FakeTransport({**routes([ringing]), ("POST", "/Calls/"): [TelephonyHTTPError(500, "POST", "https://x/y")]})

    async def go():
        task = asyncio.create_task(provider(transport).place_call(JOB))
        while not transport.sent("GET", "/Calls/"):
            await asyncio.sleep(0)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    run(go())


# -- plugged into the real orchestrator -------------------------------------------------


def test_orchestrator_accepts_its_call_results():
    """Shop 1 completes, shop 2 doesn't answer, shop 3 isn't on the allowlist: the task still
    finishes, and the refused number never produced a request."""
    shop_1, shop_2, shop_3 = mock_businesses()
    case = payload("human_completed")

    # The fake can't tell calls apart once started, so shop 2 gets its own provider.
    transport_1 = FakeTransport(routes([case["twilio_call"]], [case["conversation"]]))
    transport_2 = FakeTransport(routes([payload("no_answer")["twilio_call"]]))
    p1 = provider(transport_1, allow=[shop_1["phone_e164"], shop_2["phone_e164"]])
    p2 = provider(transport_2, allow=[shop_1["phone_e164"], shop_2["phone_e164"]])

    class Router:
        async def place_call(self, job):
            return await (p2 if job["to_number"] == shop_2["phone_e164"] else p1).place_call(job)

    stack = build_mock_stack(speed=0)
    stack.orchestrator = Orchestrator(
        planner=stack.planner, discovery=stack.discovery, calls=Router(), extractor=stack.extractor,
        comparator=stack.comparator, events=stack.events, config=stack.orchestrator.config,
    )

    async def go():
        task_id = await submit_ready_task(stack)
        return await stack.orchestrator.run(task_id)

    task = run(go())
    assert task["state"] == "done"
    by_place = {c["place_id"]: c for c in task["calls"]}
    assert by_place[shop_1["place_id"]]["outcome"] == "human_completed"
    assert by_place[shop_2["place_id"]]["outcome"] == "no_answer"
    assert by_place[shop_3["place_id"]]["reason"] == "call provider error (NumberNotAllowed)"
    assert shop_3["phone_e164"] not in json.dumps(transport_1.requests + transport_2.requests)


def test_orchestrator_timeout_hangs_up_the_call():
    from dataclasses import replace

    shop_1 = mock_businesses()[0]
    ringing = with_status(payload("no_answer")["twilio_call"], "ringing")
    transport = FakeTransport(routes([ringing]))  # never ends: the orchestrator's timeout must stop it
    calls = provider(transport, allow=[b["phone_e164"] for b in mock_businesses()])

    stack = build_mock_stack(speed=0)
    stack.discovery.businesses = [shop_1]
    stack.orchestrator = Orchestrator(
        planner=stack.planner, discovery=stack.discovery, calls=calls, extractor=stack.extractor,
        comparator=stack.comparator, events=stack.events,
        config=replace(stack.orchestrator.config, call_timeout_s=0.05),
    )

    async def go():
        task_id = await submit_ready_task(stack)
        return await stack.orchestrator.run(task_id)

    task = run(go())
    assert task["state"] == "failed"
    assert task["calls"][0]["reason"] == "call timed out after 0.05 s"
    assert transport.sent("POST", "/Calls/")[0]["form"] == {"Status": "completed"}


# -- settings and helpers --------------------------------------------------------------


def test_config_from_env_names_every_missing_variable():
    with pytest.raises(MissingSetting) as error:
        TelephonyConfig.from_env({"ELEVENLABS_API_KEY": "secret"})
    message = str(error.value)
    assert "secret" not in message
    for var in ("ELEVENLABS_AGENT_ID", "ELEVENLABS_PHONE_NUMBER_ID", "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"):
        assert var in message


def test_secrets_are_not_in_repr():
    text = repr(CONFIG)
    assert "xi_test_key" not in text and "twilio_test_token" not in text


def test_from_env_builds_a_provider():
    env = {var: "x" for var in TelephonyConfig.ENV.values()}
    env |= {"TELEPHONY_ALLOWLIST": JOB["to_number"], "TELEPHONY_PRE_ARRANGED": JOB["to_number"]}
    calls = TwilioElevenLabsCalls.from_env(build_client_data=build_client_data, env=env)
    assert JOB["to_number"] in calls.allowlist and JOB["to_number"] in calls.pre_arranged


def test_to_transcript():
    conversation = {"transcript": [
        {"role": "agent", "time_in_call_secs": 0, "message": "السلام عليكم"},
        {"role": "agent", "time_in_call_secs": 2, "message": None, "tool_calls": [{"tool_name": "end_call"}]},
        {"role": "user", "time_in_call_secs": 3, "message": "  هلا  "},
    ]}
    assert to_transcript(conversation) == [
        {"i": 0, "speaker": "agent", "t": 0, "text": "السلام عليكم"},
        {"i": 1, "speaker": "shop", "t": 3, "text": "هلا"},
    ]
    assert to_transcript(None) == []


def test_language_of():
    assert language_of([{"text": "هلا"}, {"text": "OK, the price is 300"}]) == "en"
    assert language_of([{"text": "OK"}, {"text": "تمام 300"}]) == "ar"
    assert language_of([{"text": "300"}]) is None
    assert language_of([]) is None


def test_cost_usd():
    assert cost_usd(None, None) is None
    assert cost_usd({"price": None}, {"metadata": {"cost_fiat": None}}) is None
    assert cost_usd({"price": "-0.31", "price_unit": "USD"}, None) == 0.31
    assert cost_usd({"price": "-1.10", "price_unit": "SAR"}, {"metadata": {"cost_fiat": 0.1}}) == 0.1


def test_urllib_transport_refuses_plain_http():
    with pytest.raises(ValueError, match="non-HTTPS"):
        run(UrllibTransport().request("GET", "http://api.twilio.com/x", headers={}))
