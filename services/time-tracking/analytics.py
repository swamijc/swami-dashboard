"""
analytics.py — Process raw photontrack API data into weekly/daily reports.

Expected working hours:
  • Weekly target: 40 hours
  • Daily target:  8 hours
  • Daily alert threshold: < 6 hours (highlighted)

Hour buckets (weekly total):
  <40 | 40-41 | 41-42 | 42-43 | 43-45 | 45-50 | 50+
"""

from datetime import date, timedelta
from typing import Any

DAILY_TARGET = 8.0
WEEKLY_TARGET = 40.0
DAILY_ALERT = 6.0   # hours — highlight if below this

BUCKETS = [
    ("<40",   0,    40),
    ("40–41", 40,   41),
    ("41–42", 41,   42),
    ("42–43", 42,   43),
    ("43–45", 43,   45),
    ("45–50", 45,   50),
    ("50+",   50,  999),
]


def parse_iso_date(value: str) -> date:
    """Parse YYYY-MM-DD or browser/API-style YYYY-M-D into a date."""
    parts = value.split("-")
    if len(parts) != 3:
        raise ValueError(f"Invalid date string: {value}")
    year, month, day = map(int, parts)
    return date(year, month, day)


def parse_minutes(raw: Any) -> float:
    """Convert various formats to total hours (float)."""
    if raw is None:
        return 0.0
    if isinstance(raw, (int, float)):
        # Could be minutes (>24) or hours (≤24)
        return float(raw) / 60 if float(raw) > 24 else float(raw)
    if isinstance(raw, str):
        raw = raw.strip()
        if ":" in raw:
            parts = raw.split(":")
            return int(parts[0]) + int(parts[1]) / 60
        try:
            val = float(raw)
            return val / 60 if val > 24 else val
        except ValueError:
            return 0.0
    return 0.0


def parse_time_to_hours(from_time: str, to_time: str) -> float:
    """Calculate hours worked from HH:MM in/out strings."""
    try:
        fh, fm = map(int, from_time.split(":"))
        th, tm = map(int, to_time.split(":"))
        return max(0.0, (th * 60 + tm - fh * 60 - fm) / 60)
    except Exception:
        return 0.0


def get_week_dates(from_date: str, to_date: str) -> list[date]:
    """Return list of calendar days in the selected range."""
    start = parse_iso_date(from_date)
    end   = parse_iso_date(to_date)
    days = []
    current = start
    while current <= end:
        days.append(current)
        current += timedelta(days=1)
    return days


def get_current_week_range() -> tuple[str, str]:
    today = date.today()
    monday = today - timedelta(days=today.weekday())
    sunday = monday + timedelta(days=6)
    return str(monday), str(sunday)


# ─── Normalise raw API response into list of daily records ───────────────────

def normalise_records(raw_response: Any, employee_numbers: list[str]) -> list[dict]:
    """
    Normalise the photontrack getReporteesAccess response into a list of:
    { employee_number, employee_name, date, hours }
    Handles multiple possible API response shapes.
    """
    records: list[dict] = []

    def extract_list(data: Any) -> list:
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            for key in ("data", "records", "timesheets", "reporteeData", "accessData", "entries"):
                if key in data and isinstance(data[key], list):
                    return data[key]
            # Try any list value
            for v in data.values():
                if isinstance(v, list):
                    return v
        return []

    items = extract_list(raw_response)

    for item in items:
        if not isinstance(item, dict):
            continue

        emp_no = str(
            item.get("employeeNumber") or
            item.get("employeeCode") or
            item.get("empCode") or
            item.get("empNo") or ""
        ).strip()

        name = str(
            item.get("employeeName") or
            item.get("name") or
            item.get("empName") or
            item.get("resourceName") or emp_no
        ).strip()

        # Date
        entry_date = str(
            item.get("date") or item.get("entryDate") or
            item.get("checkDate") or item.get("accessDate") or ""
        ).strip()

        # Hours calculation — try multiple field patterns
        hours = 0.0
        if "totalHours" in item:
            hours = parse_minutes(item["totalHours"])
        elif "totalMinutes" in item:
            hours = parse_minutes(item["totalMinutes"])
        elif "hoursWorked" in item:
            hours = parse_minutes(item["hoursWorked"])
        elif "fromTime" in item and "toTime" in item:
            hours = parse_time_to_hours(str(item["fromTime"]), str(item["toTime"]))
        elif "checkIn" in item and "checkOut" in item:
            hours = parse_time_to_hours(str(item["checkIn"]), str(item["checkOut"]))
        elif "inTime" in item and "outTime" in item:
            hours = parse_time_to_hours(str(item["inTime"]), str(item["outTime"]))

        if emp_no and entry_date:
            records.append({
                "employee_number": emp_no,
                "employee_name": name,
                "date": entry_date,
                "hours": round(hours, 2),
            })

    return records


# ─── Build weekly report per employee ────────────────────────────────────────

