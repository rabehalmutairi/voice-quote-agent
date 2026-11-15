import asyncio

from eval.scenarios import Shopkeeper, load_cards


def test_cards_cover_current_scope_and_only_shopkeeper_sees_truth():
    cards = load_cards()
    categories = {card["category"] for card in cards.values()}
    assert {"electronics_repair", "stock_check"} <= categories
    assert {"repair_options", "stock_english", "voicemail", "disclosure", "partial"} <= set(cards)
    for card in cards.values():
        assert {"ground_truth", "checks", "replies", "request"} <= set(card)
    shop = Shopkeeper("repair_options")
    assert "ground_truth" not in shop.agent_brief
    assert shop.reply("price") == cards["repair_options"]["replies"]["price"]
    assert shop.reply("warranty") == cards["repair_options"]["replies"]["warranty"]
    assert shop.reply("unknown_topic") == cards["repair_options"]["fallback"]


def test_llm_adapter_uses_injected_client_and_checks_reply():
    class FakeClient:
        async def complete_json(self, *, system, user):
            assert "ground truth" in system.lower()
            assert "repair_options" not in user
            return {"reply": "السعر أربعمية وخمسين ريال."}

    reply = asyncio.run(Shopkeeper("repair_options").llm_reply("كم السعر؟", FakeClient()))
    assert reply == "السعر أربعمية وخمسين ريال."
