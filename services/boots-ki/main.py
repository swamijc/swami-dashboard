from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional

from ki_submission import submit_ki_timesheet

app = FastAPI(title="Boots KI Timesheet Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3001", "http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class KISubmitRequest(BaseModel):
    resource_code: str
    ki_cookie: str = ""
    config: dict = {}
    week_start: Optional[str] = None
    day_flags: Optional[dict] = None
    dry_run: bool = False


@app.get("/health")
def health():
    return {"status": "ok", "service": "boots-ki-timesheet"}


@app.post("/submit")
async def submit(req: KISubmitRequest):
    try:
        result = await submit_ki_timesheet(
            resource_code=req.resource_code,
            ki_cookie=req.ki_cookie,
            config=req.config,
            week_start=req.week_start,
            day_flags=req.day_flags,
            dry_run=req.dry_run,
        )
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
