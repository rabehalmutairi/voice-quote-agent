"""Store task snapshots and their numbered events in the same transaction."""

import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from decimal import Decimal
from pathlib import Path

import asyncpg

_MIGRATIONS = Path(__file__).with_name("migrations")


@asynccontextmanager
async def open_store(url: str) -> AsyncIterator["PostgresStore"]:
    async with asyncpg.create_pool(url, min_size=1, max_size=5, timeout=5) as pool:
        store = PostgresStore(pool)
        await store.migrate()
        yield store


class PostgresStore:
    def __init__(self, pool: asyncpg.Pool) -> None:
        self.pool = pool

    async def migrate(self) -> None:
        async with self.pool.acquire() as conn, conn.transaction():
            await conn.execute("SELECT pg_advisory_xact_lock(58732305)")
            await conn.execute("CREATE TABLE IF NOT EXISTS r5_migrations (version text PRIMARY KEY)")
            for path in sorted(_MIGRATIONS.glob("*.sql")):
                if not await conn.fetchval("SELECT 1 FROM r5_migrations WHERE version = $1", path.name):
                    await conn.execute(path.read_text(encoding="utf-8"))
                    await conn.execute("INSERT INTO r5_migrations VALUES ($1)", path.name)

    async def record(self, event: dict, snapshot: dict) -> None:
        task_id, seq = event["task_id"], event["seq"]
        async with self.pool.acquire() as conn, conn.transaction():
            await conn.execute(
                """INSERT INTO tasks (task_id, last_seq, snapshot) VALUES ($1, $2, $3)
                   ON CONFLICT (task_id) DO UPDATE
                   SET last_seq = EXCLUDED.last_seq, snapshot = EXCLUDED.snapshot""",
                task_id, seq, json.dumps(snapshot),
            )
            await conn.execute(
                "INSERT INTO events (task_id, seq, payload) VALUES ($1, $2, $3)",
                task_id, seq, json.dumps(event),
            )
            await self._record_result(conn, event)

    async def save_ready_snapshot(self, snapshot: dict) -> None:
        # A successful final answer emits no event. A newer event snapshot wins if it
        # arrived while this write was pending.
        await self.pool.execute(
            "UPDATE tasks SET snapshot = $3 WHERE task_id = $1 AND last_seq = $2",
            snapshot["task_id"], snapshot["last_seq"], json.dumps(snapshot),
        )

    async def snapshot(self, task_id: str) -> dict | None:
        value = await self.pool.fetchval("SELECT snapshot FROM tasks WHERE task_id = $1", task_id)
        return json.loads(value) if value is not None else None

    async def replay(self, task_id: str, cursor: int) -> list[dict]:
        rows = await self.pool.fetch(
            "SELECT payload FROM events WHERE task_id = $1 AND seq > $2 ORDER BY seq",
            task_id, cursor,
        )
        return [json.loads(row["payload"]) for row in rows]

    async def event_type(self, task_id: str, seq: int) -> str | None:
        return await self.pool.fetchval(
            "SELECT payload->>'type' FROM events WHERE task_id = $1 AND seq = $2", task_id, seq
        )

    async def call_costs(self, task_id: str) -> dict[str, float | None]:
        rows = await self.pool.fetch("SELECT call_id, cost_usd FROM calls WHERE task_id = $1", task_id)
        return {
            row["call_id"]: float(row["cost_usd"]) if row["cost_usd"] is not None else None
            for row in rows
        }

    @staticmethod
    async def _record_result(conn: asyncpg.Connection, event: dict) -> None:
        task_id, kind, data = event["task_id"], event["type"], event["data"]
        if kind == "business.found":
            await conn.execute(
                "INSERT INTO businesses VALUES ($1, $2, $3)", task_id, data["place_id"], json.dumps(data)
            )
        elif kind in {"call.started", "call.ended", "call.failed"}:
            cost = data.get("cost_usd")
            await conn.execute(
                """INSERT INTO calls VALUES ($1, $2, $3, $4, $5, $6)
                   ON CONFLICT (task_id, call_id) DO UPDATE
                   SET event_type = EXCLUDED.event_type, payload = EXCLUDED.payload,
                       cost_usd = EXCLUDED.cost_usd""",
                task_id, data["call_id"], data["place_id"], kind, json.dumps(data),
                Decimal(str(cost)) if cost is not None else None,
            )
        elif kind == "quote.ready":
            await conn.execute(
                "INSERT INTO quotes VALUES ($1, $2, $3)", task_id, data["place_id"], json.dumps(data)
            )
        elif kind == "comparison.ready":
            await conn.execute("INSERT INTO comparisons VALUES ($1, $2)", task_id, json.dumps(data))
