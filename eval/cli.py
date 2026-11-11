"""Keep Arabic CLI reports readable when Windows redirects standard streams."""

import sys


def configure_utf8() -> None:
    """Use UTF-8 for command-line output, including redirected reports."""
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
