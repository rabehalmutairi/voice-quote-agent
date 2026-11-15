import asyncio
import json
from copy import deepcopy

import pytest

from app.contracts import CONTRACTS_DIR
from app.mocks import MockCallProvider, mock_businesses
from eval.metrics import format_report, main, measure


def example(name):
    return json.loads((CONTRACTS_DIR / "examples" / f"{name}.json").read_text(encoding="utf-8"))


def attempt():
    return {
        "category": "electronics_repair",
        "attempt": 1,
        "call_result": example("call_result"),
        "quote": example("quote"),
        "labels": {
            "expected_fields": {
                "offers.0.price_sar": 1200,
                "offers.1.price_sar": 500,
                "fields.turnaround_minutes": [60, 120],
                "offers.2.price_sar": 100,
            },
            "unsupported_fields": ["offers.1.price_sar"],
            "baseline": {"unsupported": 2, "returned": 4},
            "answer_faithful": {"0": True},
            "usable": True,
        },
        "observations": {"task_elapsed_s": 80, "turn_latency_s": [0.5, 1.5]},
    }


def test_metrics_cover_architecture_table_and_count_retries_by_attempt():
    first = attempt()
    second = deepcopy(first)
    for contract in ("call_result", "quote"):
        second[contract].update(call_id="call_02", place_id="shop2")
    second["attempt"] = 2
    second["call_result"].update(pre_arranged=False, outcome="human_partial", cost_usd=0.25)
    second["observations"].update(language_switch_ok=True)

    failed = {
        "category": "electronics_repair",
        "attempt": 1,
        "call_result": {
            **second["call_result"], "outcome": "no_answer", "cost_usd": 0.10,
            "started_at": None, "conversation_id": None, "duration_s": 0,
            "transcript": [], "language_final": None,
        },
    }
    report = measure([first, failed, second])
    assert report["reach"]["pre_arranged"] == (1, 1)
    assert report["reach"]["cold"] == (1, 2)
    assert report["completion"] == (1, 2)
    assert report["accuracy"]["price_sar"] == (2, 6)
    assert report["accuracy"]["turnaround_minutes"] == (2, 2)
    assert report["critical_accuracy"] == (4, 8)
    assert report["hallucination"] == (2, 14)
    assert report["baseline_hallucination"] == (4, 8)
    assert report["faithfulness"] == (2, 2)
    assert report["language_switch"] == (1, 1)
    assert report["turn_latency_s"] == (4.0, 4)
    assert report["task_elapsed_s"] == (80, 1)
    assert report["failures"] == {"no_answer": 1}
    assert report["successful_tasks"] == 1
    assert report["cost_per_success"] == pytest.approx(0.8)


def test_actual_app_mock_is_excluded_from_every_metric():
    job = example("call_job")
    shop = mock_businesses()[0]
    job.update(place_id=shop["place_id"], to_number=shop["phone_e164"])
    mocked = asyncio.run(MockCallProvider().place_call(job))
    report = measure([{**attempt(), "call_result": mocked}])
    assert report == {**measure([]), "mock_excluded": 1}


def test_missing_labels_and_cost_are_unknown():
    row = attempt()
    row["call_result"]["cost_usd"] = None
    del row["labels"]
    report = measure([row])
    assert report["completion"] == (1, 1)
    assert report["critical_accuracy"] == (0, 0)
    assert report["hallucination"] == (0, 0)
    assert report["faithfulness"] == (0, 0)
    assert report["cost_per_success"] is None
    assert report["unknown_costs"] == 1
    assert report["unreviewed_usability"] == 1


def test_failed_event_can_fill_in_when_the_provider_returned_no_result():
    row = {
        "category": "electronics_repair", "attempt": 1,
        "call_failed": example("events/call.failed"),
        "pre_arranged": False, "scenario_id": None,
    }
    report = measure([row])
    assert report["reach"]["cold"] == (0, 1)
    assert report["unknown_costs"] == 1
    assert measure([{**row, "scenario_id": "mock_timeout"}])["reach"]["cold"] == (0, 0)


def test_duplicate_attempt_and_mismatched_quote_fail_loudly():
    row = attempt()
    with pytest.raises(ValueError, match="duplicate attempt"):
        measure([row, row])
    row["quote"]["place_id"] = "anotherShop"
    with pytest.raises(ValueError, match="quote IDs"):
        measure([row])


def test_retry_requires_a_failed_first_attempt():
    row = attempt()
    with pytest.raises(ValueError, match="first attempt"):
        measure([{**row, "attempt": 2}])
    with pytest.raises(ValueError, match="first attempt"):
        measure([row, {**row, "attempt": 2}])


