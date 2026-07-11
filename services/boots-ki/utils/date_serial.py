from datetime import date, timedelta

EXCEL_EPOCH = date(1899, 12, 30)


def to_excel_serial(d: date) -> int:
    """Convert a date to Excel OLE Automation serial number."""
    return (d - EXCEL_EPOCH).days


def get_week_start_serial(target_date: date | None = None) -> int:
    """Return the Excel serial for the Monday of the given (or current) week."""
    if target_date is None:
        target_date = date.today()
    monday = target_date - timedelta(days=target_date.weekday())
    return to_excel_serial(monday)


def get_week_dates(week_start: str | None = None) -> list[date]:
    """Return list of 7 date objects starting from Monday of the given ISO week_start."""
    if week_start:
        monday = date.fromisoformat(week_start)
    else:
        today = date.today()
        monday = today - timedelta(days=today.weekday())
    return [monday + timedelta(days=i) for i in range(7)]
