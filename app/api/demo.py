"""Watch a simulated comparison or replay a saved task through the local API."""

import argparse
import json
import sys

import httpx


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8002)
    parser.add_argument("--reopen", metavar="TASK_ID", help="show saved results and replay updates")
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")

    with httpx.Client(base_url=f"http://127.0.0.1:{args.port}", timeout=10) as client:
        if args.reopen:
            task_id = args.reopen
            path = f"/tasks/{task_id}"
            snapshot = client.get(path).raise_for_status().json()
            print(f"Reopened {task_id}: {snapshot['state']}. Showing saved updates only.", flush=True)
            if snapshot["failure_reason"]:
                print(snapshot["failure_reason"], flush=True)
        else:
            request = {"text": "أبي أغير شاشة آيفون 15 برو"}
            plan = client.post("/tasks", json=request).raise_for_status().json()
            task_id = plan["task_spec"]["task_id"]
            path = f"/tasks/{task_id}"
            print(plan["questions"][0]["ask_ar"], flush=True)
            print("Answering: حي الملقا", flush=True)
            client.post(f"{path}/answers", json={"area": "حي الملقا"}).raise_for_status()
            client.post(f"{path}/start").raise_for_status()

        _show_events(client, path)
        snapshot = client.get(path).raise_for_status().json()
        print(f"\nTask ID: {task_id}")
        print(f"Recorded task cost: ${snapshot['cost_usd']:.2f}")
        names = {shop["place_id"]: shop["name"] for shop in snapshot["businesses"]}
        for call in snapshot["calls"]:
            if "cost_usd" in call:
                cost = call["cost_usd"]
                shown = "unknown" if cost is None else f"${cost:.2f}"
                print(f"  {names[call['place_id']]}: {shown}")


def _show_events(client: httpx.Client, path: str) -> None:
    shops = {}
    with client.stream("GET", f"{path}/events") as stream:
        stream.raise_for_status()
        for line in stream.iter_lines():
            if not line.startswith("data: "):
                continue
            event = json.loads(line.removeprefix("data: "))
            kind, data = event["type"], event["data"]
            if kind == "business.found":
                shops[data["place_id"]] = data["name"]
            elif kind == "call.started":
                print(f"  Calling: {shops[data['place_id']]}", flush=True)
            elif kind == "call.ended":
                print(f"  Answered: {shops[data['place_id']]}", flush=True)
            elif kind == "call.failed":
                print(f"  No quote: {shops[data['place_id']]} ({data['reason']})", flush=True)
            elif kind == "comparison.ready":
                print(f"\nComparison ({data['status']}):", flush=True)
                for row in data["ranking"]:
                    print(f"  {row['rank']}. {shops[row['place_id']]} — {row['reason']}")
            elif kind == "task.failed":
                print(f"\nTask failed: {data['reason']}")


if __name__ == "__main__":
    main()
