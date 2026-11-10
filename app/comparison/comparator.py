"""R6Comparator: Quotes -> Comparison, like for like or not at all.

How it decides (all from the template, no category-specific code):

1. Each shop's **rankable offers** (usable.py): a verified exact price, every grouping
   value known (`compare_on` choices/yes-no: part type, condition, part brand + labor),
   and not out of stock.
2. Offers are grouped by those grouping values: "commercial" screens only compete with
   "commercial" screens. The **basis** is the group quoted by the most shops; on a tie,
   the one with the lowest price, then the first one quoted.
3. Within the basis, shops are ranked by lowest exact price, then by the other
   `compare_on` numbers (longer warranty wins), then discovery order. Each shop's best
   offer in that group is the one shown.
4. Status:
   - `ranked`: at least 2 shops in the basis and nothing excluded;
   - `partial`: at least 2 ranked, and some shops excluded (failed call or extraction,
     no usable price, or they only quoted a different option);
   - `cannot_compare`: fewer than 2 shops share a like-for-like option (one usable
     quote, or shops quoted different options). `cannot_compare_reasons` says why;
   - `side_by_side`: no shop gave anything rankable, but at least one answered the
     user's own question: the UI shows the answers next to each other.

A ranking of one shop is not a comparison, so it is `cannot_compare` (decision with R1).
"""

from __future__ import annotations

import copy

from app.comparison.usable import (
    AVAILABILITY,
    PRICE,
    exact_number,
    grouping_fields,
    not_rankable_reason,
    rankable_offers,
    tiebreak_fields,
)
from app.contracts import validate

# Numbers where more is better when breaking a price tie. Others: less is better.
HIGHER_IS_BETTER = frozenset({"warranty_days"})
SUBJECT = {"electronics_repair": "part", "stock_check": "item", "car_repair": "parts"}
MIN_TO_COMPARE = 2


def _value_label(name: str, value: object) -> str:
    if isinstance(value, bool):
        if name.endswith("_included"):
            return f"{name.removesuffix('_included').replace('_', ' ')} {'included' if value else 'not included'}"
        return name.replace("_", " ") if value else f"no {name.replace('_', ' ')}"
    return str(value).replace("_", " ")


def option_label(key: tuple, template: dict) -> str:
    """'commercial part', 'new item', 'aftermarket, labor included parts'."""
    parts = [_value_label(name, value) for name, value in zip(grouping_fields(template), key)]
    return f"{', '.join(parts)} {SUBJECT.get(template['category'], 'option')}".strip()


def _number_from(offer: dict, quote: dict, name: str) -> dict | None:
    field = offer.get(name)
    if field and field["status"] != "not_mentioned":
        return field
    return quote["fields"].get(name)


def _sort_key(offer: dict, quote: dict, template: dict, order: int) -> tuple:
    key: list[float] = [exact_number(offer[PRICE])]
    for name in tiebreak_fields(template):
        field = _number_from(offer, quote, name)
        number = exact_number(field)
        if number is None and field and field["status"] == "found":
            number = field["value_min"]  # a range counts as its worst case
        if number is None:
            key.append(float("inf"))  # not stated: ranks after any stated value
        else:
            key.append(-number if name in HIGHER_IS_BETTER else number)
    key.append(order)
    return tuple(key)


def _details(offer: dict, quote: dict, template: dict) -> str:
    """'450 SAR with a 30-day warranty, in stock'."""
    text = f"{exact_number(offer[PRICE]):g} SAR"
    if "warranty_days" in template["fields"]:
        field = _number_from(offer, quote, "warranty_days")
        days = exact_number(field)
        if days is not None:
            text += f" with a {days:g}-day warranty"
        elif field and field["status"] == "found":
            text += f" with a {field['value_min']:g}-{field['value_max']:g}-day warranty"
        else:
            text += ", warranty not stated"
    availability = _number_from(offer, quote, AVAILABILITY) if AVAILABILITY in template["fields"] else None
    if availability and availability["status"] == "found":
        text += f", {_value_label(AVAILABILITY, availability['value'])}"
    return text


def _basis(key: tuple, template: dict) -> str:
    text = f"{option_label(key, template)}, lowest exact price"
    for name in tiebreak_fields(template):
        label = name.removesuffix("_days").removesuffix("_minutes").replace("_", " ")
        text += f", then {'longer' if name in HIGHER_IS_BETTER else 'shorter'} {label}"
    return text


