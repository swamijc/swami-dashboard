# Swami's Portfolio Dashboard

Enterprise dashboard for timesheet automation, team time tracking, approvals, reporting, and future portfolio operations.

## Documentation Rule

Update this README whenever the application behavior, requirements, configuration, architecture, API integration, startup process, validation result, security posture, or user-facing workflow changes. Keep the latest validated commands and known caveats current.

## Local URLs

- Frontend: http://localhost:5173
- API Gateway: http://localhost:3001/api/health
- Photon Timesheet Service: http://localhost:8011/health
- Boots KI Service: http://localhost:8012/health
- Time Tracking Service: http://localhost:8013/health

Default local login:

- Username: `admin`
- Password: `Admin@1234!`

Admins can add more dashboard users from Admin -> Users. Use role `viewer` for report-only and workflow-status access.

## Start The Application

```bash
cd "/Users/swaminathan.kannaiyan/Documents/Swami Dashboard"
bash ./start.sh
```

The startup script is clone-friendly: if `.env` is missing, it creates one from `.env.example`, installs missing Node/Python dependencies, builds the backend, cleans ports `3001`, `8011`, `8012`, `8013`, and `5173`, starts all services, and runs health checks.

Live values such as JIRA tokens and Photon/Boots cookies are intentionally not committed. Add those to the local `.env` or GitHub environment secrets after cloning.

## CI/CD Readiness

The project is prepared for CI/CD with GitHub Actions and Docker Compose.

CI/CD workflow:

- File: `.github/workflows/ci.yml`
- Triggers: push to `main`, pull request to `main`, and manual `workflow_dispatch`.
- Promotion order is gated: `DEV` -> `QA` -> `PROD`.
- `DEV` runs first and must pass before `QA` starts.
- `QA` runs only after `DEV` passes and must pass before `PROD` can start.
- `PROD` is skipped for pull requests and runs only after `QA` passes.
- `PROD` uses the GitHub Environment named `prod`; configure that environment in GitHub with required reviewers to enforce manual approval before production execution.
- `DEV` and `QA` also use GitHub Environments named `dev` and `qa`, so environment-specific secrets and variables can be managed separately.
- Uses Node.js `24` because the backend depends on Node built-in SQLite through `node:sqlite`.
- Uses Python `3.12` for all FastAPI microservices.
- Installs backend/frontend dependencies with `npm ci`.
- Installs Python service dependencies and compiles all Python service modules.
- Builds backend TypeScript and frontend production assets.
- Generates `frontend/public/release-report.json` for the dashboard Release Tracking page before each frontend build.
- Runs backend unit/route/security/access-control tests with coverage.
- Runs Playwright E2E and axe accessibility tests.
- Runs backend and frontend production dependency audits.
- Builds all Docker images with `docker compose build`.

Shared stage script:

- File: `scripts/ci-stage.sh`
- Each environment stage calls the same script with the stage name: `dev`, `qa`, or `prod`.
- The script generates release tracking metadata, then runs build, tests, coverage, E2E/accessibility, production audits, Python compile checks, and Docker image build.
- For local validation on machines without Docker, use `SKIP_DOCKER=1`.
- For local validation when Playwright Chromium is already installed, use `SKIP_PLAYWRIGHT_INSTALL=1`.

Manual approval setup for production:

1. In GitHub, open the repository settings.
2. Go to Environments.
3. Create or open the environment named `prod`.
4. Add required reviewers.
5. Keep production secrets under the `prod` environment, not in source code.

With that setup, the workflow runs DEV first, then QA, then waits for approval before PROD.

E2E tests are CI-compatible: `frontend/playwright.config.ts` starts the backend and frontend automatically when they are not already running, and reuses existing local servers during development.

Container deployment shape:

- `docker-compose.yml` builds five services: backend, frontend, Photon, Boots KI, and Time Tracking.
- Backend container uses Node `24-alpine` and starts with `node --experimental-sqlite dist/index.js`.
- Frontend container builds Vite output and serves it with Nginx.
- Nginx proxies `/api/*` to the backend container.
- Python service containers expose the same ports used by local development: `8011`, `8012`, and `8013`.
- Backend container service URLs point to Compose DNS names: `photon`, `boots-ki`, and `time-tracking`.
- Compose health checks are configured for all runtime services.

