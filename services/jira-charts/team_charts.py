#!/usr/bin/env python3
import html
import json
import math
import re
import sys
from collections import Counter, defaultdict
from datetime import date


PALETTE = ["#005eb8", "#0f766e", "#f59e0b", "#dc2626", "#7c3aed", "#475569", "#0891b2"]
DONE_STATUSES = {"done", "closed", "resolved", "complete", "completed", "released"}
NON_PERSON_LABELS = {"aos", "ios", "android", "uk", "roi"}


def esc(value):
    return html.escape(str(value or ""), quote=True)


def svg_wrap(width, height, body):
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" '
        f'role="img" width="100%" height="100%">'
        f'<rect width="{width}" height="{height}" rx="12" fill="#ffffff"/>'
        f'{body}</svg>'
    )


def title(text, subtitle=None):
    subtitle_svg = f'<text x="24" y="48" font-size="12" fill="#64748b">{esc(subtitle)}</text>' if subtitle else ""
    return f'<text x="24" y="28" font-size="17" font-weight="700" fill="#0f172a">{esc(text)}</text>{subtitle_svg}'


def donut_chart(title_text, counts, subtitle=None, center_label="issues"):
    counts = [(name, value) for name, value in counts if value > 0]
    width, height = 520, 300
    if not counts:
        return svg_wrap(width, height, title(title_text, subtitle) + '<text x="24" y="150" font-size="14" fill="#64748b">No data</text>')

    total = sum(value for _, value in counts)
    cx, cy, radius = 150, 160, 82
    start = -math.pi / 2
    pieces = [title(title_text, subtitle)]

    for idx, (name, value) in enumerate(counts):
        angle = (value / total) * math.tau
        end = start + angle
        x1, y1 = cx + radius * math.cos(start), cy + radius * math.sin(start)
        x2, y2 = cx + radius * math.cos(end), cy + radius * math.sin(end)
        large = 1 if angle > math.pi else 0
        color = PALETTE[idx % len(PALETTE)]
        pct = round(value / total * 100)
        pieces.append(
            f'<path d="M {cx} {cy} L {x1:.2f} {y1:.2f} A {radius} {radius} 0 {large} 1 {x2:.2f} {y2:.2f} Z" fill="{color}">'
            f'<title>{esc(name)}: {value:g} {esc(center_label)} ({pct}%)</title>'
            f'</path>'
        )
        start = end

    pieces.append(f'<circle cx="{cx}" cy="{cy}" r="44" fill="#ffffff"/>')
    pieces.append(f'<text x="{cx}" y="{cy - 3}" text-anchor="middle" font-size="24" font-weight="700" fill="#0f172a">{total:g}</text>')
    pieces.append(f'<text x="{cx}" y="{cy + 17}" text-anchor="middle" font-size="11" fill="#64748b">{esc(center_label)}</text>')

    legend_x, legend_y = 290, 92
    for idx, (name, value) in enumerate(counts):
        y = legend_y + idx * 30
        pct = round(value / total * 100)
        color = PALETTE[idx % len(PALETTE)]
        pieces.append(f'<rect x="{legend_x}" y="{y - 10}" width="12" height="12" rx="3" fill="{color}"/>')
        pieces.append(f'<text x="{legend_x + 20}" y="{y}" font-size="13" fill="#334155">{esc(name)}</text>')
        pieces.append(f'<text x="{width - 28}" y="{y}" text-anchor="end" font-size="13" font-weight="700" fill="#0f172a">{value} ({pct}%)</text>')

    return svg_wrap(width, height, "".join(pieces))


def bar_chart(title_text, rows, value_label="", subtitle=None, max_rows=10):
    rows = [(name, value) for name, value in rows if value > 0][:max_rows]
    width, height = 640, max(260, 92 + len(rows) * 38)
    if not rows:
        return svg_wrap(width, height, title(title_text, subtitle) + '<text x="24" y="150" font-size="14" fill="#64748b">No data</text>')

    max_value = max(value for _, value in rows) or 1
    pieces = [title(title_text, subtitle)]
    label_w, chart_x, chart_w = 190, 220, 360
    for idx, (name, value) in enumerate(rows):
        y = 82 + idx * 38
        bar_w = max(4, value / max_value * chart_w)
        color = PALETTE[idx % len(PALETTE)]
        pieces.append(f'<text x="24" y="{y + 16}" font-size="12" fill="#334155">{esc(name)[:32]}</text>')
        pieces.append(f'<rect x="{chart_x}" y="{y}" width="{bar_w:.1f}" height="20" rx="5" fill="{color}"/>')
        pieces.append(f'<text x="{chart_x + bar_w + 8}" y="{y + 15}" font-size="12" font-weight="700" fill="#0f172a">{value:g}{esc(value_label)}</text>')
    pieces.append(f'<line x1="{label_w}" y1="66" x2="{label_w}" y2="{height - 24}" stroke="#e2e8f0"/>')
    return svg_wrap(width, height, "".join(pieces))


