from typing import Optional
import httpx
from timesheet_entry import BASE_URL, build_headers


async def fetch_pending_timesheets(session_cookie: str, emp_id: int = 17463) -> list:
    """
    Fetch pending timesheets awaiting approval.
    TODO: Replace endpoint once GET URL is captured from browser DevTools.
    Placeholder: returns empty list — approval will log 'nothing to approve'.
    """
    # PLACEHOLDER — update this endpoint once you capture the GET request
    # from browser DevTools when viewing the pending approvals screen.
    # Expected response: list of timesheet records with attrs.id values.
    try:
        async with httpx.AsyncClient(verify=True, timeout=30.0) as client:
            resp = await client.get(
                f"{BASE_URL}/timetracker/pendingtimesheets",  # ← UPDATE THIS URL
                params={"emp_id": emp_id},
                headers=build_headers(session_cookie),
            )
            if resp.status_code == 200:
                data = resp.json()
                # Extract record IDs from response — adjust parsing once real response is known
                if isinstance(data, list):
                    return [{"name": "timesheet", "attrs": {"id": item.get("id")}} for item in data if item.get("id")]
                if isinstance(data, dict) and "timesheets" in data:
                    return [{"name": "timesheet", "attrs": {"id": item.get("id")}} for item in data["timesheets"] if item.get("id")]
    except Exception:
        pass
    return []


async def approve_timesheets(
    session_cookie: str,
    timesheet_ids: Optional[list] = None,
    emp_id: int = 17463,
    dry_run: bool = False,
) -> dict:
    """Bulk approve timesheets via approvedisputetimesheet endpoint."""

    # Step 1: If no IDs provided, fetch pending
    if not timesheet_ids:
        pending = await fetch_pending_timesheets(session_cookie, emp_id)
        timesheet_ids = [item["attrs"]["id"] for item in pending if item.get("attrs", {}).get("id")]

    if not timesheet_ids:
        return {"status": "skipped", "message": "No pending timesheets found", "approved_count": 0}

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
            "message": "Dry run — no request sent",
        }

    async with httpx.AsyncClient(verify=True, timeout=30.0) as client:
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
            "response": resp.json() if "application/json" in resp.headers.get("content-type","") else resp.text[:500],
        }
