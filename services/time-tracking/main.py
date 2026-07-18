from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from datetime import date, timedelta

from tracker import PhotonTrackSessionExpired, fetch_reportees, fetch_all_access, fetch_access_batch, get_week_range
from analytics import build_weekly_report, normalise_records

app = FastAPI(title="Time Tracking Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3001", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ReportRequest(BaseModel):
    session_cookie: str = ""
    from_date: Optional[str] = None
    to_date: Optional[str] = None
    employee_numbers: Optional[str] = None  # comma-separated, e.g. "144267,153175"
    employee_names_map: Optional[dict] = None  # {"144267": "Alice B", ...}


@app.get("/health")
def health():
    return {"status": "ok", "service": "time-tracking"}


@app.get("/reportees")
async def get_reportees(session_cookie: str = Query(default="")):
    try:
        return await fetch_reportees(session_cookie)
    except PhotonTrackSessionExpired as e:
        raise HTTPException(status_code=401, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/report")
async def get_report(req: ReportRequest):
    """
    Fetch all employee access data and return full analytics report.
    Includes: pie chart buckets, per-employee daily breakdown, team daily averages.
    """
    try:
        from_date = req.from_date
        to_date   = req.to_date
        if not from_date or not to_date:
            from_date, to_date = get_week_range()

        all_records, employee_names = await fetch_all_access(
            req.session_cookie, from_date, to_date,
            employee_numbers_csv=req.employee_numbers or None,
        )

        # Apply stored name map (API returns empty employeeName for all records)
        if req.employee_names_map:
            for code, name in req.employee_names_map.items():
                if name:
                    employee_names[str(code)] = str(name)
        # Fall back: use code as display name for any still-unnamed employee
        for code in list(employee_names.keys()):
            if not employee_names[code]:
                employee_names[code] = code

        normalised = normalise_records(all_records, list(employee_names.keys()))
        report = build_weekly_report(normalised, employee_names, from_date, to_date)
        return report
    except PhotonTrackSessionExpired as e:
        raise HTTPException(status_code=401, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/raw-access")
async def raw_access(req: ReportRequest):
    """
    Return the raw getReporteesAccess API response for debugging.
    Shows exactly what Photon Track returns so response format can be verified.
    """
    try:
        from_date = req.from_date or get_week_range()[0]
        to_date   = req.to_date   or get_week_range()[1]
        emp_csv   = req.employee_numbers or ""
        if not emp_csv:
            return {"error": "employee_numbers required for raw-access debug endpoint"}

        raw = await fetch_access_batch(req.session_cookie, emp_csv, from_date, to_date)
        return {"raw_response": raw, "type": type(raw).__name__,
                "top_level_keys": list(raw.keys()) if isinstance(raw, dict) else None,
                "is_list": isinstance(raw, list),
                "item_count": len(raw) if isinstance(raw, list) else
                              sum(len(v) for v in raw.values() if isinstance(v, list)) if isinstance(raw, dict) else 0,
                "first_item": (raw[0] if isinstance(raw, list) else
                               next((v[0] for v in raw.values() if isinstance(v, list) and v), None)) }
    except PhotonTrackSessionExpired as e:
        raise HTTPException(status_code=401, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
