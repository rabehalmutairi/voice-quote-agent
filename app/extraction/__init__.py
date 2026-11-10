"""R6: extraction. CallResult -> Quote, every value backed by the shop's own words.

    from app.extraction import R6Extractor, verify_quote
    quote = verify_quote(quote, call_result, template)   # template + evidence checks + contract

See evidence.py for the rules and extractor.py for the LLM side.
"""

from app.extraction.evidence import (
    NUMBER_NOT_IN_QUOTE,
    QUOTE_IN_AGENT_TURN,
    QUOTE_NOT_FOUND,
    check_evidence,
    enforce_template,
    template_problems,
    verify_quote,
)
from app.extraction.extractor import ExtractionError, LLMClient, R6Extractor
from app.extraction.numbers import parse_numbers

__all__ = [
    "ExtractionError",
    "LLMClient",
    "NUMBER_NOT_IN_QUOTE",
    "QUOTE_IN_AGENT_TURN",
    "QUOTE_NOT_FOUND",
    "R6Extractor",
    "check_evidence",
    "enforce_template",
    "parse_numbers",
    "template_problems",
    "verify_quote",
]
