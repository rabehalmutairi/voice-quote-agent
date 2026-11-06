"""When we may phone a shop: normal shop hours in Riyadh, not at prayer time, not Friday morning.

Architecture §9: "Call only during normal hours". All times are Riyadh local time
(UTC+3 all year, Saudi Arabia has no daylight saving).

    if why_not := blocked(moment, duration_s=210):
        ...   # e.g. "during Maghrib prayer (17:00-17:45)"

Owner: R4. Agreed with the team on 5 Nov 2026; change the constants below, not the logic.
"""

from __future__ import annotations

from datetime import datetime, time, timedelta, timezone

RIYADH = timezone(timedelta(hours=3), "Riyadh")

# Most Riyadh repair and phone shops open late morning, close for the afternoon, and reopen
# in the evening. A call must fit entirely inside one of these.
SHOP_HOURS = ((time(10, 0), time(12, 0)), (time(16, 30), time(22, 30)))
FRIDAY = 4  # datetime.weekday()
FRIDAY_NOT_BEFORE = time(13, 0)  # Friday prayer and the morning off

PRAYERS = ("Fajr", "Dhuhr", "Asr", "Maghrib", "Isha")

# Shops close for each prayer. For every month: (start, end) of the closed window per prayer,
# from 10 min before the month's earliest adhan to 30 min after its latest, rounded out to 5 min.
# Generated with the Umm al-Qura method for Riyadh (24.71 N, 46.68 E; Fajr 18.5 deg, Asr shadow 1,
# Isha = Maghrib + 90 min); the formula was within 3 min of a published Umm al-Qura timetable for
# Riyadh on 1 and 30 Nov 2026. Prayer times repeat each year to within about a minute.
# Not covered: Ramadan, when shop hours change completely (outside this project's dates).
PRAYER_WINDOWS: dict[int, tuple[tuple[str, str], ...]] = {
    1: (("05:00", "05:50"), ("11:45", "12:40"), ("14:45", "15:50"), ("17:05", "18:10"), ("18:35", "19:40")),
    2: (("04:45", "05:50"), ("11:55", "12:40"), ("15:05", "16:00"), ("17:25", "18:25"), ("18:55", "19:55")),
    3: (("04:15", "05:30"), ("11:45", "12:40"), ("15:15", "16:00"), ("17:45", "18:40"), ("19:15", "20:10")),
    4: (("03:40", "05:00"), ("11:40", "12:30"), ("15:05", "16:00"), ("17:55", "18:55"), ("19:25", "20:25")),
    5: (("03:20", "04:25"), ("11:40", "12:25"), ("15:00", "15:50"), ("18:10", "19:10"), ("19:40", "20:40")),
    6: (("03:20", "04:10"), ("11:40", "12:30"), ("15:00", "15:50"), ("18:25", "19:20"), ("19:55", "20:50")),
    7: (("03:25", "04:25"), ("11:45", "12:35"), ("15:05", "16:00"), ("18:25", "19:20"), ("19:55", "20:50")),
    8: (("03:45", "04:45"), ("11:40", "12:35"), ("15:10", "16:00"), ("18:00", "19:10"), ("19:30", "20:40")),
    9: (("04:00", "05:00"), ("11:30", "12:25"), ("14:55", "15:55"), ("17:30", "18:45"), ("19:00", "20:15")),
    10: (("04:15", "05:15"), ("11:25", "12:15"), ("14:35", "15:40"), ("17:00", "18:15"), ("18:30", "19:45")),
    11: (("04:30", "05:30"), ("11:25", "12:15"), ("14:30", "15:20"), ("16:50", "17:45"), ("18:20", "19:15")),
    12: (("04:45", "05:45"), ("11:30", "12:30"), ("14:30", "15:30"), ("16:50", "17:50"), ("18:20", "19:20")),
}


def _t(text: str) -> time:
    hours, minutes = text.split(":")
    return time(int(hours), int(minutes))


def prayer_windows(month: int) -> list[tuple[str, time, time]]:
    """[(prayer, closed from, closed until)] for a month, Riyadh time."""
    return [(name, _t(start), _t(end)) for name, (start, end) in zip(PRAYERS, PRAYER_WINDOWS[month])]


def blocked(moment: datetime, duration_s: float = 0) -> str | None:
    """Why a call from `moment` lasting `duration_s` may not be placed, or None if it may.

    `moment` must be timezone-aware (any zone; it is converted to Riyadh time).
    """
    if moment.tzinfo is None or moment.utcoffset() is None:
        raise ValueError("moment must be timezone-aware, e.g. datetime.now(timezone.utc)")
    start = moment.astimezone(RIYADH)
    end = start + timedelta(seconds=max(0.0, duration_s))
    if end.date() != start.date():
        return "outside shop hours"
    begin_t, end_t = start.time(), end.time()

    if start.weekday() == FRIDAY and begin_t < FRIDAY_NOT_BEFORE:
        return f"Friday before {FRIDAY_NOT_BEFORE:%H:%M}"
    if not any(open_ <= begin_t and end_t <= close for open_, close in SHOP_HOURS):
        return "outside shop hours"
    for name, closed_from, closed_until in prayer_windows(start.month):
        if begin_t < closed_until and closed_from < end_t:  # the call overlaps the window
            return f"during {name} prayer ({closed_from:%H:%M}-{closed_until:%H:%M})"
    return None


def is_callable(moment: datetime, duration_s: float = 0) -> bool:
    return blocked(moment, duration_s) is None