Deployment command when Docker is available:

```bash
cd "/Users/swaminathan.kannaiyan/Documents/Swami Dashboard"
docker compose up --build -d
```

Required deployment secret/config values can be supplied as CI/CD repository secrets, runner environment variables, or a local `.env` file used by Docker Compose interpolation:

- `SESSION_SECRET`: long random value, minimum 32 characters recommended.
- `ENCRYPTION_KEY`: exactly 32 characters.
- `JIRA_API_TOKEN_ID`: required for live JIRA reports.
- `RELEASE_DEV_URL`, `RELEASE_QA_URL`, `RELEASE_PROD_URL`: dashboard URLs shown on the Release page for environment validation.
- Photon/Boots session cookies remain local operational secrets and must not be committed.

Local note: Docker is not currently available in this terminal, so Docker image execution could not be validated here. The Compose file and Dockerfiles are configured for CI/CD runners that provide Docker.

Latest local CI/CD readiness validation:

- Backend tests: `15 passed`
- Frontend E2E/accessibility tests: `4 passed`
- Release report generation and admin approval flow: `passed`, showing release version, environment push details, and admin-only QA/PROD promotion
- Environment test URL display: `passed`, showing DEV link and clear not-configured status for QA/PROD until real URLs are set
- Python service compile check: `passed`
- Backend production dependency audit: `0` vulnerabilities
- Frontend production dependency audit: `0` vulnerabilities
- Quality report: `100%`, `passed`, `11` categories, `0` failed checks
- Docker Compose syntax and image builds: configured, but local execution was blocked because Docker is not installed in this terminal.

## Architecture

- Frontend: React, TypeScript, Vite, Tailwind CSS, Recharts.
- Theme: Photon-inspired white/black/electric-blue palette with light/dark mode using a persisted dashboard toggle and Tailwind class-based dark mode.
- API Gateway: Node.js, Express, TypeScript.
- Database: SQLite using Node built-in `node:sqlite`.
- Sensitive config/session values: AES-256-CBC encrypted before storage.
- Microservices: Python FastAPI services for Photon, Boots KI, and Time Tracking.
- Quality reporting: Vitest backend tests with coverage plus Playwright, accessibility, regression, API contract, load, security, secrets, license, and dependency audit checks in a generated dashboard report.
- Release tracking: generated release metadata for release version number, current stage, DEV/QA/PROD gate status, and per-environment push details.

## Services

### Backend API Gateway

Path: `backend/`

Responsibilities:

- Authentication and session management.
- Admin configuration and encrypted token storage.
- Admin-managed dashboard user creation.
- Timesheet gateway routes.
- Time Tracking gateway routes.
- Job scheduling and audit history.

Key routes:

- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/admin/configs`
- `PUT /api/admin/configs/:service_name`
- `GET /api/tracking/session-status`
- `POST /api/tracking/report`
- `GET /api/jira/report`
- `POST /api/jira/report`
- `GET /api/release/report`
- `POST /api/release/promote` admin-only

### Photon Timesheet Service

Path: `services/photon/`

Supports:

- Swami Photon timesheet entry.
- Prasanna/PV Photon entry.
- Photon approval POST scaffold.
- Timesheet page status summary for Swami and Prasanna over the selected week.
- Dashboard-side submission run status for the current week or prior weeks up to one month.
- Approval schedule execution summary for both daily approval intervals.

Pending:
 `RELEASE_DEV_URL`, `RELEASE_QA_URL`, `RELEASE_PROD_URL`: dashboard URLs shown on the Release page for environment validation.

## Photon Timesheet UI Behavior

The Timesheet -> Photon section includes:

- Photon and Boots subsection tabs use logo images from their official domains, with text labels kept for readability.
- Week selector for checking current week or previous weeks up to one month.
- Status cards for `Swami's Timesheet Entry` and `Prasanna's Timesheet Entry`.
- Dashboard-side inferred submission status from local `job_runs` for the selected week.
 Environment test URL display: `passed`, showing DEV, QA, and PROD dashboard links on the Release page
	- Daily 1:45 PM IST.
	- Daily 8:00 PM IST.
- For each approval interval, the UI shows configured/enabled state, cron expression, last run, last status, and whether it succeeded today.

Important limitation: the app can currently show whether this dashboard submitted a timesheet job successfully. It cannot yet confirm true Photon approval/saved/submitted state until the Photon status/read endpoint and payload are provided.

## Theme Behavior
 Added Environment Test URLs on the Release dashboard so DEV, QA, and PROD each show the dashboard URL to validate.

- Dashboard, Time Tracking, JIRA, Onboarding, Quality, and Release appear in the sidebar.
- Time Tracking is locked to the current Monday-Sunday week.
- JIRA Query and JIRA Due Date are visible, but JQL is read-only and custom Execute/Reset actions are hidden.
- Backend JIRA requests from viewers ignore supplied JQL and always run the default open-sprint JQL.
- Onboarding is visible for workflow status review only. Viewers cannot add records, apply pasted details, remove records, or toggle workflow steps.
- Quality is visible as a report-only dashboard.
- Release is visible as a report-only dashboard with release version and environment push tracking. Viewers cannot approve QA or PROD promotion.
 Environment dashboard URLs are controlled by:

- `RELEASE_DEV_URL`, default `http://localhost:5173`.
- `RELEASE_QA_URL`, no default. The dashboard shows `QA URL not configured` until the real QA URL is set.
- `RELEASE_PROD_URL`, no default. The dashboard shows `PROD URL not configured` until the real production URL is set.

 Set these as GitHub environment variables or local `.env` values so the Release dashboard shows the exact URLs testers should open for each environment.
- Session-token setup text tells viewers to contact an admin instead of opening Admin.
- Job run history and schedule APIs require admin access.

## Onboarding Module

The Onboarding module is available from the sidebar and dashboard. Admins can manage local onboarding/offboarding records. Viewers can open the page to inspect workflow status only.

Sections:

- Photon onboarding and offboarding.
- Boots onboarding and offboarding.

Photon onboarding supports a project dropdown with:

- `12667 - Mobile App'23`
- `13755 - Mobile App Condor Squad`

Developer fields:

- Employee ID
- Name
- Email ID
- Location
- Role
- Start date

For admins, the page includes a paste helper for rows in the format `emp id, name, email, location, role, start date`. Workflow buttons toggle each onboarding/offboarding step between pending and done. Current records are stored in browser local storage under `swami-onboarding-pipelines` until a backend persistence workflow is added. Viewers do not see the add form and cannot change local workflow state.

Photon onboarding workflow:

- ODC completion
- Compliance certificate completed
- Compliance team approved the eRoom JIRA
- System wipeout
- Enter into ODC

Boots onboarding workflow:

- DWP request raised
- Approved by Laura
- Approved by Fleur
- Team confirmed by pinging from Boots ID in MS Teams
- VDI request raised
- KeyedIn raised
- JIRA access raised
- ADO access raised
- Manager added the resource under the appropriate group in MS Teams

Photon offboarding workflow:

- eRoom ticket raised and approved

Boots offboarding workflow:

- Leaver request raised and approved

## JIRA Module

The JIRA module is available from the sidebar and dashboard. It has two pages: JIRA Query at `/jira` and JIRA Due Date at `/jira/due-date`. Both call the backend API gateway at `/api/jira/report`, which then queries Boots Atlassian `/rest/api/3/search/jql` from the server so JIRA credentials are not exposed in frontend code.

Configuration:

- `JIRA_BASE_URL=https://bootsuk.atlassian.net`
- `JIRA_USER_EMAIL=swami.k@ext.boots.com`
- `JIRA_API_TOKEN_ID`
- `JIRA_STORY_POINTS_FIELD=customfield_10036`
- `JIRA_TEAM_FIELD=customfield_10001`

For admins, the default JQL is editable from the JIRA page and the Execute button pulls a fresh live report from Boots JIRA. For viewers, JQL is read-only, Execute/Reset actions are hidden, and the backend enforces the default JQL even if a viewer submits a custom request:

