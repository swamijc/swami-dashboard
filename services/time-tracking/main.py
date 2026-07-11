from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
from datetime import date, timedelta

from tracker import fetch_reportees, fetch_all_access, get_week_range
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


@app.get("/health")
def health():
    return {"status": "ok", "service": "time-tracking"}


@app.get("/reportees")
async def get_reportees(session_cookie: str = Query(default="")):
    try:
        return await fetch_reportees(session_cookie)
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
            req.session_cookie, from_date, to_date
        )

        normalised = normalise_records(all_records, list(employee_names.keys()))
        report = build_weekly_report(normalised, employee_names, from_date, to_date)
        return report
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
