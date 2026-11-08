# R5 mock API

From the repository root in PowerShell, start the API in one terminal and run the demo in another:

```powershell
.\.venv\Scripts\python.exe -m uvicorn app.api.main:app --port 8002
.\.venv\Scripts\python.exe -m app.api.demo
```

Use one worker per server. By default, tasks are kept in memory. The Phase 3 walkthrough below uses PostgreSQL. The interactive API page is http://127.0.0.1:8002/docs. To try a partial comparison, set `$env:MOCK_SCENARIO = 'one_failed'` before starting a second server on port 8003 and run the demo with `--port 8003`.

## Frontend handoff

1. Send `{"text":"أبي أغير شاشة آيفون 15 برو"}` to `POST /tasks`. Use `task_spec.task_id` from the reply.
2. Send `{"area":"حي الملقا"}` to `POST /tasks/{id}/answers`. Start when the plan is `ready`.
3. Call `POST /tasks/{id}/start` (202), then open `GET /tasks/{id}/events` using browser `EventSource`. Connecting after Start is safe because the stream replays stored events. Use a same-origin development proxy if the frontend runs on a different port.
4. Subscribe to the named event types with `addEventListener`. Parse the full event from `event.data`. Key shop cards by `place_id` and calls by `call_id`. Close the connection on `comparison.ready` or `task.failed`. Use `GET /tasks/{id}` for the current snapshot.

Events use `seq` as the SSE ID. On reconnect, the API sends events after `Last-Event-ID`. Acknowledging the terminal event yields 204. Invalid or future IDs yield 400. See the [shared integration guide](../../docs/integration.md#6-r7-the-event-stream) for event types.


## Phase 3: Save a comparison and reopen it

Set `R5_DATABASE_URL` to a PostgreSQL connection string for a dedicated local development database. The API applies its versioned database setup on startup. Without the variable, the API uses the original in-memory demo. Keep the connection string out of git.

For Omar's local setup, keep the `voice-quote-r5-pg` Docker container running. From the repository root, start the API in the first PowerShell window:

```powershell
$env:R5_DATABASE_URL = Get-Content .\data\r5-phase3-database-url.txt
.\.venv\Scripts\python.exe -m uvicorn app.api.main:app --port 8004
```

In a second PowerShell window, run a simulated comparison and copy the printed task ID:

```powershell
.\.venv\Scripts\python.exe -m app.api.demo --port 8004
```

Press **Ctrl+C** in the first window to stop the API. Run the same Uvicorn command again in that window. Then use the saved ID in the second window:

```powershell
.\.venv\Scripts\python.exe -m app.api.demo --port 8004 --reopen YOUR_TASK_ID
```

Expect the original comparison, the same task ID, and a recorded cost of $0.00. The reopened demo prints the previously saved call updates. It only reads the task and its updates, so it does not start new calls. Unfinished tasks from a previous process are marked failed with a restart reason. Individual call costs come from the call-ended event when present. An unavailable cost stays unknown, and retries do not yet have an attempt-by-attempt cost breakdown.

For the database integration checks, set `R5_TEST_DATABASE_URL` to a separate test database and run `python -m pytest tests/db`. The database checks are skipped when that variable is absent.
