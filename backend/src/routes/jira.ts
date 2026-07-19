import { Router, Request, Response } from 'express';
import axios from 'axios';
import { requireAuth } from '../middleware/auth';

const router = Router();

const JIRA_BASE_URL = process.env.JIRA_BASE_URL || 'https://bootsuk.atlassian.net';
const JIRA_USER_EMAIL = process.env.JIRA_USER_EMAIL || 'swami.k@ext.boots.com';
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN_ID || '';
const JIRA_TIMEOUT_MS = Number(process.env.JIRA_TIMEOUT_MS || 30000);
const TEAM_JIRA_PAGE_ID = process.env.TEAM_JIRA_PAGE_ID || '1443430401';

const DEFAULT_JIRA_JQL = `project = "Mobile App " AND "Team[Team]" in (5af5b4ff-5e77-47ba-869d-ceb6207cb297,6e469218-134d-486f-9d5b-0b0f34d16734) AND Sprint in openSprints() AND worktype in (Story, Bug)`;
const STORY_POINTS_FIELD = process.env.JIRA_STORY_POINTS_FIELD || 'customfield_10016';
const TEAM_FIELD = process.env.JIRA_TEAM_FIELD || 'customfield_10001';
const READY_FOR_PROGRESSIVE_SIT_FIELD = process.env.JIRA_READY_FOR_PROGRESSIVE_SIT_FIELD || 'customfield_13392';
const SPRINT_FIELD = process.env.JIRA_SPRINT_FIELD || 'customfield_10020';

function authHeader(): string {
  return `Basic ${Buffer.from(`${JIRA_USER_EMAIL}:${JIRA_API_TOKEN}`).toString('base64')}`;
}

function storyPoints(fields: any): number {
  const value = fields?.[STORY_POINTS_FIELD];
  return typeof value === 'number' ? value : 0;
}

function issueType(fields: any): string {
  return fields?.issuetype?.name || fields?.worktype?.name || 'Unknown';
}

function assigneeName(fields: any): string {
  return fields?.assignee?.displayName || fields?.assignee?.emailAddress || 'Unassigned';
}

function teamInfo(fields: any): { id: string; name: string } {
  const value = fields?.[TEAM_FIELD];
  if (Array.isArray(value)) {
    const first = value[0];
    return {
      id: first?.id || first?.value || 'unassigned',
      name: first?.name || first?.title || first?.value || 'Unassigned',
    };
  }
  return {
    id: value?.id || value?.value || 'unassigned',
    name: value?.name || value?.title || value?.value || 'Unassigned',
  };
}

function platformFromLabels(labels: string[]): { aos: boolean; ios: boolean } {
  const normalized = labels.map(label => label.toLowerCase());
  return {
    aos: normalized.some(label => label.includes('aos') || label.includes('android')),
    ios: normalized.some(label => label.includes('ios')),
  };
}

function dateOnly(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  return value.slice(0, 10);
}

function sprintInfo(fields: any): { name: string; start_date: string | null; end_date: string | null } {
  const sprintValue = fields?.[SPRINT_FIELD];
  const sprint = Array.isArray(sprintValue)
    ? sprintValue.find(item => item?.state === 'active') || sprintValue[0]
    : sprintValue;
  return {
    name: sprint?.name || 'Unknown sprint',
    start_date: dateOnly(sprint?.startDate),
    end_date: dateOnly(sprint?.endDate),
  };
}

