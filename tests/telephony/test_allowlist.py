"""The allowlist refuses every number it wasn't explicitly given (architecture §9)."""

import json

import pytest

from app.contracts import CONTRACTS_DIR
from app.telephony import Allowlist, NumberNotAllowed, mask

FRIEND = "+966500000001"  # fixture numbers only: never a real person's number in git
SHOP = "+966500000002"


def test_empty_allowlist_refuses_everything():
    allowlist = Allowlist()
    assert len(allowlist) == 0
    with pytest.raises(NumberNotAllowed) as error:
        allowlist.check(FRIEND)
    assert error.value.code == "number_not_allowed"


def test_listed_number_is_allowed():
    allowlist = Allowlist([FRIEND])
    assert allowlist.check(FRIEND) == FRIEND
    assert FRIEND in allowlist
    assert SHOP not in allowlist


@pytest.mark.parametrize("number", ["0500000001", "966500000001", "+966 50 000 0001", "", None, 966500000001])
def test_only_exact_e164_matches(number):
    allowlist = Allowlist([FRIEND])
    assert not allowlist.allows(number)
    with pytest.raises(NumberNotAllowed):
        allowlist.check(number)


@pytest.mark.parametrize("entry", ["0500000001", "+966 50 000 0001", "+0123456789", "abc", None])
def test_bad_entry_fails_at_startup(entry):
    with pytest.raises(ValueError, match="not an E.164 number"):
        Allowlist([entry])


def test_entries_are_trimmed():
    assert FRIEND in Allowlist([f"  {FRIEND}\n"])


def test_from_env_with_nothing_set_is_empty():
    assert len(Allowlist.from_env({})) == 0


def test_from_env_reads_the_variable():
    allowlist = Allowlist.from_env({"TELEPHONY_ALLOWLIST": f"{FRIEND}, {SHOP},"})
    assert FRIEND in allowlist and SHOP in allowlist and len(allowlist) == 2


def test_from_env_reads_the_file_and_combines(tmp_path):
    path = tmp_path / "allowlist.txt"
    path.write_text(f"# teammates\n{FRIEND}   # Saleh\n\n", encoding="utf-8")
    allowlist = Allowlist.from_env({"TELEPHONY_ALLOWLIST": SHOP, "TELEPHONY_ALLOWLIST_FILE": str(path)})
    assert FRIEND in allowlist and SHOP in allowlist and len(allowlist) == 2


def test_missing_file_is_loud(tmp_path):
    with pytest.raises(FileNotFoundError):
        Allowlist.from_env({"TELEPHONY_ALLOWLIST_FILE": str(tmp_path / "nope.txt")})


def test_numbers_never_appear_in_messages():
    allowlist = Allowlist([FRIEND])
    assert FRIEND not in repr(allowlist)
    with pytest.raises(NumberNotAllowed) as error:
        allowlist.check(SHOP)
    assert SHOP not in str(error.value)
    assert mask(SHOP) in str(error.value)


def test_mask():
    assert mask("+966500000001") == "+966*******01"
    assert mask("not a number") == "<not an E.164 number>"
    assert mask(None) == "<not an E.164 number>"


def test_contract_example_call_job():
    """The CallJob example is refused by default and allowed once its number is listed."""
    job = json.loads((CONTRACTS_DIR / "examples" / "call_job.json").read_text(encoding="utf-8"))
    with pytest.raises(NumberNotAllowed):
        Allowlist.from_env({}).check(job["to_number"])
    assert Allowlist([job["to_number"]]).check(job["to_number"]) == job["to_number"]
