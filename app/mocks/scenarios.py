"""Ready-made mock setups: one call builds a planner + orchestrator wired to mocks.

Scenarios (what each of the 3 fictional shops does when called):

    default         all 3 answer (the third ends early: human_partial)
    one_failed      shop 2 doesn't answer; the other two still give quotes
    all_failed      no answer, busy, voicemail -> task.failed
    timeout         shop 3 never answers; the orchestrator's call timeout stops it
    provider_error  the call provider crashes on shop 2; the others are unaffected
    retry           shop 2 doesn't answer, is retried once, then answers
    no_shops        discovery finds nothing -> task.failed
"""

from __future__ import annotations

from dataclasses import dataclass, replace

from app.mocks.planner import MockAreaResolver, MockRequestParser
from app.mocks.providers import (
    ERROR,
    HANG,
    NO_ANSWER_THEN_SCRIPT,
    InMemoryEventSink,
    MockCallProvider,
    MockComparator,
    MockDiscovery,
    MockExtractor,
    MockRetryPolicy,
    mock_businesses,
)
from app.orchestrator import Orchestrator, OrchestratorConfig
from app.planner import Planner

SHOP_1, SHOP_2, SHOP_3 = (b["place_id"] for b in mock_businesses())

SCENARIOS: dict[str, dict] = {
    "default": {"behaviours": {}},
    "one_failed": {"behaviours": {SHOP_2: "no_answer"}},
    "all_failed": {"behaviours": {SHOP_1: "no_answer", SHOP_2: "busy", SHOP_3: "voicemail"}},
    "timeout": {"behaviours": {SHOP_3: HANG}},
    "provider_error": {"behaviours": {SHOP_2: ERROR}},
    "retry": {"behaviours": {SHOP_2: NO_ANSWER_THEN_SCRIPT}, "retry": True},
    "no_shops": {"behaviours": {}, "no_shops": True},
}

# How long each mock call "lasts" at speed 1.0, so the 3 calls visibly overlap.
CALL_SECONDS = {SHOP_1: 0.6, SHOP_2: 0.9, SHOP_3: 0.4}


@dataclass
class MockStack:
    planner: Planner
    orchestrator: Orchestrator
    discovery: MockDiscovery
    calls: MockCallProvider
    extractor: MockExtractor
    comparator: MockComparator
    events: InMemoryEventSink


def build_mock_stack(
    scenario: str = "default",
    *,
    speed: float = 1.0,
    config: OrchestratorConfig | None = None,
    events: InMemoryEventSink | None = None,
    enabled_categories: tuple[str, ...] | None = None,
) -> MockStack:
    """Planner + orchestrator wired to mocks. `speed` scales the fake call durations
    (0 = instant, for tests). The call timeout is shortened so `timeout` finishes quickly."""
    if scenario not in SCENARIOS:
        raise ValueError(f"unknown scenario {scenario!r}; choose from {sorted(SCENARIOS)}")
    setup = SCENARIOS[scenario]

    planner_kwargs = {} if enabled_categories is None else {"enabled_categories": enabled_categories}
    planner = Planner(MockRequestParser(), MockAreaResolver(), **planner_kwargs)
    discovery = MockDiscovery([] if setup.get("no_shops") else None)
    calls = MockCallProvider(setup["behaviours"], delays={k: v * speed for k, v in CALL_SECONDS.items()})
    extractor = MockExtractor()
    comparator = MockComparator()
    sink = events or InMemoryEventSink()
    base_config = config or OrchestratorConfig()
    if config is None:
        # Real calls get 210 s; mock calls last under a second, so 1.5 s (scaled) is plenty.
        base_config = replace(base_config, call_timeout_s=max(0.2, 1.5 * speed))
    orchestrator = Orchestrator(
        planner=planner,
        discovery=discovery,
        calls=calls,
        extractor=extractor,
        comparator=comparator,
        events=sink,
        retry_policy=MockRetryPolicy(0.1 * speed) if setup.get("retry") else None,
        config=base_config,
    )
    return MockStack(planner, orchestrator, discovery, calls, extractor, comparator, sink)
