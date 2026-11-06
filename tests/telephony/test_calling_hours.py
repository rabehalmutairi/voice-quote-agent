"""Calling hours: shop hours in Riyadh, no prayer times, no Friday morning."""

from datetime import datetime, timedelta, timezone

import pytest

from app.telephony.calling_hours import PRAYER_WINDOWS, RIYADH, SHOP_HOURS, blocked, is_callable, prayer_windows


def riyadh(day, hh, mm):
    """A moment in Riyadh. 5 Nov 2026 is a Thursday, 6 Nov a Friday."""
    return datetime(2026, 11, day, hh, mm, tzinfo=RIYADH)


@pytest.mark.parametrize("hh, mm", [(10, 0), (11, 0), (16, 30), (17, 50), (19, 30), (22, 25)])
def test_open_times_on_a_weekday(hh, mm):
    assert blocked(riyadh(5, hh, mm)) is None


@pytest.mark.parametrize(
    "hh, mm, reason",
    [
        (9, 59, "outside shop hours"),
        (13, 0, "outside shop hours"),
        (15, 0, "outside shop hours"),
        (22, 31, "outside shop hours"),
        (2, 0, "outside shop hours"),
        (11, 40, "during Dhuhr prayer"),
        (17, 0, "during Maghrib prayer"),
        (18, 30, "during Isha prayer"),
    ],
)
def test_closed_times_on_a_weekday(hh, mm, reason):
    assert blocked(riyadh(5, hh, mm)).startswith(reason)


def test_friday_morning_is_closed_and_evening_open():
    assert blocked(riyadh(6, 10, 30)) == "Friday before 13:00"
    assert blocked(riyadh(6, 20, 0)) is None
    assert blocked(riyadh(7, 10, 30)) is None  # Saturday morning is a normal day


def test_the_whole_call_must_fit():
    assert is_callable(riyadh(5, 11, 20), duration_s=210)  # ends 11:23:30, before Dhuhr's 11:25
    assert blocked(riyadh(5, 11, 23), duration_s=210).startswith("during Dhuhr")  # runs into Dhuhr
    assert blocked(riyadh(5, 22, 28), duration_s=210) == "outside shop hours"  # runs past closing
    assert blocked(riyadh(5, 16, 45), duration_s=600).startswith("during Maghrib")


def test_any_timezone_is_converted_to_riyadh():
    utc = datetime(2026, 11, 5, 17, 0, tzinfo=timezone.utc)  # 20:00 in Riyadh
    assert is_callable(utc)
    assert not is_callable(datetime(2026, 11, 5, 17, 0, tzinfo=RIYADH))  # 17:00 Riyadh: Maghrib


def test_naive_datetime_is_refused():
    with pytest.raises(ValueError, match="timezone-aware"):
        blocked(datetime(2026, 11, 5, 11, 0))


def test_crossing_midnight_is_blocked():
    assert blocked(riyadh(5, 23, 59), duration_s=120) == "outside shop hours"


def test_table_is_well_formed():
    assert sorted(PRAYER_WINDOWS) == list(range(1, 13))
    for month in PRAYER_WINDOWS:
        windows = prayer_windows(month)
        assert [name for name, _, _ in windows] == ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"]
        for _, start, end in windows:
            assert start < end
            assert timedelta(minutes=30) <= datetime.combine(datetime.min, end) - datetime.combine(datetime.min, start)
        starts = [start for _, start, _ in windows]
        assert starts == sorted(starts)


@pytest.mark.parametrize(
    "day, published",
    # Umm al-Qura times for Riyadh (al-habib.info, Al Sahafa, Nov 2026): Dhuhr, Maghrib, Isha.
    [(1, ((11, 41), (17, 15), (18, 45))), (30, ((11, 45), (17, 5), (18, 35)))],
)
def test_published_adhan_times_fall_inside_the_windows(day, published):
    for hh, mm in published:
        assert not is_callable(riyadh(day, hh, mm))
        assert not is_callable(riyadh(day, hh, mm) + timedelta(minutes=20))  # still praying


def test_shop_hours_are_ordered():
    assert all(open_ < close for open_, close in SHOP_HOURS)