def test_baseline_comparison_uses_the_same_attempts():
    paired = attempt()
    ours_only = deepcopy(paired)
    del ours_only["labels"]["baseline"]
    for contract in ("call_result", "quote"):
        ours_only[contract].update(call_id="call_other", task_id="tsk_other")
    report = measure([paired, ours_only])
    assert report["hallucination"] == (2, 14)
    assert report["paired_hallucination"] == (1, 7)
    assert report["baseline_hallucination"] == (2, 4)
    assert report["paired_calls"] == 1


def test_cli_labels_contract_example_as_synthetic(capsys):
    assert main(["--example"]) == 0
    output = capsys.readouterr().out
    assert "SYNTHETIC" in output
    assert "Critical-field accuracy" in output
    assert "Answer faithfulness" in output
    assert "Cost per successful task" in output


@pytest.mark.parametrize("key", ["labels", "observations"])
@pytest.mark.parametrize("invalid", [False, 0, [], ""])
def test_optional_objects_do_not_silently_discard_falsey_invalid_exports(key, invalid):
    row = attempt()
    row[key] = invalid
    with pytest.raises(ValueError, match=key):
        measure([row])


@pytest.mark.parametrize("key", ["labels", "observations"])
def test_optional_objects_allow_null_before_review(key):
    row = attempt()
    row[key] = None
    report = measure([row])
    assert report["attempts"] == 1


@pytest.mark.parametrize("key, misspelled", [
    ("labels", "expected_feilds"),
    ("observations", "turn_latancy_s"),
])
def test_unknown_export_keys_fail_instead_of_losing_measurements(key, misspelled):
    row = attempt()
    row[key] = {misspelled: {}}
    with pytest.raises(ValueError, match=misspelled):
        measure([row])


@pytest.mark.parametrize("key, value", [
    ("expected_fields", []),
    ("baseline", []),
    ("answer_faithful", []),
    ("baseline", {"unsupported": 0, "returned": 7, "unsuported": 1}),
])
def test_nested_label_objects_fail_with_actionable_errors(key, value):
    row = attempt()
    row["labels"][key] = value
    with pytest.raises(ValueError, match=key):
        measure([row])


def test_missing_human_quote_keeps_cost_unknown_until_absence_is_confirmed():
    rows = [attempt(), attempt(), attempt()]
    for index, row in enumerate(rows):
        for contract in ("call_result", "quote"):
            row[contract].update(call_id=f"call_{index}", place_id=f"shop{index}")
        row["call_result"]["cost_usd"] = 1
    unknown = rows[-1]
    unknown["call_result"]["task_id"] = "tsk_other"
    del unknown["quote"]
    del unknown["labels"]

    report = measure(rows)
    assert report["successful_tasks"] == 1
    assert report["unknown_quotes"] == 1
    assert report["cost_per_success"] is None
    assert "1 human calls with missing quote records" in format_report(report)

    unknown["quote"] = None
    report = measure(rows)
    assert report["unknown_quotes"] == 0
    assert report["cost_per_success"] == 3


def test_missing_quote_cannot_be_scored_as_an_extraction_miss():
    row = attempt()
    del row["quote"]
    row["labels"] = {"expected_fields": {"offers.0.price_sar": 1200}}
    with pytest.raises(ValueError, match="quote"):
        measure([row])

    row["quote"] = None
    assert measure([row])["critical_accuracy"] == (0, 1)


@pytest.mark.parametrize("reviewed", [True, False])
def test_duplicate_question_indices_do_not_shrink_summary_denominator(reviewed):
    row = attempt()
    row["quote"]["answers"].append(deepcopy(row["quote"]["answers"][0]))
    if not reviewed:
        row["labels"]["answer_faithful"] = None
    with pytest.raises(ValueError, match="question_index"):
        measure([row])


def test_report_exposes_unresolved_audits_without_counting_them_as_clean():
    reviewed, unresolved = attempt(), attempt()
    for contract in ("call_result", "quote"):
        unresolved[contract].update(call_id="call_unresolved", place_id="unreviewed_shop")
    unresolved["labels"] = {name: None for name in unresolved["labels"]}
    report = measure([reviewed, unresolved])
    assert report["hallucination"] == (1, 7)
    assert report["audit_coverage"] == {
        "expected_fields": (1, 2), "unsupported_fields": (1, 2), "answer_faithful": (1, 2),
    }
    assert report["returned_value_coverage"] == (7, 14)
    assert report["summary_coverage"] == (1, 2)
    assert "50.0% (7/14)" in format_report(report)
    assert report["cost_per_success"] is None
