import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import api from '../api/client';
import { useAuth } from '../auth/AuthContext';

interface JiraIssue {
  key: string;
  url: string;
  summary: string;
  type: string;
  assignee: string;
  team_id: string;
  team: string;
  status: string;
  created: string;
  updated: string;
  ready_progressive_sit_date: string | null;
  due_date: string | null;
  sprint: string;
  sprint_start_date: string | null;
  sprint_end_date: string | null;
  labels: string[];
  is_aos: boolean;
  is_ios: boolean;
  story_points: number;
}

interface JiraTeam {
  team_id: string;
  team: string;
  story_count: number;
  bug_count: number;
  aos_count: number;
  ios_count: number;
  story_points: number;
  issues: number;
  resources: number;
}

interface JiraResource {
  assignee: string;
  story_count: number;
  bug_count: number;
  aos_count: number;
  ios_count: number;
  story_points: number;
  issues: number;
}

interface JiraReport {
  source: string;
  jql: string;
  default_jql: string;
  fetched_at: string;
  total_issues: number;
  total_story_points: number;
  teams: JiraTeam[];
  resources: JiraResource[];
  issues: JiraIssue[];
}

interface TeamJiraPage {
  title: string;
  source_url: string;
  space: string;
  version: number | null;
  updated_at: string | null;
  html: string;
  fetched_at: string;
}

interface TeamJiraChart {
  id: string;
  title: string;
  svg: string;
}

interface TeamJiraCharts {
  source: string;
  generated_at: string;
  fetched_at: string;
  total_issues: number;
  total_story_points: number;
  charts: TeamJiraChart[];
}

function sanitizeConfluenceHtml(html: string) {
  const doc = new DOMParser().parseFromString(html || '', 'text/html');
  doc.querySelectorAll('script, style, iframe, object, embed, link, meta').forEach(node => node.remove());
  doc.body.querySelectorAll('*').forEach(element => {
    [...element.attributes].forEach(attr => {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith('on') || value.startsWith('javascript:')) element.removeAttribute(attr.name);
    });
  });
  return doc.body.innerHTML;
}

function needsCustomChartsExport(html?: string) {
  return /Exporting Custom Jira Charts on Confluence Cloud requires User Impersonation/i.test(html || '');
}