```text
project = "Mobile App " AND "Team[Team]" in (5af5b4ff-5e77-47ba-869d-ceb6207cb297,6e469218-134d-486f-9d5b-0b0f34d16734) AND Sprint in openSprints() AND worktype in (Story, Bug)
```

The page shows:

- Story/Bug split by resource.
- Resource-wise Story/Bug Split shows five rows at a time with a scroll bar for the remaining resources.
- Story/Bug split by team.
- AOS/iOS counts by resource from Jira labels.
- AOS/iOS counts by team from Jira labels.
- Story point totals by resource.
- Story point totals by team.
- Story point issue table sorted by resource name, then story points.
- Separate JIRA Due Date page at `/jira/due-date` using Ready for Progressive SIT date, Due date, and sprint start to show developer completion trends.
- The Due Date page shows the first five developers by default and includes a User dropdown to focus one developer.
- The Due Date page includes a pie chart for story completion buckets and missing Ready for Progressive SIT date reports by developer and issue.
- Filter by team, updated date range, status, resource/name, issue key, or summary.
- Resource, team, issue, and chart sections reflect the selected filters.
- Click a resource name to jump to the Story Point Sorted Issues table filtered to that developer.
- Pie chart modes for Story/Bug, AOS/iOS, and Status distribution.

If Atlassian rejects the token or the JIRA configuration is missing, the UI shows `login to Boots JIRA using browser` and provides an Open Boots JIRA button. Browser session cookies from `bootsuk.atlassian.net` cannot be read by this local dashboard due browser origin isolation, so the backend token is still the reliable automation path.

### Boots KI Service

Path: `services/boots-ki/`

Supports:

- Swami KI timesheet submission.
- PV KI timesheet submission.
- Excel/OLE date serial conversion.
- Form-encoded `SaveTimeEntry` payloads.

Pending:

- Boots KI report payload/API details.
- Holiday/OoO project and activity IDs.

### Time Tracking Service

Path: `services/time-tracking/`

Supports Photon Track team reporting:

- Reads all reportees from `GET https://photontrack.photon.com/photontrack/reportees`.
- Batches reportee employee codes into `POST /photontrack/getReporteesAccess` calls.
- Builds weekly bucket summary.
- Builds day-wise team averages.
- Highlights daily entries below 6 hours.
- Shows all resources in Individual Breakdown.
- Maps employee IDs to Photon Track reportee names.

Hour buckets:

- `<40`
- `40-41`
- `41-42`
- `42-43`
- `43-45`
- `45-50`
- `50+`

Targets:

- Weekly target: `40` hours.
- Daily target: `8` hours.
- Daily alert threshold: below `6` hours.

## Time Tracking UI Behavior

The Time Tracking module includes:

- Week selector using Monday-Sunday ranges.
- Weekly hours distribution pie chart.
- Clickable pie segments to view resources in each bucket.
- Team daily average table.
- Individual Breakdown table.
- Resource filter by name, ID, or bucket.
- Sort by Total column ascending/descending.
- Scrollable resource table when more than 10 resources are displayed.
- Name column shows one combined value such as `Akshay Kumar - 144957` and does not repeat the ID on a second line.

## Code Quality Dashboard

Admins and viewers can open `/quality` from the sidebar to view the latest generated code quality report. The page reads `frontend/public/quality-report.json` and shows:

- Frontend and backend build status.
- Backend unit/regression tests and coverage.
- Playwright E2E UI regression and axe accessibility checks.
- Regression smoke checks for the frontend route and backend health route.
- API contract checks for important response shapes.
- Local API load test result for `/api/health`.
- Security baseline checks for Helmet headers, anonymous admin API rejection, and invalid login rejection.
- Local source secrets scan.
- Static security scan for unsafe frontend/backend patterns.
- License compliance scan for blocked GPL-family licenses.
- Production and full dependency audit summaries.

Generate or refresh the report with:

```bash
cd "/Users/swaminathan.kannaiyan/Documents/Swami Dashboard"
node scripts/quality-report.mjs
```

Current latest report summary:

