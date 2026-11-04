"""The task state machine on its own."""

import pytest

from app.orchestrator import ALLOWED_TRANSITIONS, InvalidTransition, TaskState, check_transition

S = TaskState

VALID = [
    (S.CREATED, S.NEEDS_INPUT),
    (S.NEEDS_INPUT, S.CREATED),
    (S.CREATED, S.DISCOVERING),
    (S.DISCOVERING, S.CALLING),
    (S.CALLING, S.EXTRACTING),
    (S.EXTRACTING, S.DONE),
    (S.CREATED, S.FAILED),
    (S.NEEDS_INPUT, S.FAILED),
    (S.DISCOVERING, S.FAILED),
    (S.CALLING, S.FAILED),
    (S.EXTRACTING, S.FAILED),
]


@pytest.mark.parametrize("old, new", VALID)
def test_valid_transitions(old, new):
    assert check_transition(old, new) is new


@pytest.mark.parametrize(
    "old, new",
    [
        (S.NEEDS_INPUT, S.DISCOVERING),  # never call while info is missing
        (S.CREATED, S.CALLING),  # no skipping discovery
        (S.DISCOVERING, S.EXTRACTING),
        (S.CALLING, S.DONE),
        (S.EXTRACTING, S.CALLING),  # no going back
        (S.DONE, S.FAILED),
        (S.FAILED, S.CREATED),  # a finished task is never re-run
        (S.DONE, S.DISCOVERING),
        (S.CALLING, S.CALLING),
    ],
)
def test_invalid_transitions_raise(old, new):
    with pytest.raises(InvalidTransition):
        check_transition(old, new)


def test_exactly_the_listed_transitions_are_allowed():
    allowed = {(old, new) for old, targets in ALLOWED_TRANSITIONS.items() for new in targets}
    assert allowed == set(VALID)


def test_final_states():
    assert {s for s in S if s.is_final} == {S.DONE, S.FAILED}
    assert all(not ALLOWED_TRANSITIONS[s] for s in S if s.is_final)