def build_employee_weekly(records: list[dict], week_dates: list[date]) -> dict[str, dict]:
    """
    Returns {employee_number: {name, daily: {date_str: hours}, total_hours, projected_weekly}}
    """
    employees: dict[str, dict] = {}

    for rec in records:
        en = rec["employee_number"]
        if en not in employees:
            employees[en] = {
                "employee_number": en,
                "employee_name": rec["employee_name"],
                "daily": {},
                "total_hours": 0.0,
            }
        employees[en]["daily"][rec["date"]] = rec["hours"]
        employees[en]["total_hours"] += rec["hours"]

    # Projected weekly hours (mid-week extrapolation)
    today = date.today()
    days_elapsed = sum(1 for d in week_dates if d <= today)
    if days_elapsed == 0:
        days_elapsed = 1

    for en, emp in employees.items():
        emp["total_hours"] = round(emp["total_hours"], 2)
        if days_elapsed < 5:
            avg_per_day = emp["total_hours"] / days_elapsed
            emp["projected_weekly"] = round(avg_per_day * 5, 2)
        else:
            emp["projected_weekly"] = emp["total_hours"]

    return employees


# ─── Bucket allocation ────────────────────────────────────────────────────────

def allocate_bucket(hours: float) -> str:
    for label, low, high in BUCKETS:
        if low <= hours < high:
            return label
    return "50+"


def build_weekly_report(
    all_records: list[dict],
    employee_names: dict[str, str],
    from_date: str,
    to_date: str,
) -> dict:
    """
    Returns the full weekly report:
    {
      summary_buckets: [{bucket, count, pct, employees: [...]}],
      employees: [{employee_number, name, total_hours, projected, daily, bucket, alerts}],
      daily_team: [{date, day_name, avg_hours, total_hours, members_below_alert}],
      meta: {from, to, total_members, days_elapsed, is_partial_week}
    }
    """
    week_dates = get_week_dates(from_date, to_date)
    today = date.today()
    days_elapsed = max(1, sum(1 for d in week_dates if d <= today))
    is_partial = days_elapsed < len(week_dates)

    emp_data = build_employee_weekly(all_records, week_dates)

    for en, emp in emp_data.items():
        if employee_names.get(en):
            emp["employee_name"] = employee_names[en]

    # Fill in names from reportees list for employees with no records
    for en, name in employee_names.items():
        if en not in emp_data:
            emp_data[en] = {
                "employee_number": en,
                "employee_name": name,
                "daily": {},
                "total_hours": 0.0,
                "projected_weekly": 0.0,
            }

    # Per-employee enrichment
    emp_list = []
    bucket_map: dict[str, list[str]] = {b[0]: [] for b in BUCKETS}

    for en, emp in emp_data.items():
        bucket = allocate_bucket(emp["total_hours"])
        bucket_map.setdefault(bucket, []).append(emp["employee_name"] or en)

        # Day-level alerts
        daily_alerts = []
        for d in week_dates:
            ds = str(d)
            h = emp["daily"].get(ds, None)
            if h is not None and h < DAILY_ALERT:
                daily_alerts.append({"date": ds, "hours": h, "day": d.strftime("%a")})

        emp_list.append({
            "employee_number": en,
            "employee_name": emp["employee_name"],
            "total_hours": emp["total_hours"],
            "projected_weekly": emp.get("projected_weekly", emp["total_hours"]),
            "daily": emp["daily"],
            "bucket": bucket,
            "below_target": emp["total_hours"] < WEEKLY_TARGET,
            "daily_alerts": daily_alerts,
        })

    emp_list.sort(key=lambda x: x["total_hours"], reverse=True)
    total_members = len(emp_list)

    # Bucket summary for pie chart
    summary_buckets = []
    for label, _, _ in BUCKETS:
        members = bucket_map.get(label, [])
        count = len(members)
        pct = round(count / total_members * 100, 1) if total_members else 0
        summary_buckets.append({
            "bucket": label,
            "count": count,
            "pct": pct,
            "employees": members,
        })

    # Daily team averages
    daily_team = []
    for d in week_dates:
        ds = str(d)
        day_hours = [e["daily"].get(ds, 0) for e in emp_list]
        present = [h for h in day_hours if h > 0]
        avg = round(sum(present) / len(present), 2) if present else 0.0
        total = round(sum(day_hours), 2)
        below_alert = [
            e["employee_name"]
            for e in emp_list
            if 0 < e["daily"].get(ds, 0) < DAILY_ALERT
        ]
        daily_team.append({
            "date": ds,
            "day": d.strftime("%a"),
            "avg_hours": avg,
            "total_hours": total,
            "members_present": len(present),
            "members_below_alert": below_alert,
            "is_future": d > today,
        })

    return {
        "summary_buckets": summary_buckets,
        "employees": emp_list,
        "daily_team": daily_team,
        "meta": {
            "from_date": from_date,
            "to_date": to_date,
            "total_members": total_members,
            "days_elapsed": days_elapsed,
            "is_partial_week": is_partial,
            "daily_target": DAILY_TARGET,
            "weekly_target": WEEKLY_TARGET,
            "daily_alert_threshold": DAILY_ALERT,
        },
    }