async function buildReport(jql: string) {
  const response = await axios.post(`${JIRA_BASE_URL}/rest/api/3/search/jql`, {
    jql,
    maxResults: 100,
    fields: ['summary', 'issuetype', 'assignee', 'status', 'created', 'updated', 'duedate', 'labels', STORY_POINTS_FIELD, TEAM_FIELD, READY_FOR_PROGRESSIVE_SIT_FIELD, SPRINT_FIELD],
  }, {
    timeout: JIRA_TIMEOUT_MS,
    headers: {
      Authorization: authHeader(),
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  });

  const issues = (response.data?.issues || []).map((issue: any) => {
    const fields = issue.fields || {};
    const team = teamInfo(fields);
    const labels = Array.isArray(fields.labels) ? fields.labels : [];
    const platform = platformFromLabels(labels);
    const sprint = sprintInfo(fields);
    return {
      key: issue.key,
      url: `${JIRA_BASE_URL}/browse/${issue.key}`,
      summary: fields.summary || '',
      type: issueType(fields),
      assignee: assigneeName(fields),
      team_id: team.id,
      team: team.name,
      status: fields.status?.name || 'Unknown',
      created: fields.created,
      updated: fields.updated,
      ready_progressive_sit_date: dateOnly(fields[READY_FOR_PROGRESSIVE_SIT_FIELD]),
      due_date: dateOnly(fields.duedate),
      sprint: sprint.name,
      sprint_start_date: sprint.start_date,
      sprint_end_date: sprint.end_date,
      labels,
      is_aos: platform.aos,
      is_ios: platform.ios,
      story_points: storyPoints(fields),
    };
  }).sort((left: any, right: any) => left.assignee.localeCompare(right.assignee) || right.story_points - left.story_points || left.key.localeCompare(right.key));

  const resourceMap = new Map<string, any>();
  const teamMap = new Map<string, any>();
  for (const issue of issues) {
    const current = resourceMap.get(issue.assignee) || {
      assignee: issue.assignee,
      story_count: 0,
      bug_count: 0,
      aos_count: 0,
      ios_count: 0,
      story_points: 0,
      issues: 0,
    };
    current.issues += 1;
    current.story_points += issue.story_points;
    if (issue.is_aos) current.aos_count += 1;
    if (issue.is_ios) current.ios_count += 1;
    if (issue.type.toLowerCase() === 'bug') current.bug_count += 1;
    if (issue.type.toLowerCase() === 'story') current.story_count += 1;
    resourceMap.set(issue.assignee, current);

    const team = teamMap.get(issue.team_id) || {
      team_id: issue.team_id,
      team: issue.team,
      story_count: 0,
      bug_count: 0,
      aos_count: 0,
      ios_count: 0,
      story_points: 0,
      issues: 0,
      resources: new Set<string>(),
    };
    team.issues += 1;
    team.story_points += issue.story_points;
    team.resources.add(issue.assignee);
    if (issue.is_aos) team.aos_count += 1;
    if (issue.is_ios) team.ios_count += 1;
    if (issue.type.toLowerCase() === 'bug') team.bug_count += 1;
    if (issue.type.toLowerCase() === 'story') team.story_count += 1;
    teamMap.set(issue.team_id, team);
  }

  const resources = Array.from(resourceMap.values())
    .sort((left, right) => right.story_points - left.story_points || right.issues - left.issues || left.assignee.localeCompare(right.assignee));
  const teams = Array.from(teamMap.values())
    .map(team => ({ ...team, resources: team.resources.size }))
    .sort((left, right) => right.story_points - left.story_points || right.issues - left.issues || left.team.localeCompare(right.team));

  return {
    source: JIRA_BASE_URL,
    jql,
    default_jql: DEFAULT_JIRA_JQL,
    story_points_field: STORY_POINTS_FIELD,
    team_field: TEAM_FIELD,
    ready_progressive_sit_field: READY_FOR_PROGRESSIVE_SIT_FIELD,
    sprint_field: SPRINT_FIELD,
    fetched_at: new Date().toISOString(),
    total_issues: issues.length,
    total_story_points: issues.reduce((sum: number, issue: any) => sum + issue.story_points, 0),
    teams,
    resources,
    issues,
  };
}

async function handleReport(req: Request, res: Response) {
  if (!JIRA_API_TOKEN) {
    res.status(428).json({
      auth_required: true,
      message: 'login to Boots JIRA using browser',
    });
    return;
  }

  try {
    const isViewer = (req.session as any).role === 'viewer';
    const requestedJql = !isViewer && typeof req.body?.jql === 'string' ? req.body.jql.trim() : '';
    res.json(await buildReport(requestedJql || DEFAULT_JIRA_JQL));
  } catch (error: any) {
    const status = error?.response?.status;
    if (status === 401 || status === 403) {
      res.status(status).json({
        auth_required: true,
        message: 'login to Boots JIRA using browser',
      });
      return;
    }

    res.status(500).json({
      error: error?.response?.data?.errorMessages?.join(', ') || error?.response?.data?.message || error.message,
    });
  }
}

async function handleTeamPage(_req: Request, res: Response) {
  if (!JIRA_API_TOKEN) {
    res.status(428).json({
      auth_required: true,
      message: 'login to Boots JIRA using browser',
    });
    return;
  }

  try {
    const response = await axios.get(`${JIRA_BASE_URL}/wiki/rest/api/content/${TEAM_JIRA_PAGE_ID}`, {
      params: { expand: 'body.storage,version,space' },
      timeout: JIRA_TIMEOUT_MS,
      headers: {
        Authorization: authHeader(),
        Accept: 'application/json',
      },
    });

    res.json({
      id: response.data?.id,
      title: response.data?.title || 'Story Point Tracker for All Team',
      source_url: `${JIRA_BASE_URL}/wiki/spaces/cdc/pages/${TEAM_JIRA_PAGE_ID}/Story+Point+Tracker+for+All+Team`,
      space: response.data?.space?.name || 'CDC',
      version: response.data?.version?.number || null,
      updated_at: response.data?.version?.when || null,
      html: response.data?.body?.storage?.value || '',
      fetched_at: new Date().toISOString(),
    });
  } catch (error: any) {
    const status = error?.response?.status;
    if (status === 401 || status === 403) {
      res.status(status).json({
        auth_required: true,
        message: 'login to Boots JIRA using browser',
      });
      return;
    }

    res.status(500).json({
      error: error?.response?.data?.message || error.message || 'Failed to load Team JIRA page',
    });
  }
}

router.get('/report', requireAuth, handleReport);
router.post('/report', requireAuth, handleReport);
router.get('/team-page', requireAuth, handleTeamPage);

export default router;