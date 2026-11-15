"""What counts as a usable quote, per category (R6 owns these rules: architecture §6, §10).

"Usable" means the shop's answer is worth showing as a result and, later, means we don't
need to phone a backup shop instead (plan §5). Every value used here has already passed
the evidence checker, so "found" means "found AND backed by the shop's own words".

Rules today:

| Category | Usable when | Rankable offer (used by the comparator) |
|---|---|---|
| electronics_repair | at least one rankable offer | verified exact `price_sar` + a known `part_type` (not `unknown`) |
| car_repair (stretch) | at least one rankable offer | verified exact `price_sar` + known `part_brand` + known `labor_included` |
| stock_check | verified `availability` (in stock, needs order, or out of stock: "they don't have it" is a real answer) | verified exact `price_sar` + known `condition`, and not `out_of_stock` |
| any new category | at least one rankable offer if it has `price_sar`, else any required field found | as above, from its `compare_on` |

A price given only as a range ("من ٤٠٠ لـ ٥٠٠") is shown to the user but not ranked:
ranking a range against an exact price would not be like for like.

The rankable-offer rule is generic: the template's `compare_on` fields of type `choice` or
`boolean` decide which offers are like for like (they must all be known), `price_sar` is
what is ranked, and other `compare_on` numbers (warranty) break ties.
"""

from __future__ import annotations

PRICE = "price_sar"
AVAILABILITY = "availability"
FOUND = "found"
UNKNOWN_CHOICES = frozenset({"unknown"})
NOT_AVAILABLE = frozenset({"out_of_stock"})


def exact_number(field: dict | None) -> float | None:
    """The exact number of a verified value, or None (missing, not found, or a range)."""
    if not field or field["status"] != FOUND:
        return None
    value = field["value"]
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def grouping_fields(template: dict) -> list[str]:
    """compare_on fields that make two offers like for like (choices and yes/no)."""
    return [k for k in template["compare_on"] if template["fields"][k]["type"] in ("choice", "boolean")]


def tiebreak_fields(template: dict) -> list[str]:
    """compare_on numbers other than the price (e.g. warranty_days)."""
    return [k for k in template["compare_on"] if k != PRICE and template["fields"][k]["type"] == "number"]


def group_key(offer: dict, template: dict) -> tuple | None:
    """Which like-for-like group an offer belongs to, or None if any grouping value is unknown."""
    key = []
    for name in grouping_fields(template):
        field = offer.get(name)
        if not field or field["status"] != FOUND or field["value"] in UNKNOWN_CHOICES:
            return None
        key.append(field["value"])
    return tuple(key)


def _available(offer: dict, quote: dict) -> bool:
    field = offer.get(AVAILABILITY) or quote["fields"].get(AVAILABILITY)
    return not (field and field["status"] == FOUND and field["value"] in NOT_AVAILABLE)


def rankable_offers(quote: dict, template: dict) -> list[tuple[tuple, dict]]:
    """(group key, offer) for every offer the comparator may rank."""
    result = []
    for offer in quote["offers"]:
        key = group_key(offer, template)
        if key is not None and exact_number(offer.get(PRICE)) is not None and _available(offer, quote):
            result.append((key, offer))
    return result


def _found_anywhere(quote: dict, name: str) -> bool:
    fields = [offer.get(name) for offer in quote["offers"]] + [quote["fields"].get(name)]
    return any(field and field["status"] == FOUND for field in fields)


def is_usable(quote: dict, template: dict) -> bool:
    """Is this Quote a usable answer for its category? (See the table above.)"""
    category = template["category"]
    if category == "stock_check":
        return _found_anywhere(quote, AVAILABILITY)
    if PRICE in template["fields"]:
        return bool(rankable_offers(quote, template))
    return any(_found_anywhere(quote, name) for name in template["required_fields"])


def not_rankable_reason(quote: dict, template: dict) -> str:
    """Why a Quote has no rankable offer, in a short sentence for Comparison.excluded."""
    offers = quote["offers"]
    prices = [offer.get(PRICE) for offer in offers]
    known = " / ".join(name.replace("_", " ") for name in grouping_fields(template))
    if any(exact_number(p) is not None and group_key(o, template) is None for p, o in zip(prices, offers)):
        return f"price given without a known {known}"
    if any(exact_number(p) is not None for p in prices):
        return "out of stock"
    if any(p and p["status"] == FOUND and p["value_min"] is not None for p in prices):
        return "gave only a price range, not an exact price"
    if any(p and p["status"] == "refused" for p in prices):
        return "would not give a price over the phone"
    if any(p and p["status"] == "unclear" for p in prices):
        return "the price was unclear"
    return "no verified price"