- Quality score: `100%`
- Overall status: `passed`
- Backend tests: `15 passed`
- Playwright E2E/accessibility tests: `4 passed`
- Backend line coverage: `39.41%`
- Load test: `100` requests, concurrency `10`, `0` failures, p95 `5 ms`
- Expanded report categories: `11`, with `0` failed checks
- Production and full dependency audits: `0` vulnerabilities after removing unused backend `uuid`, upgrading backend `node-cron`, and upgrading frontend Vite tooling.

## Release Tracking Dashboard

Admins and viewers can open `/release` from the sidebar to track release promotion details. The page reads `/api/release/report`, which merges the generated `frontend/public/release-report.json` baseline with SQLite-stored admin approvals.

The Release page shows:

- Release version number.
- Current release stage: `DEV`, `QA`, or `PROD`.
- Overall release status, including in-progress, awaiting production approval, and released states.
- DEV, QA, and PROD promotion cards with each environment gate.
- Admin-only approval buttons: `Approve Move to QA` and `Approve Move to PROD`.
- Server-side enforcement through `/api/release/promote`, protected by admin role checks.
- Environment Test URLs cards for DEV, QA, and PROD with clickable dashboard links.
- Environment Push Details table with environment, status, release version, pushed time, pushed by, branch, commit, and workflow run.
- Build metadata including branch, commit, workflow, run number, run ID, and actor.

Promotion rules:

- Viewers can see release and environment details only.
- Admins can approve move to QA after DEV is passed.
- Admins can approve move to PROD only after QA has been approved.
- Each approval is stored in SQLite with release version, approving user, approval time, branch, commit, and workflow run.

Generate or refresh the release report locally with:

```bash
cd "/Users/swaminathan.kannaiyan/Documents/Swami Dashboard"
node scripts/release-report.mjs dev
```

In CI/CD, `scripts/ci-stage.sh` calls the same generator with the active stage name before the frontend build, so the dashboard artifact displays the promotion state for that stage.

Environment dashboard URLs are controlled by:

- `RELEASE_DEV_URL`, default `http://localhost:5173`.
- `RELEASE_QA_URL`, default `https://qa.swami-dashboard.example.com` until the real QA URL is configured.
- `RELEASE_PROD_URL`, default `https://swami-dashboard.example.com` until the real production URL is configured.

Set these as GitHub environment variables or local `.env` values so the Release dashboard shows the exact URLs testers should open for each environment.

## Photon Track Session Setup

Photon Track uses a separate session from Photon Timetracker. The dashboard cannot read browser cookies directly from `photontrack.photon.com`, so the user must provide the request Cookie header.

Recommended flow:

1. Open `https://photontrack.photon.com/photontrack/#/manager` in the browser.
2. Open DevTools and inspect the `reportees` or `getReporteesAccess` request.
3. Copy the full `Cookie:` request header value.
4. In the dashboard, go to Admin -> Session Tokens.
5. Open `Photon Track - Team Time Tracking`.
6. Paste the full Cookie header.
7. Click Save & Encrypt.
8. Open Time Tracking and click Refresh Report.

The Cookie header should include:

- `myCookie=...`
- `_shibsession_...=...` for `photontrack.photon.com`
- Supporting cookies such as `visid_incap_...` when present.

Do not share session cookies outside the local machine. Treat them like passwords.

## Timeout And Deadlock Protection

Time Tracking fetches many Photon Track batches for all reportees. The fetch path is guarded to avoid hanging indefinitely:

- `PHOTONTRACK_REQUEST_TIMEOUT_SECONDS=15`
- `PHOTONTRACK_BATCH_TIMEOUT_SECONDS=20`
- `PHOTONTRACK_REPORT_TIMEOUT_SECONDS=120`
- `TRACKING_REPORTEES_TIMEOUT_MS=45000`
- `TRACKING_REPORT_TIMEOUT_MS=150000`
- Max concurrent Photon batches: `5`

If one Photon batch stalls, the service logs the timeout, cancels pending work if needed, and returns available partial data rather than deadlocking.

## Environment

Important `.env` values:

```text
NODE_ENV=development
PORT=3001
FRONTEND_URL=http://localhost:5173
RELEASE_DEV_URL=http://localhost:5173
RELEASE_QA_URL=
RELEASE_PROD_URL=
PHOTON_SERVICE_URL=http://localhost:8011
BOOTS_KI_SERVICE_URL=http://localhost:8012
TRACKING_SERVICE_URL=http://localhost:8013
PHOTONTRACK_VERIFY_SSL=false
PHOTONTRACK_REQUEST_TIMEOUT_SECONDS=15
PHOTONTRACK_BATCH_TIMEOUT_SECONDS=20
PHOTONTRACK_REPORT_TIMEOUT_SECONDS=120
TRACKING_REPORTEES_TIMEOUT_MS=45000
TRACKING_REPORT_TIMEOUT_MS=150000
```

`ENCRYPTION_KEY` must be exactly 32 characters. It is used for local encryption of session/config values.

## Validation Commands

Backend build:

```bash
cd "/Users/swaminathan.kannaiyan/Documents/Swami Dashboard/backend"
npm run build
```

Backend tests and coverage:

```bash
cd "/Users/swaminathan.kannaiyan/Documents/Swami Dashboard/backend"
npm run test:coverage
```

Full quality report generation:

```bash
cd "/Users/swaminathan.kannaiyan/Documents/Swami Dashboard"
node scripts/quality-report.mjs
```

Release tracking report generation:

```bash
cd "/Users/swaminathan.kannaiyan/Documents/Swami Dashboard"
node scripts/release-report.mjs dev
```

CI-equivalent local checks without Docker:

```bash
cd "/Users/swaminathan.kannaiyan/Documents/Swami Dashboard"
python3 -m compileall services/photon services/boots-ki services/time-tracking
cd backend && npm test && npm audit --omit=dev
cd ../frontend && npm run build && npm run test:e2e && npm audit --omit=dev
```

Run the shared DEV stage locally without Docker:

```bash
cd "/Users/swaminathan.kannaiyan/Documents/Swami Dashboard"
SKIP_DOCKER=1 SKIP_PLAYWRIGHT_INSTALL=1 bash scripts/ci-stage.sh dev
```

Frontend build:

```bash
cd "/Users/swaminathan.kannaiyan/Documents/Swami Dashboard/frontend"
npm run build
```

Frontend E2E/accessibility tests:

```bash
cd "/Users/swaminathan.kannaiyan/Documents/Swami Dashboard/frontend"
npm run test:e2e
```

Python syntax validation:

```bash
cd "/Users/swaminathan.kannaiyan/Documents/Swami Dashboard"
python3 -m py_compile services/time-tracking/analytics.py services/time-tracking/tracker.py services/time-tracking/main.py
```

Live Time Tracking validation example:

```bash
cd "/Users/swaminathan.kannaiyan/Documents/Swami Dashboard"
bash ./start.sh
```

Expected healthy startup output includes all of the following:

- `Photon  OK photon-timesheet`
- `Boots   OK boots-ki-timesheet`
- `Tracker OK time-tracking`
- `Backend OK swami-dashboard-gateway`
- `Frontend OK HTTP 200`

## Recent Change Log

### 2026-07-11

