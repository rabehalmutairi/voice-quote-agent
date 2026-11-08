"""Integration checks using a dedicated local PostgreSQL test database."""

import asyncio
import os

import asyncpg
import pytest
from fastapi.testclient import TestClient

from app.api.main import app
from app.db.events import PostgresEventSink
from app.db.postgres import open_store
from app.mocks.scenarios import build_mock_stack

REQUEST = {"text": "أبي أغير شاشة آيفون 15 برو"}
AREA = {"area": "حي الملقا"}


@pytest.fixture
def database_url(monkeypatch):
    url = os.getenv("R5_TEST_DATABASE_URL")
    if not url:
        pytest.skip("Set R5_TEST_DATABASE_URL to a dedicated PostgreSQL test database")
    monkeypatch.setenv("R5_DATABASE_URL", url)
    return url


def test_completed_comparison_and_replay_survive_restart(database_url, monkeypatch):
    monkeypatch.setenv("MOCK_SCENARIO", "one_failed")
    with TestClient(app) as client:
        created = client.post("/tasks", json=REQUEST).json()
        path = f"/tasks/{created['task_spec']['task_id']}"
        assert client.post(f"{path}/answers", json=AREA).json()["status"] == "ready"
        assert client.post(f"{path}/start").status_code == 202
        stream = client.get(f"{path}/events")
        assert stream.status_code == 200
        original = stream.text
        before = client.get(path).json()

    assert before["state"] == "done"
    assert before["comparison"]["status"] == "partial"
    assert before["cost_usd"] == 0
    assert [call["cost_usd"] for call in before["calls"]].count(0) == 2
    assert [call["cost_usd"] for call in before["calls"]].count(None) == 1
    assert before["task_spec"]["area"]["label"] == AREA["area"]
    assert "event: comparison.ready" in original

    with TestClient(app) as client:
        assert client.get(path).json() == before
        assert client.post(f"{path}/start").status_code == 409
        replay = client.get(f"{path}/events", headers={"Last-Event-ID": "6"})
        assert replay.text == "".join(original.splitlines(keepends=True)[6 * 4:])
        assert client.get(
            f"{path}/events", headers={"Last-Event-ID": str(before["last_seq"])}
        ).status_code == 204


def test_unfinished_task_keeps_answer_and_replay_ends_after_restart(database_url):
    with TestClient(app) as client:
        created = client.post("/tasks", json=REQUEST).json()
        path = f"/tasks/{created['task_spec']['task_id']}"
        assert client.post(f"{path}/answers", json=AREA).json()["status"] == "ready"

    with TestClient(app) as client:
        saved = client.get(path).json()
        assert saved["state"] == "failed"
        assert "restarted" in saved["failure_reason"]
        assert saved["task_spec"]["area"]["label"] == AREA["area"]
        assert saved["last_seq"] == 2
        replay = client.get(f"{path}/events", headers={"Last-Event-ID": "1"})
        assert replay.text.startswith("id: 2\nevent: task.needs_input\n")
        assert client.get(f"{path}/events", headers={"Last-Event-ID": "2"}).status_code == 204


def test_slow_subscriber_and_duplicate_cannot_damage_saved_events(database_url):
    async def exercise():
        async with open_store(database_url) as store:
            sink = PostgresEventSink(store, lambda task_id: stack.orchestrator.get(task_id), queue_size=1)
            stack = build_mock_stack(speed=0, events=sink)
            plan = await stack.planner.plan(REQUEST["text"], area=AREA["area"])
            task_id = plan.task_spec["task_id"]
            await stack.orchestrator.submit(plan.task_spec)

            stream = sink.follow(task_id)
            assert (await anext(stream))["seq"] == 1
            final = await stack.orchestrator.run(task_id)
            with pytest.raises(StopAsyncIteration):
                await anext(stream)

            saved_events = await store.replay(task_id, 0)
            assert final["state"] == "done"
            assert [event["seq"] for event in saved_events] == list(range(1, final["last_seq"] + 1))
            assert saved_events[-1]["type"] == "comparison.ready"
            with pytest.raises(asyncpg.UniqueViolationError):
                await sink.publish(saved_events[0])
            assert await store.replay(task_id, 0) == saved_events
            assert (await store.snapshot(task_id))["last_seq"] == final["last_seq"]

    asyncio.run(exercise())
