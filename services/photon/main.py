from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List
import os

from timesheet_entry import submit_swami_timesheet, submit_prasanna_timesheet
from approval import approve_timesheets

app = FastAPI(title="Photon Timesheet Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3001", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class SwamiSubmitRequest(BaseModel):
    session_cookie: str = ""
    target_date: Optional[str] = None
    total_minutes: int = 528
    attrs_id: int = 0
    dry_run: bool = False


class PrasannaSubmitRequest(BaseModel):
    session_cookie: str = ""
    dates: Optional[List[str]] = None
    dry_run: bool = False


class ApprovalRequest(BaseModel):
    session_cookie: str = ""
    timesheet_ids: Optional[List[int]] = None
    dry_run: bool = False


@app.get("/health")
def health():
    return {"status": "ok", "service": "photon-timesheet"}


@app.post("/swami/submit")
async def swami_submit(req: SwamiSubmitRequest):
    try:
        result = await submit_swami_timesheet(
            session_cookie=req.session_cookie,
            target_date=req.target_date,
            total_minutes=req.total_minutes,
            attrs_id=req.attrs_id,
            dry_run=req.dry_run,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/prasanna/submit")
async def prasanna_submit(req: PrasannaSubmitRequest):
    try:
        result = await submit_prasanna_timesheet(
            session_cookie=req.session_cookie,
            dates=req.dates,
            dry_run=req.dry_run,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/approve")
async def approve(req: ApprovalRequest):
    try:
        result = await approve_timesheets(
            session_cookie=req.session_cookie,
            timesheet_ids=req.timesheet_ids,
            dry_run=req.dry_run,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
