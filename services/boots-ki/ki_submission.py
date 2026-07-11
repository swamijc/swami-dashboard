import httpx
from typing import Optional
from utils.form_encoder import build_ki_form_payload

BASE_URL = "https://allianceboots.hosted.keyedinprojects.co.uk"
SITE     = "KIE200143PROD"


def build_ki_headers(ki_cookie: str) -> dict:
    return {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "Accept": "*/*",
        "Accept-Language": "en-US,en;q=0.9",
        "DNT": "1",
        "Origin": BASE_URL,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.0.0 Safari/537.36",
        "X-Requested-With": "XMLHttpRequest",
        "sec-ch-ua": '"Google Chrome";v="149", "Chromium";v="149", "Not)A;Brand";v="24"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"macOS"',
        "Cookie": ki_cookie,
    }


async def submit_ki_timesheet(
    resource_code: str,
    ki_cookie: str,
    config: dict,
    week_start: Optional[str] = None,
    day_flags: Optional[dict] = None,
    dry_run: bool = False,
) -> dict:
    """Submit a KeyedIn timesheet for a given resource."""
    form_body = build_ki_form_payload(
        resource_code=resource_code,
        week_start=week_start,
        hours_per_day=float(config.get("hours_per_day", 8.0)),
        project_id=config.get("project_id", ""),
        project_description=config.get("project_description", ""),
        activity_id=config.get("activity_id", ""),
        activity_description=config.get("activity_description", ""),
        task_id=config.get("task_id", ""),
        task_description=config.get("task_description", ""),
        day_flags=day_flags,
    )

    url = f"{BASE_URL}/TimeEntry/SaveTimeEntry?Site={SITE}"
    referer = f"{BASE_URL}/TimeEntry/Entry?resourceCode={resource_code}&weekStart=&SetBreadCrumb=True"
    headers = build_ki_headers(ki_cookie)
    headers["Referer"] = referer

    if dry_run:
        return {
            "dry_run": True,
            "url": url,
            "resource_code": resource_code,
            "week_start": week_start,
            "day_flags": day_flags or {"mon":"Y","tue":"Y","wed":"Y","thu":"Y","fri":"Y"},
            "hours_per_day": config.get("hours_per_day"),
            "form_body_preview": form_body[:500] + ("..." if len(form_body) > 500 else ""),
            "message": "Dry run — no request sent",
        }

    async with httpx.AsyncClient(verify=True, timeout=30.0) as client:
        resp = await client.post(url, content=form_body.encode("utf-8"), headers=headers)
        resp.raise_for_status()
        return {
            "status": "success",
            "http_status": resp.status_code,
            "resource_code": resource_code,
            "week_start": week_start,
            "response_preview": resp.text[:500],
        }
