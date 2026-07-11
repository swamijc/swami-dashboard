"""
tracker.py — Calls photontrack.photon.com APIs.

Two calls:
  1. GET  /photontrack/reportees         → list of Swami's reportees
  2. POST /photontrack/getReporteesAccess → time-access data per employee batch
"""

from datetime import date, timedelta
from typing import Optional, Any
import httpx
import os
import asyncio

BASE_URL = "https://photontrack.photon.com"
VERIFY_SSL = os.getenv("PHOTONTRACK_VERIFY_SSL", "false").lower() not in {"0", "false", "no"}
EMPLOYEE_BATCH_SIZE = 3
MAX_CONCURRENT_BATCHES = 5
PHOTON_REQUEST_TIMEOUT_SECONDS = float(os.getenv("PHOTONTRACK_REQUEST_TIMEOUT_SECONDS", "15"))
PHOTON_BATCH_TIMEOUT_SECONDS = float(os.getenv("PHOTONTRACK_BATCH_TIMEOUT_SECONDS", "20"))
PHOTON_REPORT_TIMEOUT_SECONDS = float(os.getenv("PHOTONTRACK_REPORT_TIMEOUT_SECONDS", "120"))

COMMON_HEADERS = {
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9,ta;q=0.8",
    "Connection": "keep-alive",
    "DNT": "1",
    "Host": "photontrack.photon.com",
    "Referer": "https://photontrack.photon.com/photontrack/",
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
    "sec-ch-ua": '"Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"macOS"',
}


def format_photon_date(value: str) -> str:
    parsed = date.fromisoformat(value)
    return f"{parsed.year}-{parsed.month}-{parsed.day}"


def build_headers(session_cookie: str) -> dict:
    h = dict(COMMON_HEADERS)
    if session_cookie:
        h["Cookie"] = session_cookie
    return h


def flatten_response_items(value: Any) -> list[dict]:
    if isinstance(value, list):
        items: list[dict] = []
        for child in value:
            items.extend(flatten_response_items(child))
        return items

    if not isinstance(value, dict):
        return []

    record_markers = {
        "employeeNumber", "employeeCode", "empCode", "empNo", "reporteeEmployeeCode",
        "employeeName", "empName", "reporteeName", "date", "entryDate", "accessDate",
        "checkDate", "fromTime", "toTime", "inTime", "outTime", "totalHours",
        "totalMinutes", "hoursWorked",
    }
    if any(key in value for key in record_markers):
        return [value]

    for key in ("data", "records", "timesheets", "accessData", "reporteeData", "entries"):
        if key in value:
            return flatten_response_items(value[key])

    items: list[dict] = []
    for child in value.values():
        items.extend(flatten_response_items(child))
    return items


def chunks(values: list[str], size: int) -> list[list[str]]:
    return [values[index:index + size] for index in range(0, len(values), size)]


def extract_reportee_index(reportees: list[dict]) -> tuple[list[str], dict[str, str]]:
    employee_codes: list[str] = []
    employee_names: dict[str, str] = {}

    for reportee in reportees:
        if not isinstance(reportee, dict):
            continue
        code = str(
            reportee.get("reporteeEmployeeCode") or
            reportee.get("employeeCode") or
            reportee.get("employeeNumber") or
            reportee.get("empCode") or
            ""
        ).strip()
        name = str(
            reportee.get("reporteeName") or
            reportee.get("employeeName") or
            reportee.get("name") or
            reportee.get("empName") or
            code
        ).strip()
        if code and code not in employee_names:
            employee_codes.append(code)
            employee_names[code] = name or code

    return employee_codes, employee_names


def get_week_range() -> tuple[str, str]:
    """Return (from_date, to_date) for current week Monday-Sunday as ISO dates."""
    today = date.today()
    monday = today - timedelta(days=today.weekday())
    sunday = monday + timedelta(days=6)
    return str(monday), str(sunday)


async def fetch_reportees(session_cookie: str) -> list[dict]:
    """GET /photontrack/reportees — returns Swami's direct reports."""
    url = f"{BASE_URL}/photontrack/reportees"
    async with httpx.AsyncClient(verify=VERIFY_SSL, timeout=PHOTON_REQUEST_TIMEOUT_SECONDS) as client:
        resp = await client.get(url, headers=build_headers(session_cookie))
        resp.raise_for_status()
        data = resp.json()
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            return data.get("reportees", data.get("data", [data]))
        return []


async def fetch_access_batch(
    session_cookie: str,
    employee_numbers: str,
    from_date: str,
    to_date: str,
) -> Any:
    """POST /photontrack/getReporteesAccess for one batch of employees."""
    url = f"{BASE_URL}/photontrack/getReporteesAccess"
    payload = {
        "fromDate": format_photon_date(from_date),
        "toDate": format_photon_date(to_date),
        "employeenumber": employee_numbers,
    }
    headers = {**build_headers(session_cookie), "Content-Type": "application/json",
               "Origin": BASE_URL}
    async with httpx.AsyncClient(verify=VERIFY_SSL, timeout=PHOTON_REQUEST_TIMEOUT_SECONDS) as client:
        resp = await client.post(url, json=payload, headers=headers)
        resp.raise_for_status()
        return resp.json()


async def fetch_all_access(
    session_cookie: str,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
) -> tuple[list, dict]:
    """
    Fetch access data for all reportees in Photon Track batches.
    Returns (all_records_flat, employee_names_dict)
    """
    if not from_date or not to_date:
        from_date, to_date = get_week_range()

    all_records: list = []
    reportees = await fetch_reportees(session_cookie)
    employee_codes, employee_names = extract_reportee_index(reportees)

    if not employee_codes:
        return all_records, employee_names

    semaphore = asyncio.Semaphore(MAX_CONCURRENT_BATCHES)

    async def fetch_batch(employee_batch: list[str]) -> list[dict]:
        batch = ",".join(employee_batch)
        try:
            async with semaphore:
                raw = await asyncio.wait_for(
                    fetch_access_batch(session_cookie, batch, from_date, to_date),
                    timeout=PHOTON_BATCH_TIMEOUT_SECONDS,
                )
            return flatten_response_items(raw)
        except asyncio.TimeoutError:
            print(f"[tracker] Batch {batch} timed out after {PHOTON_BATCH_TIMEOUT_SECONDS}s")
            return []
        except Exception as e:
            print(f"[tracker] Batch {batch} failed: {e}")
            return []

    batches = chunks(employee_codes, EMPLOYEE_BATCH_SIZE)
    tasks = [asyncio.create_task(fetch_batch(batch)) for batch in batches]
    try:
        for task in asyncio.as_completed(tasks, timeout=PHOTON_REPORT_TIMEOUT_SECONDS):
            all_records.extend(await task)
    except asyncio.TimeoutError:
        pending_count = sum(1 for task in tasks if not task.done())
        print(f"[tracker] Report fetch timed out after {PHOTON_REPORT_TIMEOUT_SECONDS}s; cancelling {pending_count} pending batch(es)")
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    # Add or refine names from access records when Photon returns them.
    for rec in all_records:
        if isinstance(rec, dict):
            en = str(rec.get("employeeNumber") or rec.get("employeeCode") or rec.get("empCode") or rec.get("empNo") or "")
            name = str(rec.get("employeeName") or rec.get("name") or rec.get("empName") or rec.get("reporteeName") or en)
            if en:
                employee_names.setdefault(en, name)

    return all_records, employee_names
