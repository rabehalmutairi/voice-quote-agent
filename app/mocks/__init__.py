"""Mock providers (R1): run the planner and orchestrator with no API keys, no network,
no real phone numbers and no cost. For development, tests and demos only.

    from app.mocks import build_mock_stack
    stack = build_mock_stack("one_failed")
    # stack.planner, stack.orchestrator, stack.events.events ...

Run the demo: python -m app.mocks.demo --help
"""

from app.mocks.planner import MockAreaResolver, MockRequestParser
from app.mocks.providers import (
    InMemoryEventSink,
    MockCallProvider,
    MockComparator,
    MockDiscovery,
    MockExtractor,
    MockRetryPolicy,
    MockSafetyError,
    mock_businesses,
    mock_script,
)
from app.mocks.scenarios import SCENARIOS, MockStack, build_mock_stack

__all__ = [
    "InMemoryEventSink",
    "MockAreaResolver",
    "MockCallProvider",
    "MockComparator",
    "MockDiscovery",
    "MockExtractor",
    "MockRequestParser",
    "MockRetryPolicy",
    "MockSafetyError",
    "MockStack",
    "SCENARIOS",
    "build_mock_stack",
    "mock_businesses",
    "mock_script",
]
