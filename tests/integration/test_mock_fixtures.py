"""The mock data must be as honest as real data, and mock mode must be unable to call anyone.

If a teammate copies these fixtures to test their component, they get contract-valid
CallResults and Quotes whose evidence really is in a shop turn.
"""

import pytest
from conftest import run

from app.contracts import contract_errors, load_templates
from app.mocks import MockCallProvider, MockSafetyError, mock_businesses, mock_script
from app.mocks.providers import FAKE_NUMBER, _fixtures

TEMPLATES = load_templates()
SCRIPTED = [(category, place_id) for category, shops in _fixtures()["scripts"].items() for place_id in shops]


def job_for(category, business, attempt=1):
    return {
        "call_id": "call_test01",
        "task_id": "tsk_test01",
        "place_id": business["place_id"],
        "to_number": business["phone_e164"],
        "template": category,
        "dynamic_variables": {},
        "custom_questions": [],
        "max_duration_s": 150,
        "attempt": attempt,
    }


def test_mock_shops_are_valid_and_use_fake_numbers():
    shops = mock_businesses()
    assert len(shops) == 3
    for shop in shops:
        assert contract_errors("business", shop) == []
        assert FAKE_NUMBER.match(shop["phone_e164"])


def test_the_first_shop_is_the_contract_example():
    import json

    from app.contracts import CONTRACTS_DIR

    example = json.loads((CONTRACTS_DIR / "examples" / "business.json").read_text(encoding="utf-8"))
    assert mock_businesses()[0] == example


@pytest.mark.parametrize("category, place_id", SCRIPTED)
def test_scripted_calls_are_valid_call_results(category, place_id):
    business = next(b for b in mock_businesses() if b["place_id"] == place_id)
    result = run(MockCallProvider().place_call(job_for(category, business)))
    assert contract_errors("call_result", result) == []
    assert result["outcome"] in {"human_completed", "human_partial"}
    assert result["scenario_id"].startswith("mock_")  # mock data is labelled as mock


@pytest.mark.parametrize("category, place_id", SCRIPTED)
def test_scripted_quotes_are_valid_and_their_evidence_is_in_a_shop_turn(category, place_id):
    script = mock_script(category, place_id)
    quote = {"call_id": "call_test01", "task_id": "tsk_test01", "place_id": place_id,
             "offers": script["offers"], "fields": script["fields"], "answers": [], "evidence_issues": []}
    assert contract_errors("quote", quote) == []

    turns = {t["i"]: t for t in script["transcript"]}
    claims = [(f, offer[f]) for offer in script["offers"] for f in offer] + list(script["fields"].items())
    for name, field in claims:
        if field["status"] == "not_mentioned":
            continue
        turn = turns[field["evidence_turn"]]
        assert turn["speaker"] == "shop", name
        assert field["evidence_quote"] in turn["text"], name
    for answer in script["answers"]:
        for item in answer["evidence"]:
            assert turns[item["turn"]]["speaker"] == "shop"
            assert item["quote"] in turns[item["turn"]]["text"]


@pytest.mark.parametrize("category, place_id", SCRIPTED)
def test_scripted_quotes_fit_their_template(category, place_id):
    template, script = TEMPLATES[category], mock_script(category, place_id)
    seen = set()
    for offer in script["offers"]:
        assert set(offer) <= set(template["offer_fields"])
        seen |= set(offer)
    assert set(script["fields"]) <= set(template["quote_fields"])
    seen |= set(script["fields"])
    assert set(template["required_fields"]) <= seen
    for offer in script["offers"]:
        for name, field in [*offer.items(), *script["fields"].items()]:
            definition = template["fields"][name]
            if field["status"] == "found" and definition["type"] == "choice":
                assert field["value"] in definition["choices"], name
            if field["status"] == "found" and definition["type"] == "number":
                assert isinstance(field["value"], (int, float)) or field["value_min"] is not None, name


def test_mock_mode_refuses_a_real_number():
    business = {**mock_businesses()[0], "phone_e164": "+966501234567"}
    with pytest.raises(MockSafetyError):
        run(MockCallProvider().place_call(job_for("electronics_repair", business)))


def test_mock_mode_refuses_a_fixture_number_for_the_wrong_shop():
    shops = mock_businesses()
    job = job_for("electronics_repair", shops[0])
    job["to_number"] = shops[1]["phone_e164"]
    with pytest.raises(MockSafetyError):
        run(MockCallProvider().place_call(job))


def test_mock_modules_never_import_a_network_library():
    from pathlib import Path

    import app.mocks

    source = "\n".join(p.read_text(encoding="utf-8") for p in Path(app.mocks.__file__).parent.glob("*.py"))
    for library in ("requests", "httpx", "aiohttp", "urllib", "socket", "twilio", "elevenlabs"):
        assert f"import {library}" not in source and f"from {library}" not in source