- Prepared the project for GitHub upload with a safe `.gitignore` and clone-friendly startup behavior that creates local `.env` from `.env.example`, installs dependencies, builds the backend, and starts all services.
- Added the Release Tracking dashboard at `/release`, including release version number, DEV/QA/PROD promotion cards, environment push details, and generated CI/CD release metadata.
- Added admin-only Release approval buttons for moving from DEV to QA and QA to PROD, with server-side role enforcement, SQLite approval history, and viewer-only environment detail access.
- Added Environment Test URLs on the Release dashboard so DEV, QA, and PROD each show the dashboard URL to validate.
- Renamed application from Swami's Program Dashboard to Swami's Portfolio Dashboard.
- Added full Photon Track Cookie header storage and forwarding.
- Fixed local encryption key length and `.env` loading in `start.sh`.
- Added Photon Track SSL verification toggle for local corporate TLS behavior.
- Switched Time Tracking from 9 hardcoded employees to all Photon Track reportees.
- Added reportee name mapping so IDs display as names, for example `Akshay Kumar - 144957`.
- Added filter, sortable Total column, and scrollable Individual Breakdown table.
- Removed duplicate second-line employee ID from the Name column.
- Added no-deadlock timeout hardening for Photon Track report fetches.
- Added Photon Timesheet weekly status summary and approval auto-run interval execution summary.
- Changed Timesheet subsection tabs from emoji labels to official-domain logo images for Photon and Boots, while keeping readable text labels.
- Renamed the Timesheet subsection button label from `Boots KI` to `Boots`; internal Boots KI module/service names remain unchanged.
- Added a persisted light/dark mode toggle in the dashboard header.
- Changed the sidebar brand mark to use the Photon icon beside `SPD`.
- Updated the shared dashboard theme to follow Photon-inspired white/black/electric-blue styling from `https://photon.com/`.
- Stored the Photon icon locally under `frontend/src/assets/icons/photon.png` and use it before `SPD` plus in the Photon Timesheet tab.
- Future Photon logo usage should import and reuse `frontend/src/assets/icons/photon.png` instead of linking directly to `photon.com`.
- The browser tab favicon also uses the same local Photon icon asset.
- Added Admin -> Users form for creating dashboard users and locked viewer access to current-week Time Tracking reports only.
- Adjusted dark-mode surface handling so the main content canvas, striped table rows, and hover states render as gray instead of staying light.
- Enabled the Onboarding module with Photon/Boots tabs, onboarding/offboarding workflows, project selection, paste-friendly developer fields, and workflow step tracking.
- Enabled the JIRA module with a backend Atlassian proxy, Boots Mobile App open-sprint JQL, Story/Bug split, resource-wise story point totals, and issue filtering.
- Added a Code Quality dashboard at `/quality`, backend Vitest coverage tests, route/security regression tests, local load/security checks, dependency audit reporting, and a generated `quality-report.json` consumed by the UI.
- Upgraded backend `node-cron` to `4.6.0` and removed unused `uuid` so production dependency audits report zero vulnerabilities.
- Upgraded frontend Vite tooling to clear the Vite/esbuild full dependency audit advisories; latest Quality report is `passed` with score `100%`.
- Expanded the Quality report with Playwright E2E UI checks, axe accessibility checks, API contract checks, source secrets scan, static security scan, and license compliance reporting. Fixed Quality/sidebar contrast issues found by axe.
- Opened JIRA, Onboarding, and Quality pages for viewer users in read-only mode. Viewers can filter/report from JIRA default data and inspect onboarding workflow status, but cannot edit JQL, execute custom JQL, add/remove onboarding records, or toggle workflow steps.
- Updated README requirements and role/module documentation to keep the Markdown source of truth aligned with the latest viewer read-only access, quality reporting scope, and validation commands.
- Added CI/CD readiness: GitHub Actions workflow, frontend and Time Tracking Dockerfiles, Nginx frontend API proxy, Docker Compose health checks, Node 24 backend container support for built-in SQLite, aligned Python service ports, and CI-compatible Playwright web server startup.
- Final CI/CD readiness validation kept the Quality dashboard at `100%` passed with `0` failed checks; Docker execution remains pending on a runner or machine with Docker installed.
- Changed CI/CD to a gated environment promotion flow: DEV executes first, QA runs only after DEV passes, and PROD runs only after QA passes plus manual approval through the GitHub `prod` environment.
- Validated live report with `64` employees, `7` buckets, and `7` day rows.

## Known Caveats

- Photon Track cookies expire and must be refreshed from the browser when live reports stop working.
- Historical old-name strings may remain in log files, but source and active build output use Swami's Portfolio Dashboard.
- Photon approval automation still needs the pending-approval fetch endpoint before production-safe automatic approvals.
- Photon Timesheet true Approved/Saved/Submitted status still needs the Photon status/read endpoint. Until then, the Timesheet page shows local dashboard submission execution status and a not-configured warning for Photon status lookup.
- No application can be guaranteed impossible to hack. The Quality dashboard provides measurable controls and current baseline checks, but full penetration testing should include authenticated workflow testing, secrets review, rate limiting, CSRF review, and deployment-environment hardening before internet exposure.