def issue_type(issue):
    return (issue.get("type") or "Unknown").strip() or "Unknown"


def is_overdue(issue):
    due = issue.get("due_date") or issue.get("ready_progressive_sit_date")
    if not due:
        return False
    status = (issue.get("status") or "").lower()
    if status in DONE_STATUSES:
        return False
    try:
        return date.fromisoformat(due[:10]) < date.today()
    except ValueError:
        return False


def person_from_labels(labels):
    for label in labels or []:
        value = str(label or "").strip()
        normalized = value.lower()
        if not value or normalized in NON_PERSON_LABELS:
            continue
        if re.fullmatch(r"pi\d+", normalized):
            continue
        if re.search(r"[\d_]", value):
            continue
        return value
    return "Unknown User"


def main():
    payload = json.load(sys.stdin)
    report = payload.get("report") or payload
    issues = report.get("issues") or []
    subtitle = f'{report.get("total_issues", len(issues))} issues · {report.get("total_story_points", 0)} story points'

    type_counts = Counter(issue_type(issue) for issue in issues)
    status_counts = Counter((issue.get("status") or "Unknown") for issue in issues)
    team_issue_counts = Counter((issue.get("team") or "Unassigned") for issue in issues)

    team_points = defaultdict(float)
    assignee_points = defaultdict(float)
    assignee_overdue = Counter()
    assignee_overdue_stories = Counter()
    for issue in issues:
        story_points = float(issue.get("story_points") or 0)
        team_points[issue.get("team") or "Unassigned"] += float(issue.get("story_points") or 0)
        assignee_points[person_from_labels(issue.get("labels") or [])] += story_points
        if is_overdue(issue):
            assignee = issue.get("assignee") or "Unassigned"
            assignee_overdue[assignee] += 1
            if issue_type(issue).lower() == "story":
                assignee_overdue_stories[assignee] += 1

    charts = [
        {
            "id": "issue_mix",
            "title": "Story / Bug / Defect Mix",
            "svg": donut_chart("Story / Bug / Defect Mix", [("Stories", type_counts.get("Story", 0)), ("Bugs", type_counts.get("Bug", 0)), ("Defects", type_counts.get("Defect", 0))], subtitle),
        },
        {
            "id": "team_issue_mix",
            "title": "Issue Distribution by Team",
            "svg": donut_chart("Issue Distribution by Team", team_issue_counts.most_common(7), subtitle),
        },
        {
            "id": "status_distribution",
            "title": "Status Distribution",
            "svg": donut_chart("Status Distribution", status_counts.most_common(7), subtitle),
        },
        {
            "id": "team_story_points",
            "title": "Story Points by Team",
            "svg": donut_chart("Story Points by Team", sorted(team_points.items(), key=lambda item: (-item[1], item[0])), subtitle, "story points"),
        },
        {
            "id": "overdue_assignee",
            "title": "Overdue Story/Issues Based On Assignee",
            "svg": bar_chart("Overdue Story/Issues Based On Assignee", assignee_overdue.most_common(10), "", "Due date or Progressive SIT date is before today"),
        },
        {
            "id": "overdue_story_assignee",
            "title": "Overdue Story Based On Assignee",
            "svg": bar_chart("Overdue Story Based On Assignee", assignee_overdue_stories.most_common(10), "", "Stories only"),
        },
        {
            "id": "assignee_story_points",
            "title": "Story Points Based On Assignee",
            "svg": bar_chart(
                "Story Points Based On Assignee",
                sorted(assignee_points.items(), key=lambda item: (-item[1], item[0])),
                " pts",
                f'Chart By: Labels · Sum: Story Points · Total: {report.get("total_story_points", 0)}',
            ),
        },
    ]

    print(json.dumps({
        "generated_at": date.today().isoformat(),
        "source": "python-svg",
        "charts": charts,
    }))


if __name__ == "__main__":
    main()