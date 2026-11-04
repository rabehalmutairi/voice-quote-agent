"""The EventSink rule: stored = published; broadcasting can't un-publish; replay fills gaps.

Tests both sides: the orchestrator's numbering when storage fails, and the reference
in-memory sink R5 can mirror (store, then best-effort broadcast, then replay on reconnect).
"""

import asyncio

from conftest import assert_valid_event_stream, run, submit_ready_task

from app.mocks import InMemoryEventSink, build_mock_stack


def event(seq, kind="call.started", task_id="tsk_a"):
    return {"seq": seq, "type": kind, "task_id": task_id, "at": "2026-11-05T10:00:00Z", "data": {}}


# -- orchestrator side ----------------------------------------------------------------------


class StorageFailsOnce(InMemoryEventSink):
    """Storage itself fails once (nothing stored), on the first event of `kind`."""

    def __init__(self, kind):
        super().__init__()
        self.kind, self.attempted = kind, []

    async def publish(self, event):
        self.attempted.append(event["seq"])
        if event["type"] == self.kind:
            self.kind = None
            raise ConnectionError("database down")
        await super().publish(event)


def test_a_failed_store_reuses_its_seq_so_storage_has_no_gap():
    sink = StorageFailsOnce("business.found")
    stack = build_mock_stack(speed=0, events=sink)
    task = run(stack.orchestrator.run(run(submit_ready_task(stack))))
    assert task["state"] == "failed"
    # seq 2 was attempted twice: once for business.found (not stored), once for task.failed.
    assert sink.attempted == [1, 2, 2]
    assert [e["type"] for e in sink.events] == ["task.created", "task.failed"]
    assert_valid_event_stream(sink.events, task["task_id"])


def test_a_broadcast_failure_does_not_stop_the_task():
    def broken_display(event):
        raise RuntimeError("UI push failed")

    stack = build_mock_stack(speed=0, events=InMemoryEventSink(on_event=broken_display))
    task = run(stack.orchestrator.run(run(submit_ready_task(stack))))
    assert task["state"] == "done"  # the events were stored, so publishing succeeded
    assert_valid_event_stream(stack.events.events, task["task_id"])


# -- reference sink: store first, then best-effort fan-out, then replay -----------------------------


def test_a_slow_subscriber_is_dropped_but_publish_never_raises():
    async def scenario():
        sink = InMemoryEventSink(queue_size=1)
        stream = sink.follow("tsk_a")
        first = asyncio.create_task(anext(stream))  # subscribes, then waits
        await asyncio.sleep(0)
        for seq in range(1, 5):  # far more than the queue holds
            await sink.publish(event(seq))
        received = [await first] + [await anext(stream) for _ in range(3)]
        await stream.aclose()
        return sink, received

    sink, received = run(scenario())
    assert [e["seq"] for e in sink.events] == [1, 2, 3, 4]  # all stored
    assert [e["seq"] for e in received] == [1, 2, 3, 4]  # caught up from storage, in order, no duplicates


def test_reconnect_with_last_event_id_replays_only_what_was_missed():
    async def scenario():
        sink = InMemoryEventSink()
        for seq in range(1, 4):
            await sink.publish(event(seq))
        stream = sink.follow("tsk_a", after_seq=2)  # browser saw 1 and 2, then disconnected
        got = [await anext(stream)]
        await sink.publish(event(4, "comparison.ready"))
        got.append(await anext(stream))
        rest = [e async for e in stream]  # ends after the final event
        return got, rest

    got, rest = run(scenario())
    assert [e["seq"] for e in got] == [3, 4] and rest == []


def test_an_event_both_replayed_and_streamed_is_sent_once():
    # In R5's version the replay is a DB query that takes time, so an event published
    # during the query arrives twice: in the query result and on the live queue.
    class SlowReplaySink(InMemoryEventSink):
        def replay(self, task_id, after_seq=0):
            stored = super().replay(task_id, after_seq)
            for queue in self._subscribers.get(task_id, ()):
                for e in stored:
                    queue.put_nowait(e)  # the same events also arrive live
            return stored

    async def scenario():
        sink = SlowReplaySink()
        await sink.publish(event(1))
        await sink.publish(event(2))
        stream = sink.follow("tsk_a")
        got = [await anext(stream), await anext(stream)]
        pending = asyncio.create_task(anext(stream))
        await asyncio.sleep(0)
        await sink.publish(event(3, "task.failed"))
        got.append(await pending)
        return got

    assert [e["seq"] for e in run(scenario())] == [1, 2, 3]


def test_follow_on_a_finished_task_replays_then_stops():
    async def scenario():
        sink = InMemoryEventSink()
        await sink.publish(event(1, "task.created"))
        await sink.publish(event(2, "task.failed"))
        return [e["seq"] async for e in sink.follow("tsk_a")]

    assert run(scenario()) == [1, 2]


def test_follow_a_live_task_end_to_end_gets_every_event_once():
    stack = build_mock_stack("one_failed", speed=0.02)

    async def scenario():
        task_id = await submit_ready_task(stack)
        runner = stack.orchestrator.start(task_id)
        streamed = [e async for e in stack.events.follow(task_id, after_seq=0)]
        await runner
        return task_id, streamed

    task_id, streamed = run(scenario())
    assert streamed == stack.events.for_task(task_id)
    assert_valid_event_stream(streamed, task_id)


def test_subscribers_only_get_their_own_task():
    async def scenario():
        sink = InMemoryEventSink()
        stream = sink.follow("tsk_a")
        pending = asyncio.create_task(anext(stream))
        await asyncio.sleep(0)
        await sink.publish(event(1, task_id="tsk_b"))
        await sink.publish(event(1, "task.failed", task_id="tsk_a"))
        return await pending

    assert run(scenario())["task_id"] == "tsk_a"
