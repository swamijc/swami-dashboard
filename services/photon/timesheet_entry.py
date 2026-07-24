import base64
import time
import os
from datetime import date, timedelta
from typing import Optional
import httpx


BASE_URL  = "https://timetracker.photon.com"
VERIFY_SSL = os.getenv("PHOTONTRACK_VERIFY_SSL", "false").lower() not in {"0", "false", "no"}
COMMON_HEADERS = {
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Access-Control-Allow-Headers": "Origin, X-Requested-With, Content-Type, Accept",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-cache, no-store, must-revalidate, post-check=0, pre-check=0",
    "Connection": "keep-alive",
    "Content-Type": "application/json",
    "DNT": "1",
    "Host": "timetracker.photon.com",
    "Origin": "https://timetracker.photon.com",
    "Pragma": "no-cache",
    "Referer": "https://timetracker.photon.com/timetracker/",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36",
}


def encode_hours(minutes: int) -> str:
    """Encode minutes as Base64 string (Photon updatetimesheet format)."""
    return base64.b64encode(str(minutes).encode()).decode()


def get_timestamp_ms() -> str:
    """Return current Unix timestamp in milliseconds."""
    return str(int(time.time() * 1000))


def build_headers(session_cookie: str) -> dict:
    headers = dict(COMMON_HEADERS)
    if session_cookie:
        headers["Cookie"] = session_cookie
    return headers


async def submit_swami_timesheet(
    session_cookie: str,
    target_date: Optional[str] = None,
    emp_id: int = 17463,
    project_id: int = 6347,
    category_id: int = 1,
    sub_category_id: int = 15,
    total_minutes: int = 528,
    attrs_id: int = 0,
    dry_run: bool = False,
) -> dict:
    """Submit Swami's timesheet via updatetimesheet endpoint.

    Automatically skips Saturday and Sunday dates so the function is safe
    even if triggered manually on a weekend.
    """
    if target_date is None:
        target_date = date.today().strftime("%Y-%m-%d")

    # Weekday guard: 0=Mon … 4=Fri, 5=Sat, 6=Sun
    if date.fromisoformat(target_date).weekday() >= 5:
        return {
            "status": "skipped",
            "message": f"{target_date} is a weekend — timesheets only run Mon–Fri.",
            "date": target_date,
        }
    payload = {
        "payload": [{
            "name": "timesheet",
            "children": {
                "Employee_Id": emp_id,
                "Project_Id": project_id,
                "Category_Id": category_id,
                "Sub_Category_Id": sub_category_id,
                "Timesheet_Status_Id": 2,
                "app_internal_id": "0",
                "Timesheet_Date": target_date,
                "Totalhours": encode_hours(total_minutes),
                "comments": " ",
                "flag": 1,
            },
            "attrs": {"id": attrs_id},
        }],
        "emp_id": emp_id,
    }

    if dry_run:
        return {
            "dry_run": True,
            "url": f"{BASE_URL}/timetracker/updatetimesheet?time-stamp={get_timestamp_ms()}",
            "payload": payload,
            "message": "Dry run — no request sent",
        }

    url = f"{BASE_URL}/timetracker/updatetimesheet?time-stamp={get_timestamp_ms()}"
    async with httpx.AsyncClient(verify=VERIFY_SSL, timeout=30.0) as client:
        resp = await client.post(url, json=payload, headers=build_headers(session_cookie))
        resp.raise_for_status()
        return {
            "status": "success",
            "http_status": resp.status_code,
            "date": target_date,
            "response": resp.json() if "application/json" in resp.headers.get("content-type","") else resp.text[:500],
        }


