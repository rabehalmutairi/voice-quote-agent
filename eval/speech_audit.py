"""Compare human-reviewed speech values by field, offer and canonical value."""

from __future__ import annotations

import math
import re
from collections import defaultdict
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from eval.speech import Clip

_NUMERIC_FIELDS = {"price_sar", "turnaround_minutes", "warranty_days", "capacity_gb", "quantity"}
_ID = re.compile(r"[a-z0-9]+(?:_[a-z0-9]+)*")
Mention = tuple[str, str, str | float | tuple[float, float]]
Counts = tuple[int, int, int]


def audit_sheet(clips: list[Clip], transcripts: dict[str, dict[str, str]]) -> list[dict]:
    """Return a sheet tied to the exact reference and hypotheses under review."""
    return [
        {
            "id": clip.id,
            "reference": {"text": clip.reference, "mentions": None},
            **{
                provider: {"text": items[clip.id], "mentions": None}
                for provider, items in transcripts.items()
            },
        }
        for clip in clips
    ]


def _number(value: object) -> bool:
    return type(value) in (float, int) and math.isfinite(value) and value >= 0


def _mentions(raw: list[dict], context: str) -> set[Mention]:
    if not isinstance(raw, list):
        raise ValueError(f"{context}: mentions must be an array or null")
    mentions = set()
    slots = set()
    for item in raw:
        if not isinstance(item, dict) or item.keys() != {"field", "scope", "value"}:
            raise ValueError(f"{context}: each mention needs field, scope and value")
        field, scope, value = item["field"], item["scope"], item["value"]
        if not isinstance(scope, str) or not _ID.fullmatch(scope):
            raise ValueError(f"{context}: scope must be a lowercase identifier")
        if field == "model":
            if not isinstance(value, str) or not _ID.fullmatch(value):
                raise ValueError(f"{context}: model must be a lowercase identifier")
        elif isinstance(field, str) and field in _NUMERIC_FIELDS:
            if isinstance(value, list) and len(value) == 2 and all(map(_number, value)) and value[0] <= value[1]:
                value = tuple(value)
            elif not _number(value):
                raise ValueError(f"{context}: {field} needs a non-negative number or ordered range")
        else:
            raise ValueError(f"{context}: unknown mention field {field!r}")
        if (field, scope) in slots:
            raise ValueError(f"{context}: repeated {field} for {scope}")
        slots.add((field, scope))
        mentions.add((field, scope, value))
    return mentions


def _matches(reference: set[Mention], hypothesis: set[Mention]) -> dict[str, Counts]:
    matches = reference & hypothesis
    missed = reference - hypothesis
    extra = hypothesis - reference
    fields = sorted({mention[0] for mention in reference | hypothesis})
    return {
        "all": (len(matches), len(missed), len(extra)),
        **{
            field: tuple(sum(mention[0] == field for mention in group) for group in (matches, missed, extra))
            for field in fields
        },
    }


def score_audit(clips: list[Clip], transcripts: dict[str, dict[str, str]], rows: list[dict]) -> dict:
    """Return matched, missed and extra counts on clips reviewed for every provider."""
    expected = {row["id"]: row for row in audit_sheet(clips, transcripts)}
    if not isinstance(rows, list) or not all(isinstance(row, dict) and isinstance(row.get("id"), str) for row in rows):
        raise ValueError("audit must be an array of rows with clip IDs")
    by_id = {row["id"]: row for row in rows}
    if by_id.keys() != expected.keys() or len(by_id) != len(rows):
        raise ValueError("audit must contain exactly one row for each manifest clip")

    report = {
        group: {"reviewed_clips": 0, "clips": 0, **{provider: defaultdict(lambda: (0, 0, 0)) for provider in transcripts}}
        for group in ("all", *sorted({clip.source for clip in clips}))
    }
    for clip in clips:
        row = by_id[clip.id]
        reviewed = {}
        for column in ("reference", *transcripts):
            cell = row.get(column)
            if not isinstance(cell, dict) or cell.get("text") != expected[clip.id][column]["text"]:
                raise ValueError(f"{clip.id}/{column}: transcript changed since the audit sheet was exported")
            labels = cell.get("mentions")
            if labels is not None:
                reviewed[column] = _mentions(labels, f"{clip.id}/{column}")

        complete = len(reviewed) == len(transcripts) + 1
        counts_by_provider = {
            provider: _matches(reviewed["reference"], reviewed[provider]) for provider in transcripts
        } if complete else {}
        for group in ("all", clip.source):
            result = report[group]
            result["clips"] += 1
            result["reviewed_clips"] += complete
            for provider, fields in counts_by_provider.items():
                for field, counts in fields.items():
                    previous = result[provider][field]
                    result[provider][field] = tuple(a + b for a, b in zip(previous, counts))
    return report


def format_audit(report: dict) -> str:
    lines = ["Exact speech values by field and offer"]
    for group, rows in report.items():
        lines.append(f"{group} ({rows['reviewed_clips']}/{rows['clips']} clips reviewed)")
        if not rows["reviewed_clips"]:
            continue
        providers = {name: fields for name, fields in rows.items() if name not in {"clips", "reviewed_clips"}}
        names = sorted({field for fields in providers.values() for field in fields})
        for provider, fields in providers.items():
            for field in names:
                matched, missed, extra = fields.get(field, (0, 0, 0))
                precision = f"{matched / (matched + extra):.1%}" if matched + extra else "N/A"
                recall = f"{matched / (matched + missed):.1%}" if matched + missed else "N/A"
                lines.append(
                    f"  {provider:<9} {field:<20} matched={matched} missed={missed} extra={extra}  "
                    f"precision={precision} recall={recall}"
                )
    return "\n".join(lines)
