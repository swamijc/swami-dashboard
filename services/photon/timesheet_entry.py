import base64
import time
from datetime import date, timedelta
from typing import Optional
import httpx


BASE_URL = "https://timetracker.photon.com"
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
    """Submit Swami's timesheet via updatetimesheet endpoint."""
    if target_date is None:
        target_date = date.today().strftime("%Y-%m-%d")

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
    async with httpx.AsyncClient(verify=True, timeout=30.0) as client:
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
    """Submit Prasanna's timesheet via insertXls endpoint."""
    if dates is None:
        # Default to current week Mon–Fri
        today = date.today()
        monday = today - timedelta(days=today.weekday())
        dates = [(monday + timedelta(days=i)).strftime("%Y-%m-%d") for i in range(5)]

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

    async with httpx.AsyncClient(verify=True, timeout=30.0) as client:
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