async def submit_prasanna_timesheet(
    session_cookie: str,
    dates: Optional[list] = None,
    submitted_by: int = 17463,
    insight_id: str = "prasanna_vi",
    employee_code: str = "102014",
    project_code: str = "12667",
    from_time: str = "09:00",
    to_time: str = "18:00",
    total_mnts: str = "528",
    comments: str = "Boots 50% billable",
    approver_insight_id: str = "swaminathan_k",
    dry_run: bool = False,
) -> dict:
    """Submit Prasanna's timesheet via insertXls endpoint.

    insertXls only accepts strictly past dates (before today).  The cron runs
    Mon-Fri, so we submit yesterday's workday by default:
      Monday   → Friday (skip Sat/Sun back to Friday)
      Tue-Fri  → previous calendar day
    """
    if dates is None:
        today = date.today()
        yesterday = today - timedelta(days=1)
        # Skip back over the weekend so Monday cron submits Friday's timesheet.
        if yesterday.weekday() == 5:   # Saturday → go back to Friday
            yesterday -= timedelta(days=1)
        elif yesterday.weekday() == 6: # Sunday   → go back to Friday
            yesterday -= timedelta(days=2)
        dates = [yesterday.strftime("%Y-%m-%d")]

    # Weekday guard: drop any Saturday/Sunday dates from the list.
    dates = [d for d in dates if date.fromisoformat(d).weekday() < 5]
    if not dates:
        return {
            "status": "skipped",
            "message": "All requested dates are weekends — timesheets only run Mon–Fri.",
            "dates": [],
        }

    timesheet_list = [
        {
            "insightId": insight_id,
            "employeeCode": employee_code,
            "projectCode": project_code,
            "timesheetDate": d,
            "fromTime": from_time,
            "toTime": to_time,
            "totalMnts": total_mnts,
            "comments": comments,
            "approverInsightId": approver_insight_id,
        }
        for d in dates
    ]

    payload = {"submittedBy": submitted_by, "fileType": "Entry", "timesheetListObj": timesheet_list}

    if dry_run:
        return {
            "dry_run": True,
            "url": f"{BASE_URL}/timetracker/insertXls",
            "payload": payload,
            "dates": dates,
            "message": "Dry run — no request sent",
        }

    async with httpx.AsyncClient(verify=VERIFY_SSL, timeout=30.0) as client:
        resp = await client.post(
            f"{BASE_URL}/timetracker/insertXls",
            json=payload,
            headers=build_headers(session_cookie),
        )
        resp.raise_for_status()
        return {
            "status": "success",
            "http_status": resp.status_code,
            "dates": dates,
            "count": len(dates),
            "response": resp.json() if "application/json" in resp.headers.get("content-type","") else resp.text[:500],
        }


# ── PMO Review / Defaulter submission ────────────────────────────────────────

async def get_pmo_review_items(
    session_cookie: str,
    employee_id: int = 17463,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
) -> list[dict]:
    """
    Search for timesheets eligible for PMO review via getRequestReviewSearch.

    Default date range: Monday of the current week → last day of the current month.
    This matches the exact payload format confirmed from live browser requests.
    Returns the raw requestReviewSearchData list.
    """
    today = date.today()
    if to_date is None:
        # End of the current month
        import calendar
        last_day = calendar.monthrange(today.year, today.month)[1]
        to_date = today.replace(day=last_day).strftime("%Y-%m-%d")
    if from_date is None:
        # Monday of the current week (weekday 0 = Mon)
        days_since_monday = today.weekday()  # 0=Mon … 6=Sun
        week_monday = today - timedelta(days=days_since_monday)
        from_date = week_monday.strftime("%Y-%m-%d")

    url = f"{BASE_URL}/timetracker/getRequestReviewSearch?time-stamp={get_timestamp_ms()}"
    # Use the exact payload format confirmed from live browser request
    payload = {
        "employeeCode": "137711",
        "projectId":    "6347",
        "fromDate":     from_date,
        "toDate":       to_date,
    }

    async with httpx.AsyncClient(verify=VERIFY_SSL, timeout=30.0) as client:
        resp = await client.post(url, json=payload, headers=build_headers(session_cookie))
        resp.raise_for_status()
        data = resp.json()
        return data.get("requestReviewSearchData", []) if isinstance(data, dict) else []


async def submit_pmo_review(
    session_cookie: str,
    review_items: list[dict],
    employee_id: int = 17463,
    dry_run: bool = False,
) -> dict:
    """
    The PMO submission already happened inside get_pmo_review_items —
    calling getRequestReviewSearch with the correct payload both CREATES
    the PMO request and returns the affected timesheets.  This function
    just packages the result for the caller.
    """
    if not review_items:
        return {
            "status": "no_pending",
            "message": "No pending PMO review requests found.",
            "submitted_count": 0,
        }

    # Extract IDs for the response summary
    ids = [
        item.get("timesheetId") or item.get("Timesheet_Id") or
        item.get("timesheet_id") or item.get("id")
        for item in review_items
        if item.get("timesheetId") or item.get("Timesheet_Id") or
           item.get("timesheet_id") or item.get("id")
    ]

    if dry_run:
        return {
            "dry_run": True,
            "pending_count": len(review_items),
            "timesheet_ids": ids,
            "message": "Dry run — getRequestReviewSearch was called, PMO requests would be created.",
        }

    return {
        "status": "success",
        "submitted_count": len(review_items),
        "timesheet_ids": ids,
        "message": f"Request submitted to PMO — {len(review_items)} timesheet(s) sent for review.",
        "response": {"requestReviewSearchData": review_items},
    }

