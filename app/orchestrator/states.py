"""Task state machine (architecture §8 R1).

    created ──► discovering ──► calling ──► extracting ──► done
       │  ▲
       ▼  │ (all answers in)        any running state ──► failed
    needs_input

`created` means "the TaskSpec is complete and waiting for start". A task with missing
slots goes created -> needs_input, and back to created once the user has answered.
`done` and `failed` are final: a finished task is never run again.
"""

from __future__ import annotations

from enum import Enum


class TaskState(str, Enum):
    CREATED = "created"
    NEEDS_INPUT = "needs_input"
    DISCOVERING = "discovering"
    CALLING = "calling"
    EXTRACTING = "extracting"
    DONE = "done"
    FAILED = "failed"

    @property
    def is_final(self) -> bool:
        return self in (TaskState.DONE, TaskState.FAILED)


ALLOWED_TRANSITIONS: dict[TaskState, frozenset[TaskState]] = {
    TaskState.CREATED: frozenset({TaskState.NEEDS_INPUT, TaskState.DISCOVERING, TaskState.FAILED}),
    TaskState.NEEDS_INPUT: frozenset({TaskState.CREATED, TaskState.FAILED}),
    TaskState.DISCOVERING: frozenset({TaskState.CALLING, TaskState.FAILED}),
    TaskState.CALLING: frozenset({TaskState.EXTRACTING, TaskState.FAILED}),
    TaskState.EXTRACTING: frozenset({TaskState.DONE, TaskState.FAILED}),
    TaskState.DONE: frozenset(),
    TaskState.FAILED: frozenset(),
}


class InvalidTransition(RuntimeError):
    def __init__(self, old: TaskState, new: TaskState):
        super().__init__(f"task cannot go from {old.value} to {new.value}")
        self.old, self.new = old, new


def check_transition(old: TaskState, new: TaskState) -> TaskState:
    """Return `new` if old -> new is allowed, else raise InvalidTransition."""
    if new not in ALLOWED_TRANSITIONS[old]:
        raise InvalidTransition(old, new)
    return new
