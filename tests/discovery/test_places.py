import asyncio
import json
from pathlib import Path

import httpx
import pytest

from app.contracts import validate
from app.discovery.places import PlacesDiscovery

ROOT = Path(__file__).resolve().parents[2]
TASK = json.loads((ROOT / "contracts/examples/task_spec.json").read_text(encoding="utf-8"))
SAMPLE = json.loads(
    (ROOT / "app/discovery/examples/al_malqa_places.json").read_text(encoding="utf-8")
)


def run_search(handler, limit=2, *, report=False):
    async def search():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            discovery = PlacesDiscovery(client, "fixture-only")
            if report:
                return await discovery.search(TASK, limit)
            return await discovery.find_businesses(TASK, limit)

    return asyncio.run(search())


def test_places_request_and_selection_match_repo_contract():
    def google(request):
        assert request.method == "POST"
        assert str(request.url) == "https://places.googleapis.com/v1/places:searchText"
        assert request.headers["X-Goog-Api-Key"] == "fixture-only"
        assert set(request.headers["X-Goog-FieldMask"].split(",")) == {
            "places.id", "places.displayName", "places.formattedAddress", "places.location",
            "places.internationalPhoneNumber", "places.nationalPhoneNumber",
            "places.currentOpeningHours", "places.rating", "places.googleMapsUri",
        }
        body = json.loads(request.content)
        assert body["textQuery"] == "صيانة جوالات"
        assert body["languageCode"] == "ar"
        assert body["regionCode"] == "SA"
        assert body["openNow"] is True
        assert body["locationBias"]["circle"] == {
            "center": {"latitude": 24.8, "longitude": 46.61}, "radius": 5000,
        }
        return httpx.Response(200, json=SAMPLE)

    result = run_search(google, report=True)
    for shop in result.businesses:
        validate("business", shop)
    assert [shop["place_id"] for shop in result.businesses] == ["sample-mobile", "sample-landline"]
    assert [shop["phone_e164"] for shop in result.businesses] == ["+966500000001", "+966110000002"]
    assert [shop["number_type"] for shop in result.businesses] == ["mobile", "landline"]
    assert result.businesses[1]["open_now"] is None
    assert result.businesses[1]["rating"] is None
    reasons = [reason for _, reason in result.skipped]
    assert reasons.count("duplicate place ID") == 1
    assert reasons.count("missing or unusable Saudi phone number") == 2
    assert reasons.count("only a 920 or 800 number (the project requires a direct line)") == 2
    assert "closed" in reasons
    assert "shop limit reached" in reasons


def test_tries_next_template_query_and_deduplicates_across_responses():
    mobile = SAMPLE["places"][1]
    landline = SAMPLE["places"][4]
    replies = iter([[mobile], [mobile, landline]])
    languages = []

    def google(request):
        body = json.loads(request.content)
        languages.append((body["languageCode"], body["textQuery"]))
        return httpx.Response(200, json={"places": next(replies)})

    assert [shop["place_id"] for shop in run_search(google)] == ["sample-mobile", "sample-landline"]
    assert languages == [("ar", "صيانة جوالات"), ("en", "phone repair shop")]


def test_uses_direct_number_when_same_place_also_lists_a_service_number():
    place = {
        **SAMPLE["places"][1],
        "internationalPhoneNumber": "+966 9200 00001",
        "nationalPhoneNumber": "00966 50 000 0001",
    }
    selected = run_search(lambda _: httpx.Response(200, json={"places": [place]}), limit=1)
    assert [(shop["phone_e164"], shop["number_type"]) for shop in selected] == [
        ("+966500000001", "mobile"),
    ]


def test_no_callable_candidates_returns_empty_list():
    places = [SAMPLE["places"][i] for i in (0, 3, 5, 6, 7)]
    assert run_search(lambda _: httpx.Response(200, json={"places": places})) == []


def test_upstream_error_is_not_reported_as_no_shops():
    with pytest.raises(httpx.HTTPStatusError):
        run_search(lambda _: httpx.Response(503))