def compare_quotes(task_spec: dict, template: dict, quotes: list[dict], excluded: list[dict]) -> dict:
    """The comparison itself (pure function). `quotes` in discovery order."""
    excluded = copy.deepcopy(excluded)
    taken = {item["place_id"] for item in excluded}
    base = {"task_id": task_spec["task_id"]}
    quotes = [q for q in quotes if q["place_id"] not in taken]

    # 1-2. rankable offers, grouped like for like: group -> place_id -> (sort key, offer, quote)
    groups: dict[tuple, dict[str, tuple]] = {}
    group_order: list[tuple] = []
    not_rankable: list[dict] = []
    if PRICE in template["fields"]:
        for order, quote in enumerate(quotes):
            offers = rankable_offers(quote, template)
            if not offers:
                not_rankable.append(quote)
            for key, offer in offers:
                if key not in groups:
                    groups[key] = {}
                    group_order.append(key)
                candidate = (_sort_key(offer, quote, template, order), offer, quote)
                best = groups[key].get(quote["place_id"])
                if best is None or candidate[0] < best[0]:
                    groups[key][quote["place_id"]] = candidate
    else:
        not_rankable = list(quotes)

    unusable = [{"place_id": q["place_id"], "reason": not_rankable_reason(q, template)} for q in not_rankable]

    # 4. nothing to rank: side by side (answers only) or cannot compare
    if not groups:
        if any(answer["status"] == "found" for quote in quotes for answer in quote["answers"]):
            return {**base, "status": "side_by_side", "basis": None, "ranking": [],
                    "excluded": excluded, "cannot_compare_reasons": []}
        reason = "no shop gave a verified exact price" if quotes else "no shop gave a usable answer"
        return _cannot_compare(base, excluded + unusable, [reason])

    def strength(key: tuple) -> tuple:
        shops = groups[key]
        return (-len(shops), min(entry[0][0] for entry in shops.values()), group_order.index(key))

    basis_key = min(groups, key=strength)
    ranked = sorted(groups[basis_key].values(), key=lambda entry: entry[0])

    if len(ranked) < MIN_TO_COMPARE:
        shops_with_offers = {place for shops in groups.values() for place in shops}
        if len(shops_with_offers) < MIN_TO_COMPARE:
            reasons = ["only one shop gave a usable quote; at least two are needed to compare"]
        else:
            quoted = []
            for quote in quotes:
                keys = [k for k in group_order if quote["place_id"] in groups[k]]
                if keys:
                    quoted.append(f"{quote['place_id']}: {' / '.join(option_label(k, template) for k in keys)}")
            reasons = ["the shops quoted different options, so their prices are not like for like ("
                       + "; ".join(quoted) + ")"]
        return _cannot_compare(base, excluded + unusable, reasons)

    # 3. ranking within the basis
    label = option_label(basis_key, template)
    ranking = []
    for rank, (_, offer, quote) in enumerate(ranked, start=1):
        prefix = f"cheapest {label}" if rank == 1 else label
        ranking.append({"place_id": quote["place_id"], "rank": rank, "reason": f"{prefix}: {_details(offer, quote, template)}"})

    in_basis = set(groups[basis_key])
    other_options = []
    for quote in quotes:
        if quote["place_id"] in in_basis or quote in not_rankable:
            continue
        keys = [k for k in group_order if quote["place_id"] in groups[k]]
        options = " / ".join(option_label(k, template) for k in keys)
        other_options.append({"place_id": quote["place_id"],
                              "reason": f"quoted only {options}; not like for like with {label}"})
    excluded = excluded + unusable + other_options
    order = {q["place_id"]: i for i, q in enumerate(quotes)}
    excluded.sort(key=lambda item: order.get(item["place_id"], -1))  # failed shops first, then quotes in order

    return {
        **base,
        "status": "partial" if excluded else "ranked",
        "basis": _basis(basis_key, template),
        "ranking": ranking,
        "excluded": excluded,
        "cannot_compare_reasons": [],
    }


def _cannot_compare(base: dict, excluded: list[dict], reasons: list[str]) -> dict:
    return {**base, "status": "cannot_compare", "basis": None, "ranking": [],
            "excluded": excluded, "cannot_compare_reasons": reasons}


class R6Comparator:
    """The Comparator the orchestrator calls (app/orchestrator/interfaces.py)."""

    async def compare(self, task_spec: dict, template: dict, quotes: list[dict], excluded: list[dict]) -> dict:
        return validate("comparison", compare_quotes(task_spec, template, quotes, excluded))
