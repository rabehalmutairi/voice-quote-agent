"""Load and validate contracts (/contracts/*.schema.json) and category templates (/templates/*.yaml).

Every component checks the objects it receives and sends with `validate()`, so a shape
mistake fails loudly where it happens instead of three components later.

    from app.contracts import validate, get_template
    validate("call_result", result)          # raises ContractError if the shape is wrong
    template = get_template("electronics_repair")

Owner: R1. Everyone may import it.
"""

from __future__ import annotations

import copy
import json
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path

import yaml
from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource

ROOT = Path(__file__).resolve().parents[1]
CONTRACTS_DIR = ROOT / "contracts"
TEMPLATES_DIR = ROOT / "templates"


def timestamp(moment: datetime | None = None) -> str:
    """A contract timestamp: RFC 3339, UTC, trailing Z, whole seconds. Now if no moment given."""
    moment = moment or datetime.now(timezone.utc)
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class ContractError(ValueError):
    """An object does not match its contract. `problems` lists every mismatch found."""

    def __init__(self, contract: str, problems: list[str]):
        self.contract = contract
        self.problems = problems
        shown = "; ".join(problems[:5]) + (" ..." if len(problems) > 5 else "")
        super().__init__(f"invalid {contract}: {shown}")


class UnknownTemplate(KeyError):
    """No /templates/<category>.yaml file with that name."""


@lru_cache(maxsize=None)
def _schemas() -> dict[str, dict]:
    return {
        path.name.removesuffix(".schema.json"): json.loads(path.read_text(encoding="utf-8"))
        for path in sorted(CONTRACTS_DIR.glob("*.schema.json"))
    }


@lru_cache(maxsize=None)
def _validator(contract: str) -> Draft202012Validator:
    schemas = _schemas()
    if contract not in schemas:
        raise KeyError(f"no contract named {contract!r}; known: {sorted(schemas)}")
    # The registry resolves "$ref": "common.schema.json#/..." locally, without network access.
    registry = Registry().with_resources(
        (schema["$id"], Resource.from_contents(schema)) for schema in schemas.values()
    )
    # Without a FormatChecker, jsonschema silently ignores "format": "date-time".
    return Draft202012Validator(schemas[contract], registry=registry, format_checker=FormatChecker())


def contract_errors(contract: str, instance: object) -> list[str]:
    """Every way `instance` breaks the contract, as readable strings. Empty means valid."""
    return [
        f"{'/'.join(str(p) for p in error.absolute_path) or '<root>'}: {error.message}"
        for error in _validator(contract).iter_errors(instance)
    ]


def validate(contract: str, instance: object) -> object:
    """Return `instance` unchanged if it matches the contract, else raise ContractError.

    `contract` is the schema file name without `.schema.json`, e.g. "task_spec", "event".
    """
    problems = contract_errors(contract, instance)
    if problems:
        raise ContractError(contract, problems)
    return instance


@lru_cache(maxsize=None)
def _templates() -> dict[str, dict]:
    templates = {}
    for path in sorted(TEMPLATES_DIR.glob("*.yaml")):
        template = yaml.safe_load(path.read_text(encoding="utf-8"))
        validate("template", template)
        if template["category"] != path.stem:
            raise ContractError("template", [f"{path.name}: category must be {path.stem!r}"])
        templates[path.stem] = template
    return templates


def load_templates() -> dict[str, dict]:
    """All category templates, by category name. Returns copies, so callers can't corrupt the cache."""
    return copy.deepcopy(_templates())


def get_template(category: str) -> dict:
    """One category template. Raises UnknownTemplate if /templates has no such file."""
    templates = _templates()
    if category not in templates:
        raise UnknownTemplate(category)
    return copy.deepcopy(templates[category])
