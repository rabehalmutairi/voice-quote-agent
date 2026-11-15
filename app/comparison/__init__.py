"""R6: comparison. Quotes -> Comparison, like for like, or the reasons it can't be.

    from app.comparison import R6Comparator, is_usable

Rules for a usable quote per category: usable.py. Ranking rules: comparator.py.
"""

from app.comparison.comparator import R6Comparator, compare_quotes
from app.comparison.usable import is_usable, rankable_offers

__all__ = ["R6Comparator", "compare_quotes", "is_usable", "rankable_offers"]
