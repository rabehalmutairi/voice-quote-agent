"""Show how the Places adapter picks shops from a hand-written sample."""

import argparse
import asyncio
import json
from pathlib import Path
import sys

import httpx

from app.discovery.places import PlacesDiscovery

_SAMPLE = Path(__file__).with_name("examples") / "al_malqa_places.json"


async def _demo(limit: int) -> None:
    sample = json.loads(_SAMPLE.read_text(encoding="utf-8"))
    task = {
        "category": "electronics_repair",
        "area": {"label": "حي الملقا", "lat": 24.80, "lng": 46.61, "radius_m": 5000},
    }
    print(f"Sample data only. Phone repair search near {task['area']['label']} (limit: {limit}).")

    def sample_response(_request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json=sample)

    async with httpx.AsyncClient(transport=httpx.MockTransport(sample_response)) as client:
        selection = await PlacesDiscovery(client, "sample-only").search(task, limit)

    print("\nSelected shops:")
    for number, shop in enumerate(selection.businesses, 1):
        print(f"  {number}. {shop['name']} — {shop['phone_e164']} ({shop['number_type']})")

    print("\nSkipped results:")
    for name, reason in selection.skipped:
        print(f"  {name} — {reason}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--limit", type=int, choices=range(1, 5), default=2)
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    asyncio.run(_demo(args.limit))


if __name__ == "__main__":
    main()
