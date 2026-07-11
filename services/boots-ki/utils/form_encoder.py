from urllib.parse import urlencode
from datetime import date
from utils.date_serial import get_week_dates, to_excel_serial, get_week_start_serial


def build_ki_form_payload(
    resource_code: str,
    week_start: str | None,
    hours_per_day: float,
    project_id: str,
    project_description: str,
    activity_id: str,
    activity_description: str,
    task_id: str,
    task_description: str,
    day_flags: dict | None = None,
    ooo_project_id: str = "",
    ooo_activity_id: str = "",
    ooo_task_id: str = "",
) -> str:
    """
    Build the application/x-www-form-urlencoded payload for KeyedIn SaveTimeEntry.
    day_flags: {'mon':'Y','tue':'Y','wed':'Y','thu':'Y','fri':'Y'}
    Y = main project, N = OoO project
    """
    if day_flags is None:
        day_flags = {"mon": "Y", "tue": "Y", "wed": "Y", "thu": "Y", "fri": "Y"}

    week_days = get_week_dates(week_start)
    week_serial = get_week_start_serial(date.fromisoformat(week_start) if week_start else None)
    day_names = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]

    fields: list[tuple[str, str]] = [
        ("Resource.Code", resource_code),
        ("WeekStart", str(week_serial)),
        ("CanChangeResource", "True"),
        ("AccessToTimesheetNotes", "True"),
        ("HasJIRAData", "False"),
        ("JIRAConfrimText", ""),
        ("TimeEntryFormat", "Decimal"),
        ("NoProjectRestriction", "False"),
        ("IsEnhancedForecasting", "True"),
    ]

    # Days[0..6].Date
    for i, d in enumerate(week_days):
        fields.append((f"Days[{i}].Date", str(to_excel_serial(d))))

    # EmptyRow
    fields += [
        ("EmptyRow.PinID", "-1"),
        ("EmptyRow.Task.ResourceCode", resource_code),
    ]
    for i in range(7):
        fields.append((f"EmptyRow.Days[{i}].IsDirty", "False"))

    # Card.Rows[0] — main/OoO row
    is_work_day = [day_flags.get(day_names[i], "Y") == "Y" for i in range(5)]

    # Use main project (all Y days)
    fields += [
        ("Card.Rows[0].Project.Id", project_id),
        ("Card.Rows[0].Project.Description", project_description),
        ("Card.Rows[0].Activity.Id", activity_id),
        ("Card.Rows[0].Activity.Description", activity_description),
        ("Card.Rows[0].Task.Id", task_id),
        ("Card.Rows[0].Task.Description", task_description),
        ("Card.Rows[0].Task.ResourceCode", resource_code),
        ("Card.Rows[0].ProjectIsChargeable", "true"),
        ("Card.Rows[0].TrackAgainstTasks", "True"),
    ]

    for i in range(7):
        if i < 5 and is_work_day[i]:
            hours = str(hours_per_day)
        else:
            hours = ""
        fields.append((f"Card.Rows[0].Days[{i}].HoursFormatted", hours))
        fields.append((f"Card.Rows[0].Days[{i}].IsDirty", "True"))

    return urlencode(fields)
