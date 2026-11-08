import json

import pytest
from fastapi.testclient import TestClient

from app.api.main import app

REQUEST = {"text": "أبي أغير شاشة آيفون 15 برو"}
AREA = {"area": "حي الملقا"}


@pytest.fixture
def client():
    with TestClient(app) as client:
        yield client


def test_create_task_and_answer_location(client):
    created = client.post("/tasks", json=REQUEST)
    assert created.status_code == 201
    plan = created.json()
    assert plan["status"] == "needs_input"
    assert [question["key"] for question in plan["questions"]] == ["area"]
    task_id = plan["task_spec"]["task_id"]

    answered = client.post(f"/tasks/{task_id}/answers", json=AREA)
    assert answered.status_code == 201
    plan = answered.json()
    assert plan["status"] == "ready"
    assert plan["task_spec"]["task_id"] == task_id
    assert plan["task_spec"]["area"]["label"] == AREA["area"]
    assert plan["questions"] == []

    repeated = client.post(f"/tasks/{task_id}/answers", json=AREA)
    assert repeated.status_code == 409
    assert repeated.json()["error"]["code"] == "invalid_task_state"


def test_create_task_preserves_arabic_policy_error(client):
    response = client.post("/tasks", json={**REQUEST, "custom_questions": ["احجز لي موعد بكرة"]})

    assert response.status_code == 422
    plan = response.json()
    assert plan["status"] == "invalid"
    assert plan["task_spec"] is None
    assert plan["error"]["code"] == "unsafe_custom_question"
    assert plan["error"]["field"] == "custom_questions[0]"
    assert plan["error"]["message_ar"]


def test_answer_unknown_task(client):
    response = client.post("/tasks/unknown/answers", json=AREA)

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "unknown_task"


def test_start_requires_ready_task(client):
    created = client.post("/tasks", json=REQUEST).json()
    response = client.post(f"/tasks/{created['task_spec']['task_id']}/start")

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "missing_input"


@pytest.mark.parametrize(
    ("scenario", "final_event", "comparison_status", "failed_calls"),
    [
        ("default", "comparison.ready", "ranked", 0),
        ("one_failed", "comparison.ready", "partial", 1),
        ("all_failed", "task.failed", None, 3),
    ],
)
def test_run_and_stream_task(monkeypatch, scenario, final_event, comparison_status, failed_calls):
    monkeypatch.setenv("MOCK_SCENARIO", scenario)
    with TestClient(app) as client:
        created = client.post("/tasks", json={**REQUEST, **AREA}).json()
        path = f"/tasks/{created['task_spec']['task_id']}"
        assert client.post(f"{path}/start").status_code == 202
        assert client.post(f"{path}/start").status_code == 409

        response = client.get(f"{path}/events")
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("text/event-stream")
        frames = response.text.strip().split("\n\n")
        events = []
        for frame in frames:
            seq, kind, data = frame.splitlines()
            event = json.loads(data.removeprefix("data: "))
            assert seq == f"id: {event['seq']}"
            assert kind == f"event: {event['type']}"
            events.append(event)
        assert [event["seq"] for event in events] == list(range(1, len(events) + 1))
        kinds = [event["type"] for event in events]
        assert kinds.count("call.started") == 3
        assert kinds.count("call.failed") == failed_calls
        assert kinds[-1] == final_event

        snapshot = client.get(path).json()
        assert snapshot["last_seq"] == len(events)
        if comparison_status is None:
            assert snapshot["state"] == "failed"
            assert snapshot["comparison"] is None
        else:
            assert snapshot["state"] == "done"
            assert snapshot["comparison"]["status"] == comparison_status

        replay = client.get(f"{path}/events", headers={"Last-Event-ID": "6"})
        assert replay.text.strip().split("\n\n") == frames[6:]
        final_cursor = {"Last-Event-ID": str(len(events))}
        assert client.get(f"{path}/events", headers=final_cursor).status_code == 204


@pytest.mark.parametrize("cursor", ["bad", "-1", "999"])
def test_event_stream_rejects_invalid_cursor(client, cursor):
    created = client.post("/tasks", json={**REQUEST, **AREA}).json()
    task_id = created["task_spec"]["task_id"]
    response = client.get(f"/tasks/{task_id}/events", headers={"Last-Event-ID": cursor})

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_event_cursor"


def test_unknown_task_does_not_open_stream(client):
    assert client.get("/tasks/unknown/events").status_code == 404
