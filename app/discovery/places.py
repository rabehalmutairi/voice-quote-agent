"""Google Places Text Search adapter. The caller supplies the HTTP client."""

import re
from dataclasses import dataclass, field

import httpx

from app.contracts import contract_errors, get_template
from app.planner.text import western_digits

SEARCH_URL = "https://places.googleapis.com/v1/places:searchText"
FIELD_MASK = ",".join(
    f"places.{name}"
    for name in (
        "id", "displayName", "formattedAddress", "location",
        "internationalPhoneNumber", "nationalPhoneNumber", "currentOpeningHours",
        "rating", "googleMapsUri",
    )
)

_DIRECT = {"mobile", "landline"}
_SAUDI_NUMBER_TYPES = (
    (r"5[0-9]{8}", "mobile"),
    (r"1[123467][0-9]{7}", "landline"),
    (r"9200[0-9]{5}", "unified_920"),
    (r"800[0-9]{7}", "toll_free_800"),
)


def normalize_phone(value: object) -> tuple[str, str] | None:
    """Normalize a Saudi business number and identify its line type."""
    if not isinstance(value, str):
        return None
    digits = re.sub(r"[\s().-]", "", western_digits(value))
    if digits.startswith("+966"):
        national = digits[4:]
    elif digits.startswith("00966"):
        national = digits[5:]
    elif digits.startswith("0"):
        national = digits[1:]
    else:
        # National service numbers are commonly listed without a leading zero.
        national = digits if digits.startswith(("9200", "800")) else ""
    for pattern, kind in _SAUDI_NUMBER_TYPES:
        if re.fullmatch(pattern, national):
            return f"+966{national}", kind
    return None


def _make_business(place: dict) -> tuple[dict | None, str]:
    hours = place.get("currentOpeningHours")
    open_now = hours.get("openNow") if isinstance(hours, dict) else None
    if open_now is False:
        return None, "closed"

    raw_phones = [place.get("internationalPhoneNumber"), place.get("nationalPhoneNumber")]
    phones = [phone for value in raw_phones if (phone := normalize_phone(value))]
    direct = next((phone for phone in phones if phone[1] in _DIRECT), None)
    if direct is None:
        if phones:
            return None, "only a 920 or 800 number (the project requires a direct line)"
        return None, "missing or unusable Saudi phone number"

    name = place.get("displayName")
    business = {
        "place_id": place.get("id"),
        "name": name.get("text") if isinstance(name, dict) else None,
        "address": place.get("formattedAddress"),
        "maps_url": place.get("googleMapsUri"),
        "open_now": open_now,
        "rating": place.get("rating"),
        "phone_e164": direct[0],
        "number_type": direct[1],
    }
    if contract_errors("business", business):
        return None, "incomplete or invalid shop details"
    return business, ""


@dataclass
class Selection:
    businesses: list[dict] = field(default_factory=list)
    skipped: list[tuple[str, str]] = field(default_factory=list)


class PlacesDiscovery:
    """Return distinct, directly callable shops in Places relevance order."""

    def __init__(self, client: httpx.AsyncClient, api_key: str) -> None:
        self.client = client
        self.api_key = api_key

    async def find_businesses(self, task_spec: dict, limit: int) -> list[dict]:
        return (await self.search(task_spec, limit)).businesses

    async def search(self, task_spec: dict, limit: int) -> Selection:
        selection = Selection()
        if limit <= 0:
            return selection

        area = task_spec["area"]
        queries = get_template(task_spec["category"])["places_queries"]
        seen: set[str] = set()
        for language in ("ar", "en"):
            for query in dict.fromkeys(queries[language]):
                places = await self._search_text(query, language, area)
                for place in places:
                    if not isinstance(place, dict):
                        selection.skipped.append(("Unnamed shop", "invalid result"))
                        continue
                    name = place.get("displayName")
                    label = name.get("text") if isinstance(name, dict) else None
                    label = label or place.get("id") or "Unnamed shop"
                    business, reason = _make_business(place)
                    if business is None:
                        selection.skipped.append((label, reason))
                    elif business["place_id"] in seen:
                        selection.skipped.append((label, "duplicate place ID"))
                    else:
                        seen.add(business["place_id"])
                        if len(selection.businesses) < limit:
                            selection.businesses.append(business)
                        else:
                            selection.skipped.append((label, "shop limit reached"))
                if len(selection.businesses) == limit:
                    return selection
        return selection

    async def _search_text(self, query: str, language: str, area: dict) -> list[dict]:
        response = await self.client.post(
            SEARCH_URL,
            headers={"X-Goog-Api-Key": self.api_key, "X-Goog-FieldMask": FIELD_MASK},
            json={
                "textQuery": query,
                "languageCode": language,
                "regionCode": "SA",
                "openNow": True,
                "pageSize": 20,
                "locationBias": {
                    "circle": {
                        "center": {"latitude": area["lat"], "longitude": area["lng"]},
                        "radius": area["radius_m"],
                    }
                },
            },
        )
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict) or not isinstance(payload.get("places", []), list):
            raise ValueError("Places Text Search returned an unexpected response")
        return payload.get("places", [])
