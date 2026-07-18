import time
import os
import httpx
from datetime import date, timedelta
from typing import Optional
from timesheet_entry import BASE_URL, build_headers

# Only approve timesheets that have exactly this many minutes (8 h 48 m = 8:48).
REQUIRED_MINUTES = 528
VERIFY_SSL = os.getenv("PHOTONTRACK_VERIFY_SSL", "false").lower() not in {"0", "false", "no"}


def _ts() -> str:
    return str(int(time.time() * 1000))


async def fetch_pending_timesheets(
    session_cookie: str,
    emp_id: int = 17463,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
) -> list:
    """Fetch pending timesheets for ALL reportees via getmyreportees.

    Returns the employeeReviewStatus list which contains timesheet_id and
    total_mnts for every reportee's submitted timesheets.
    approverRoll=3 = manager role.
    """
    today = date.today()
    if to_date is None:
        to_date = today.strftime("%Y-%m-%d")
    if from_date is None:
        from_date = (today - timedelta(days=30)).strftime("%Y-%m-%d")

    url = f"{BASE_URL}/timetracker/getmyreportees?time-stamp={_ts()}"
    payload = {
        "employeeId": emp_id,
        "approverRoll": 3,
        "fromDate": from_date,
        "toDate": to_date,
    }

    try:
        async with httpx.AsyncClient(verify=VERIFY_SSL, timeout=30.0) as client:
            resp = await client.post(url, json=payload, headers=build_headers(session_cookie))
            if resp.status_code != 200:
                print(f"[approval] getmyreportees returned HTTP {resp.status_code}")
                return []
            data = resp.json()
            if isinstance(data, dict) and data.get("status") in ("SUCCESS", "success"):
                # employeeReviewStatus contains per-timesheet records with
                # timesheet_id and total_mnts — exactly what filter_and_extract_ids expects
                return data.get("employeeReviewStatus", [])
            return []
    except Exception as exc:
        print(f"[approval] fetch_pending_timesheets error: {exc}")
        return []


def _extract_field(record: dict, *keys):
    """Return the first truthy value found from the given key names."""
    for k in keys:
        v = record.get(k)
        if v is not None:
            return v
    return None


def filter_and_extract_ids(
    timesheets: list,
    required_minutes: int = REQUIRED_MINUTES,
) -> tuple[list, list]:
    """
    Return (approved_ids, skipped_list).

    approved_ids  – integer timesheet IDs that have exactly required_minutes.
    skipped_list  – dicts describing each skipped record and the reason.
    """
    approved_ids: list[int] = []
    skipped: list[dict] = []

    for ts in timesheets:
        if not isinstance(ts, dict):
            continue

        # --- timesheet ID ---
        raw_id = _extract_field(
            ts,
            "Timesheet_Id", "timesheetId", "timesheet_id", "id",
        )
        if raw_id is None and "attrs" in ts:
            raw_id = ts["attrs"].get("id")
        if raw_id is None:
            continue
        try:
            ts_id = int(raw_id)
        except (ValueError, TypeError):
            continue

        # --- total minutes ---
        raw_mnts = _extract_field(
            ts,
            "Total_Mnts", "totalMnts", "total_mnts", "totalMinutes",
            "Totalhours",   # base64 in submission but plain int in approval list
            "hours",        # getRequestReviewSearch returns "hours": 528
        )
        try:
            total_mnts = int(raw_mnts) if raw_mnts is not None else None
        except (ValueError, TypeError):
            total_mnts = None

        if total_mnts != required_minutes:
            skipped.append({
                "id": ts_id,
                "total_mnts": total_mnts,
                "reason": f"hours {total_mnts} min \u2260 {required_minutes} min (8:48)",
            })
            continue

        approved_ids.append(ts_id)

    return approved_ids, skipped


async def approve_timesheets(
    session_cookie: str,
    timesheet_ids: Optional[list] = None,
    emp_id: int = 17463,
    dry_run: bool = False,
) -> dict:
    """
    1. If no IDs supplied, call approverinfo to get all pending timesheets.
    2. Filter to only those with exactly 528 min (8:48) per day.
    3. POST approvedisputetimesheet with the approved subset.
    """
    skipped: list[dict] = []

    if not timesheet_ids:
        pending = await fetch_pending_timesheets(session_cookie, emp_id)
        if not pending:
            return {
                "status": "skipped",
                "message": "No pending timesheets found",
                "approved_count": 0,
            }
        timesheet_ids, skipped = filter_and_extract_ids(pending)

    if not timesheet_ids:
        return {
            "status": "skipped",
            "message": f"No timesheets with exactly {REQUIRED_MINUTES} min — none approved",
            "approved_count": 0,
            "skipped_count": len(skipped),
            "skipped": skipped,
        }

    xml_data = [{"name": "timesheet", "attrs": {"id": tid}} for tid in timesheet_ids]
    payload = {
        "xmlData": xml_data,
        "status": "Approved",
        "emp_id": emp_id,
        "disputeComments": "",
    }

    if dry_run:
        return {
            "dry_run": True,
            "url": f"{BASE_URL}/timetracker/approvedisputetimesheet",
            "payload": payload,
            "pending_count": len(timesheet_ids),
            "skipped_count": len(skipped),
            "skipped": skipped,
            "message": "Dry run — no request sent",
        }

    async with httpx.AsyncClient(verify=VERIFY_SSL, timeout=30.0) as client:
        resp = await client.post(
            f"{BASE_URL}/timetracker/approvedisputetimesheet",
            json=payload,
            headers=build_headers(session_cookie),
        )
        resp.raise_for_status()
        return {
            "status": "success",
            "http_status": resp.status_code,
            "approved_count": len(timesheet_ids),
            "timesheet_ids": timesheet_ids,
            "skipped_count": len(skipped),
            "skipped": skipped,
            "response": resp.json() if "application/json" in resp.headers.get("content-type", "") else resp.text[:500],
        }
