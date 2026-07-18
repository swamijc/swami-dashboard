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
    Matches the exact field order and names from a working browser request.
    day_flags: {'mon':'Y','tue':'Y','wed':'Y','thu':'Y','fri':'Y'}
    Y = submit hours for that day, N = skip (empty)
    """
    if day_flags is None:
        day_flags = {"mon": "Y", "tue": "Y", "wed": "Y", "thu": "Y", "fri": "Y"}

    week_days = get_week_dates(week_start)  # list of 7 date objects Mon-Sun
    week_serial = get_week_start_serial(date.fromisoformat(week_start) if week_start else None)
    day_names = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]
    day_serials = [to_excel_serial(d) for d in week_days]

    # Hours formatted as decimal string matching Photon's format (e.g. "9.00")
    hours_str = f"{hours_per_day:.2f}"

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

    # Days[0..6].Date  (Mon-Sun serial numbers)
    for i, serial in enumerate(day_serials):
        fields.append((f"Days[{i}].Date", str(serial)))

    # EmptyRow — full structure matching browser payload
    fields += [
        ("EmptyRow.PinID", "-1"),
        ("EmptyRow.Pin", "0"),
        ("EmptyRow.Delete", "False"),
        ("EmptyRow.ProjectIsChargeable", "False"),
        ("EmptyRow.Project.Id", ""),
        ("EmptyRow.Project.Description", ""),
        ("EmptyRow.Project.DisplayID", "False"),
        ("EmptyRow.Activity.Id", ""),
        ("EmptyRow.Activity.Description", ""),
        ("EmptyRow.Activity.DisplayID", "False"),
        ("EmptyRow.ActivityNonChargeable", "False"),
        ("EmptyRow.Task.ResourcesAssignedOnly", "True"),
        ("EmptyRow.Task.ResourceCode", resource_code),
        ("EmptyRow.Task.IncludeCompleted", "False"),
        ("EmptyRow.Task.ActivityCode", ""),
        ("EmptyRow.Task.Id", ""),
        ("EmptyRow.Task.Description", ""),
        ("EmptyRow.TrackAgainstTasks", "False"),
        ("EmptyRow.TrackAgainstAssignments", "False"),
    ]
    for i, serial in enumerate(day_serials):
        fields += [
            (f"EmptyRow.Days[{i}].Date", str(serial)),
            (f"EmptyRow.Days[{i}].HoursFormatted", ""),
            (f"EmptyRow.Days[{i}].Notes", ""),
            (f"EmptyRow.Days[{i}].IsDirty", "False"),
        ]

    # Card.Rows[0] — full structure matching browser payload
    fields += [
        ("Card.Rows[0].PinID", "-1"),
        ("Card.Rows[0].Pin", "0"),
        ("Card.Rows[0].Delete", "False"),
        ("Card.Rows[0].ProjectIsChargeable", "true"),
        ("Card.Rows[0].Project.Id", project_id),
        ("Card.Rows[0].Project.Description", project_description),
        ("Card.Rows[0].Project.DisplayID", "False"),
        ("Card.Rows[0].Activity.Id", activity_id),
        ("Card.Rows[0].Activity.Description", activity_description),
        ("Card.Rows[0].Activity.DisplayID", "False"),
        ("Card.Rows[0].ActivityNonChargeable", "false"),
        ("Card.Rows[0].Task.ResourcesAssignedOnly", "False"),
        ("Card.Rows[0].Task.ResourceCode", resource_code),
        ("Card.Rows[0].Task.IncludeCompleted", "False"),
        ("Card.Rows[0].Task.ActivityCode", ""),
        ("Card.Rows[0].Task.Id", task_id),
        ("Card.Rows[0].Task.Description", task_description),
        ("Card.Rows[0].TrackAgainstTasks", "True"),
        ("Card.Rows[0].TrackAgainstAssignments", "False"),
    ]
    for i, serial in enumerate(day_serials):
        # Mon-Fri (0-4): fill hours if day_flag is Y; Sat-Sun (5-6): always empty
        if i < 5 and day_flags.get(day_names[i], "Y") == "Y":
            hrs = hours_str
        else:
            hrs = ""
        fields += [
            (f"Card.Rows[0].Days[{i}].Date", str(serial)),
            (f"Card.Rows[0].Days[{i}].HoursFormatted", hrs),
            (f"Card.Rows[0].Days[{i}].Notes", ""),
            (f"Card.Rows[0].Days[{i}].IsDirty", "True"),
        ]

    return urlencode(fields)

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
