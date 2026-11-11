import os
import subprocess
import sys

import pytest

from app.contracts import ROOT


@pytest.mark.parametrize(
    "arguments",
    [
        ["eval.speech", "--help"],
        ["eval.scenarios", "disclosure", "greeting", "price"],
        ["eval.metrics", "--example"],
    ],
)
def test_cli_outputs_utf8_when_redirected_on_a_legacy_windows_locale(arguments):
    process = subprocess.run(
        [sys.executable, "-m", *arguments],
        cwd=ROOT,
        env={**os.environ, "PYTHONIOENCODING": "cp1252", "PYTHONUTF8": "0"},
        capture_output=True,
        timeout=30,
    )
    assert process.returncode == 0, process.stderr.decode("utf-8", errors="replace")
    output = process.stdout.decode("utf-8")
    if arguments[0] == "eval.scenarios":
        assert "ثلاثمية وخمسين" in output
