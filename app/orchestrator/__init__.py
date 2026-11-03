"""Orchestrator (R1): task state machine and 3-call fan-out. See docs/integration.md."""

from app.orchestrator.interfaces import (
    CallProvider,
    Comparator,
    DiscoveryProvider,
    EventSink,
    Extractor,
    NoRetry,
    RetryPolicy,
)
from app.orchestrator.orchestrator import (
    DuplicateTask,
    InvalidTaskState,
    MissingInput,
    Orchestrator,
    OrchestratorConfig,
    OrchestratorError,
    TaskAlreadyStarted,
    UnknownTask,
)
from app.orchestrator.states import ALLOWED_TRANSITIONS, InvalidTransition, TaskState, check_transition

__all__ = [
    "ALLOWED_TRANSITIONS",
    "CallProvider",
    "Comparator",
    "DiscoveryProvider",
    "DuplicateTask",
    "EventSink",
    "Extractor",
    "InvalidTaskState",
    "InvalidTransition",
    "MissingInput",
    "NoRetry",
    "Orchestrator",
    "OrchestratorConfig",
    "OrchestratorError",
    "RetryPolicy",
    "TaskAlreadyStarted",
    "TaskState",
    "UnknownTask",
    "check_transition",
]