export default function Jira() {
  const { user } = useAuth();
  const isViewer = user?.role === 'viewer';
  const [report, setReport] = useState<JiraReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [alert, setAlert] = useState('');
  const [error, setError] = useState('');
  const [jql, setJql] = useState('project = "Mobile App " AND Sprint in openSprints() and issuetype in (Story, Bug, Defect)');
  const [filter, setFilter] = useState('');
  const [teamFilter, setTeamFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [typeFilter, setTypeFilter] = useState<'All' | 'Story' | 'Bug' | 'Defect'>('All');
  const [selectedResource, setSelectedResource] = useState('');
  const [chartMode, setChartMode] = useState<'Story/Bug' | 'AOS/iOS' | 'Status'>('Story/Bug');
  const [teamPage, setTeamPage] = useState<TeamJiraPage | null>(null);
  const [teamCharts, setTeamCharts] = useState<TeamJiraCharts | null>(null);
  const [teamPageOpen, setTeamPageOpen] = useState(false);
  const [teamPageLoading, setTeamPageLoading] = useState(false);
  const [teamChartsLoading, setTeamChartsLoading] = useState(false);
  const issuesRef = useRef<HTMLDivElement | null>(null);
  const chartColors = ['#1d4ed8', '#0f766e', '#f59e0b', '#dc2626', '#7c3aed', '#475569'];

  const loadReport = async () => {
    setLoading(true);
    setAlert('');
    setError('');
    try {
      const response = await api.post('/jira/report', isViewer ? {} : { jql });
      setReport(response.data);
      setJql(response.data.jql || jql);
    } catch (err: any) {
      if (err?.response?.data?.auth_required) {
        setAlert(err.response.data.message || 'login to Boots JIRA using browser');
      } else {
        setError(err?.response?.data?.error || err.message || 'Failed to load JIRA report');
      }
    } finally {
      setLoading(false);
    }
  };

  const loadTeamJiraPage = async () => {
    setTeamPageLoading(true);
    setAlert('');
    setError('');
    try {
      const response = await api.get('/jira/team-page');
      setTeamPage(response.data);
    } catch (err: any) {
      if (err?.response?.data?.auth_required) {
        setAlert(err.response.data.message || 'login to Boots JIRA using browser');
      } else {
        setError(err?.response?.data?.error || err.message || 'Failed to load Team JIRA page');
      }
    } finally {
      setTeamPageLoading(false);
    }
  };

  const loadTeamJiraCharts = async () => {
    setTeamChartsLoading(true);
    setAlert('');
    setError('');
    try {
      const response = await api.post('/jira/team-charts', isViewer ? {} : { jql });
      setTeamCharts(response.data);
    } catch (err: any) {
      if (err?.response?.data?.auth_required) {
        setAlert(err.response.data.message || 'login to Boots JIRA using browser');
      } else {
        setError(err?.response?.data?.error || err.message || 'Failed to generate Team JIRA diagrams');
      }
    } finally {
      setTeamChartsLoading(false);
    }
  };

  const openTeamJira = async () => {
    setTeamPageOpen(true);
    await Promise.allSettled([
      teamPage ? Promise.resolve() : loadTeamJiraPage(),
      teamCharts ? Promise.resolve() : loadTeamJiraCharts(),
    ]);
  };

  const refreshTeamJira = async () => {
    await Promise.allSettled([loadTeamJiraPage(), loadTeamJiraCharts()]);
  };

  useEffect(() => { loadReport(); }, []);

  const visibleIssues = useMemo(() => {
    const text = filter.trim().toLowerCase();
    return (report?.issues || [])
      .filter(issue => typeFilter === 'All' || issue.type === typeFilter)
      .filter(issue => teamFilter === 'All' || issue.team === teamFilter)
      .filter(issue => statusFilter === 'All' || issue.status === statusFilter)
      .filter(issue => !fromDate || issue.updated?.slice(0, 10) >= fromDate)
      .filter(issue => !toDate || issue.updated?.slice(0, 10) <= toDate)
      .filter(issue => !text || [issue.key, issue.summary, issue.assignee, issue.team, issue.status].some(value => value.toLowerCase().includes(text)) || (issue.labels || []).some(label => label.toLowerCase().includes(text)))
        .sort((left, right) => left.assignee.localeCompare(right.assignee) || right.story_points - left.story_points || left.key.localeCompare(right.key));
  }, [report, filter, teamFilter, statusFilter, fromDate, toDate, typeFilter]);

  const visibleTeams = useMemo(() => {
    const issueSet = new Set(visibleIssues.map(issue => issue.key));
    const teamMap = new Map<string, JiraTeam>();
    for (const issue of report?.issues || []) {
      if (!issueSet.has(issue.key)) continue;
      const current = teamMap.get(issue.team_id) || {
        team_id: issue.team_id,
        team: issue.team,
        story_count: 0,
        bug_count: 0,
        aos_count: 0,
        ios_count: 0,
        story_points: 0,
        issues: 0,
        resources: 0,
      };
      current.issues += 1;
      current.story_points += issue.story_points;
      if (issue.is_aos) current.aos_count += 1;
      if (issue.is_ios) current.ios_count += 1;
      if (issue.type === 'Bug') current.bug_count += 1;
      if (issue.type === 'Defect') current.bug_count += 1;
      if (issue.type === 'Story') current.story_count += 1;
      teamMap.set(issue.team_id, current);
    }
    return Array.from(teamMap.values()).map(team => ({
      ...team,
      resources: new Set(visibleIssues.filter(issue => issue.team_id === team.team_id).map(issue => issue.assignee)).size,
    })).sort((left, right) => right.story_points - left.story_points || left.team.localeCompare(right.team));
  }, [report, visibleIssues]);

  const visibleResources = useMemo(() => {
    const resourceMap = new Map<string, JiraResource>();
    for (const issue of visibleIssues) {
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
      if (issue.type === 'Bug') current.bug_count += 1;
      if (issue.type === 'Defect') current.bug_count += 1;
      if (issue.type === 'Story') current.story_count += 1;
      resourceMap.set(issue.assignee, current);
    }
    return Array.from(resourceMap.values()).sort((left, right) => left.assignee.localeCompare(right.assignee));
  }, [visibleIssues]);

  const chartData = useMemo(() => {
    if (chartMode === 'AOS/iOS') {
      return [
        { name: 'AOS', value: visibleIssues.filter(issue => issue.is_aos).length },
        { name: 'iOS', value: visibleIssues.filter(issue => issue.is_ios).length },
      ].filter(item => item.value > 0);
    }
    if (chartMode === 'Status') {
      const statusMap = new Map<string, number>();
      for (const issue of visibleIssues) statusMap.set(issue.status, (statusMap.get(issue.status) || 0) + 1);
      return Array.from(statusMap.entries()).map(([name, value]) => ({ name, value }));
    }
    return [
      { name: 'Stories', value: visibleIssues.filter(issue => issue.type === 'Story').length },
      { name: 'Bugs', value: visibleIssues.filter(issue => issue.type === 'Bug').length },
      { name: 'Defects', value: visibleIssues.filter(issue => issue.type === 'Defect').length },
    ].filter(item => item.value > 0);
  }, [chartMode, visibleIssues]);

  const teams = useMemo(() => [...new Set((report?.issues || []).map(issue => issue.team))].sort(), [report]);
  const statuses = useMemo(() => [...new Set((report?.issues || []).map(issue => issue.status))].sort(), [report]);
  const teamPageNeedsExport = needsCustomChartsExport(teamPage?.html);

  const selectResource = (resource: JiraResource) => {
    setSelectedResource(resource.assignee);
    setFilter(resource.assignee);
    window.requestAnimationFrame(() => {
      issuesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  return (
    <div>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 mb-1">JIRA Query</h1>
          <p className="text-sm text-gray-500">Boots Mobile App open sprint Story/Bug visibility by resource and story points.</p>
        </div>
        <div className="flex gap-2">
          <Link to="/jira" className="px-4 py-2 rounded-lg bg-blue-700 text-sm font-medium text-white transition">
            JIRA Query
          </Link>
          <Link to="/jira/due-date" className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:border-blue-500 hover:text-blue-700 transition">
            JIRA Due Date
          </Link>
          <button
            type="button"
            onClick={openTeamJira}
            disabled={teamPageLoading}
            className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:border-blue-500 hover:text-blue-700 transition"
          >
            {teamPageLoading ? 'Loading...' : 'Team JIRA'}
          </button>
          <a
            href="https://bootsuk.atlassian.net/jira"
            target="_blank"
            rel="noreferrer"
            className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:border-blue-500 hover:text-blue-700 transition"
          >
            Open Boots JIRA
          </a>
        </div>
      </div>

      {alert && (
        <div className="bg-amber-100 border border-amber-200 text-amber-800 rounded-xl px-4 py-3 mb-5 text-sm">
          {alert}
        </div>
      )}
      {error && <div className="bg-red-100 border border-red-200 text-red-700 rounded-xl px-4 py-3 mb-5 text-sm">{error}</div>}

      {teamPageOpen && (
        <div className="bg-white rounded-xl border border-gray-200 mb-5 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-200 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">{teamPage?.title || 'Story Point Tracker for All Team'}</h2>
              <p className="text-xs text-gray-500 mt-1">
                {teamPage?.space || 'CDC'}{teamPage?.version ? ` · v${teamPage.version}` : ''}{teamPage?.updated_at ? ` · updated ${teamPage.updated_at.slice(0, 10)}` : ''}
              </p>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={refreshTeamJira}
                disabled={teamPageLoading || teamChartsLoading}
                className="px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-xs font-medium text-gray-700 hover:border-blue-500 hover:text-blue-700 transition disabled:opacity-50"
              >
                {teamPageLoading || teamChartsLoading ? 'Refreshing...' : 'Refresh'}
              </button>
              {teamPage?.source_url && (
                <a
                  href={teamPage.source_url}
                  target="_blank"
                  rel="noreferrer"
                  className="px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-xs font-medium text-gray-700 hover:border-blue-500 hover:text-blue-700 transition"
                >
                  Open Original ↗
                </a>
              )}
              <button
                type="button"
                onClick={() => setTeamPageOpen(false)}
                className="px-3 py-1.5 rounded-lg border border-gray-300 bg-white text-xs font-medium text-gray-700 hover:border-blue-500 hover:text-blue-700 transition"
              >
                Close
              </button>
            </div>
          </div>
          <div className="p-5 max-h-[72vh] overflow-auto bg-gray-50/50">
            {(teamPageLoading || teamChartsLoading) && <div className="text-sm text-gray-500 mb-4">Loading Team JIRA diagrams...</div>}
            {teamCharts?.charts?.length ? (
              <div className="mb-5">
                <div className="flex flex-col gap-1 mb-3">
                  <h3 className="text-sm font-semibold text-gray-900">Python generated diagrams</h3>
                  <p className="text-xs text-gray-500">
                    {teamCharts.total_issues} issues · {teamCharts.total_story_points} story points · generated from live JIRA data
                  </p>
                </div>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                  {teamCharts.charts.map(chart => (
                    <div key={chart.id} className="bg-white border border-gray-200 rounded-lg p-3 min-h-[260px]">
                      <div className="h-full" dangerouslySetInnerHTML={{ __html: chart.svg }} />
                    </div>
                  ))}
                </div>
              </div>
            ) : !teamChartsLoading && (
              <div className="bg-white border border-dashed border-gray-300 rounded-lg px-4 py-6 text-sm text-gray-500 mb-4">
                No Python-generated Team JIRA diagrams loaded yet.
              </div>
            )}
            {teamPageNeedsExport && (
              <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-4 py-3 text-sm mb-4">
                <div className="font-semibold mb-1">Custom Charts export images are not generated for this Confluence page.</div>
                <div>
                  Confluence is returning the Custom Charts placeholder instead of the chart image. Open the original page as <strong>swami.k@ext.boots.com</strong>, use <strong>More actions → Generate Custom Charts export images</strong>, publish/save if prompted, then click <strong>Refresh</strong> here.
                </div>
              </div>
            )}
            {teamPage?.html && (
              <div
                className="confluence-content bg-white border border-gray-200 rounded-lg p-5"
                dangerouslySetInnerHTML={{ __html: sanitizeConfluenceHtml(teamPage.html) }}
              />
            )}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between mb-2">
          <div className="text-xs font-medium text-gray-500">JQL</div>
          <div className="flex items-center gap-3">
            {!isViewer && (
              <button
                type="button"
                onClick={() => setJql(report?.default_jql || 'project = "Mobile App " AND Sprint in openSprints() and issuetype in (Story, Bug, Defect)')}
                className="text-xs text-blue-700 hover:underline"
              >
                Reset default JQL
              </button>
            )}
            {!isViewer && (
              <button
                type="button"
                onClick={loadReport}
                disabled={loading}
                className="bg-blue-700 hover:bg-blue-800 text-white px-4 py-2 rounded-lg text-sm font-medium transition disabled:opacity-50"
              >
                {loading ? 'Loading...' : 'Execute'}
              </button>
            )}
          </div>
        </div>
        <textarea
          value={jql}
          onChange={event => setJql(event.target.value)}
          readOnly={isViewer}
          rows={4}
          className={`block w-full text-xs text-gray-700 bg-gray-100 rounded-lg p-3 border border-gray-200 font-mono ${isViewer ? 'cursor-default' : ''}`}
        />
        <p className="text-xs text-gray-400 mt-2">{isViewer ? 'Viewer access uses the default JQL in read-only mode.' : 'Edit the JQL, then click Execute to pull a fresh live report from Boots JIRA.'}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-5">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-xs text-gray-500">Total Issues</div>
          <div className="text-2xl font-semibold text-gray-900 mt-1">{report?.total_issues ?? '-'}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-xs text-gray-500">Story Points</div>
          <div className="text-2xl font-semibold text-gray-900 mt-1">{report?.total_story_points ?? '-'}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-xs text-gray-500">Resources</div>
          <div className="text-2xl font-semibold text-gray-900 mt-1">{report?.resources.length ?? '-'}</div>
        </div>
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="text-xs text-gray-500">Teams</div>
          <div className="text-2xl font-semibold text-gray-900 mt-1">{report?.teams.length ?? '-'}</div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-5">
        <h2 className="font-semibold text-gray-800 mb-4">Filters</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3">
          <label className="text-xs font-medium text-gray-500">
            Team
            <select value={teamFilter} onChange={event => setTeamFilter(event.target.value)} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700">
              <option>All</option>
              {teams.map(team => <option key={team}>{team}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-gray-500">
            Issue Type
            <select value={typeFilter} onChange={event => setTypeFilter(event.target.value as any)} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700">
              <option>All</option>
              <option>Story</option>
              <option>Defect</option>
              <option>Bug</option>
            </select>
          </label>
          <label className="text-xs font-medium text-gray-500">
            Updated from
            <input type="date" value={fromDate} onChange={event => setFromDate(event.target.value)} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700" />
          </label>
          <label className="text-xs font-medium text-gray-500">
            Updated to
            <input type="date" value={toDate} onChange={event => setToDate(event.target.value)} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700" />
          </label>
          <label className="text-xs font-medium text-gray-500">
            Name / text
            <input value={filter} onChange={event => setFilter(event.target.value)} placeholder="Resource, key, summary, label" className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700" />
          </label>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between mb-4">
          <div>
            <h2 className="font-semibold text-gray-800">Team-wise Story/Bug Split</h2>
            <p className="text-xs text-gray-500">Filtered by selected team, status, date, issue type, and name/text.</p>
          </div>
          <select value={chartMode} onChange={event => setChartMode(event.target.value as any)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700">
            <option>Story/Bug</option>
            <option>AOS/iOS</option>
            <option>Status</option>
          </select>
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-[280px_1fr] gap-5">
          <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500">
              <tr>
                <th className="text-left px-3 py-2">Team</th>
                <th className="text-center px-3 py-2">Stories</th>
                <th className="text-center px-3 py-2">Defects</th>
                <th className="text-center px-3 py-2">Story Points</th>
              </tr>
            </thead>
            <tbody>
              {visibleTeams.map(team => (
                <tr key={team.team_id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium text-gray-800">{team.team}</td>
                  <td className="px-3 py-2 text-center text-gray-600">{team.story_count}</td>
                  <td className="px-3 py-2 text-center text-gray-600">{team.bug_count}</td>
                  <td className="px-3 py-2 text-center font-semibold text-blue-700">{team.story_points}</td>
                </tr>
              ))}
              {!loading && report && visibleTeams.length === 0 && (
                <tr><td colSpan={4} className="px-3 py-8 text-center text-gray-400">No teams match the current filters.</td></tr>
              )}
            </tbody>
          </table>
          </div>
          <div className={`rounded-lg border border-gray-100 bg-gray-50 p-3 ${chartMode === 'Status' ? 'min-h-[400px]' : 'min-h-[340px]'}`}>
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={chartMode === 'Status' ? 380 : 320}>
                <PieChart>
                  <Pie data={chartData} dataKey="value" nameKey="name"
                    innerRadius={chartMode === 'Status' ? 80 : 70}
                    outerRadius={chartMode === 'Status' ? 140 : 130}
                    paddingAngle={2}>
                    {chartData.map((entry, index) => <Cell key={entry.name} fill={chartColors[index % chartColors.length]} />)}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full min-h-[220px] items-center justify-center text-sm text-gray-400">No chart data for the current filters.</div>
            )}
          </div>
        </div>
      </div>

      <div ref={issuesRef} className="bg-white rounded-xl border border-gray-200 p-5 scroll-mt-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between mb-4">
          <div>
            <h2 className="font-semibold text-gray-800">Story Point Sorted Issues</h2>
            <p className="text-xs text-gray-500">
              Sorted by resource name, then story points.
              {selectedResource && <span className="ml-2 text-blue-700">Showing developer: {selectedResource}</span>}
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <select value={typeFilter} onChange={event => setTypeFilter(event.target.value as any)} className="border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700">
              <option>All</option>
              <option>Story</option>
              <option>Defect</option>
              <option>Bug</option>
            </select>
          </div>
        </div>
        <div className="overflow-auto max-h-[560px]">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 sticky top-0">
              <tr>
                <th className="text-left px-3 py-2">Key</th>
                <th className="text-left px-3 py-2">Type</th>
                <th className="text-left px-3 py-2">Summary</th>
                <th className="text-left px-3 py-2">Team</th>
                <th className="text-left px-3 py-2">Resource</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-left px-3 py-2">Labels</th>
                <th className="text-left px-3 py-2">Updated</th>
                <th className="text-center px-3 py-2">SP</th>
              </tr>
            </thead>
            <tbody>
              {visibleIssues.map(issue => (
                <tr key={issue.key} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-3 py-2 font-medium"><a className="text-blue-700 hover:underline" href={issue.url} target="_blank" rel="noreferrer">{issue.key}</a></td>
                  <td className="px-3 py-2 text-gray-600">{issue.type}</td>
                  <td className="px-3 py-2 text-gray-800 min-w-[280px]">{issue.summary}</td>
                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{issue.team}</td>
                  <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{issue.assignee}</td>
                  <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{issue.status}</td>
                  <td className="px-3 py-2 text-gray-500 min-w-[160px]">
                    <div className="flex flex-wrap gap-1">
                      {issue.is_aos && <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs text-blue-700">AOS</span>}
                      {issue.is_ios && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">iOS</span>}
                      {!issue.is_aos && !issue.is_ios && <span className="text-xs text-gray-300">-</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{issue.updated?.slice(0, 10) || '-'}</td>
                  <td className="px-3 py-2 text-center font-semibold text-blue-700">{issue.story_points}</td>
                </tr>
              ))}
              {!loading && report && visibleIssues.length === 0 && (
                <tr><td colSpan={9} className="px-3 py-8 text-center text-gray-400">No issues match the current filter.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}