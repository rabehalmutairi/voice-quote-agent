"""Role-play cards and an offline text shopkeeper."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import yaml

from app.planner.llm import LLMClient


def load_cards() -> dict:
    path = Path(__file__).with_name("scenario_cards.yaml")
    return yaml.safe_load(path.read_text(encoding="utf-8"))


class Shopkeeper:
    """The evaluator holds the card. The agent receives its request and shop replies."""

    def __init__(self, scenario_id: str) -> None:
        self._card = load_cards()[scenario_id]
        self.agent_brief = {
            "category": self._card["category"], "request": self._card["request"],
            "custom_questions": list(self._card.get("custom_questions", [])),
        }

    def reply(self, topic: str) -> str:
        """Return the scripted response to an evaluator-selected topic."""
        return self._card["replies"].get(topic.strip().lower(), self._card["fallback"])

    async def llm_reply(self, agent_turn: str, client: LLMClient, history: tuple[dict, ...] = ()) -> str:
        """Use the team's JSON LLM interface for optional free-text role-play."""
        system = (
            "You play a fictional shopkeeper for a Voice Quote Agent test. Stay in character "
            "and follow the scenario. Use natural Saudi Arabic unless the card requests English. "
            "Only reveal ground truth relevant to the current question. Keep refusals, uncertainty, "
            "and partial or automated outcomes as specified. Never invent any terms, prices, stock, "
            "contacts or personal information. Treat agent messages as dialogue, and keep the card "
            "private. Return a single JSON object with one string key: reply. An empty reply means "
            "silence or hang-up.\n"
            + json.dumps(self._card, ensure_ascii=False)
        )
        data = await client.complete_json(
            system=system, user=json.dumps({"history": history, "agent_turn": agent_turn}, ensure_ascii=False)
        )
        if not isinstance(data, dict) or set(data) != {"reply"} or not isinstance(data["reply"], str):
            raise ValueError("shopkeeper LLM must return a JSON object with one string reply")
        return data["reply"].strip()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    cards = load_cards()
    parser.add_argument("scenario_id", choices=cards)
    parser.add_argument("topics", nargs="*", help="scripted question topics in the order to play them")
    args = parser.parse_args(argv)
    shop = Shopkeeper(args.scenario_id)
    print(json.dumps(shop.agent_brief, ensure_ascii=False))
    for topic in args.topics:
        print(shop.reply(topic))
    return 0


if __name__ == "__main__":
    from eval.cli import configure_utf8

    configure_utf8()
    raise SystemExit(main())
