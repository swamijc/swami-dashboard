import React, { useEffect, useMemo, useState } from 'react';
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
  team: string;
  status: string;
  ready_progressive_sit_date: string | null;
  due_date: string | null;
  sprint: string;
  sprint_start_date: string | null;
  labels: string[];
  story_points: number;
}

interface JiraReport {
  jql: string;
  default_jql: string;
  issues: JiraIssue[];
}

function toLocalDate(value?: string | null): Date | null {
  if (!value) return null;
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dayFromSprintStart(sprintStart?: string | null, targetDate?: string | null): number | null {
  const start = toLocalDate(sprintStart);
  const target = toLocalDate(targetDate);
  if (!start || !target) return null;
  return Math.max(1, Math.floor((target.getTime() - start.getTime()) / 86400000) + 1);
}

function percent(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 100) : 0;
}

function formatDay(value: number | null): string {
  return value ? `Day ${value}` : '-';
}

export default function JiraDueDate() {
  const { user } = useAuth();
  const isViewer = user?.role === 'viewer';
  const [report, setReport] = useState<JiraReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [alert, setAlert] = useState('');
  const [error, setError] = useState('');
  const [jql, setJql] = useState('project = "Mobile App " AND Sprint in openSprints() and issuetype in (Story, Bug, Defect)');
  const [teamFilter, setTeamFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState('All');
  const [typeFilter, setTypeFilter] = useState<'All' | 'Story' | 'Bug' | 'Defect'>('All');
  const [labelFilter, setLabelFilter] = useState('All');
  const chartColors = ['#1d4ed8', '#0f766e', '#f59e0b', '#dc2626'];

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
        setError(err?.response?.data?.error || err.message || 'Failed to load JIRA due date report');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadReport(); }, []);

  const teams = useMemo(() => [...new Set((report?.issues || []).map(issue => issue.team))].sort(), [report]);
  const statuses = useMemo(() => [...new Set((report?.issues || []).map(issue => issue.status))].sort(), [report]);

  const filteredIssues = useMemo(() => {
    return (report?.issues || [])
      .filter(issue => typeFilter === 'All' || issue.type === typeFilter)
      .filter(issue => teamFilter === 'All' || issue.team === teamFilter)
      .filter(issue => statusFilter === 'All' || issue.status === statusFilter)
      .filter(issue => labelFilter === 'All' || (issue.labels || []).includes(labelFilter));
  }, [report, teamFilter, statusFilter, typeFilter, labelFilter]);

  const dueDateStats = useMemo(() => {
    const resourceMap = new Map<string, {
      assignee: string;
      issues: number;
      stories: number;
      bugs: number;
      ready_count: number;
      due_count: number;
      by_day_2: number;
      by_day_5: number;
      by_day_8: number;
      day_sum: number;
      next_ready_date: string | null;
      next_due_date: string | null;
    }>();
    let storyCount = 0;
    let storyByDay2 = 0;
    let storyByDay5 = 0;
    let storyByDay8 = 0;
    let storyDaySum = 0;
    let storyReadyCount = 0;
    let readyCount = 0;
    let dueCount = 0;
    let missingReadyCount = 0;

    const scheduledIssues = filteredIssues.map(issue => ({
      ...issue,
      dev_day: dayFromSprintStart(issue.sprint_start_date, issue.ready_progressive_sit_date),
      due_day: dayFromSprintStart(issue.sprint_start_date, issue.due_date),
    })).sort((left, right) =>
      (left.ready_progressive_sit_date || '9999-12-31').localeCompare(right.ready_progressive_sit_date || '9999-12-31') ||
      left.assignee.localeCompare(right.assignee) ||
      left.key.localeCompare(right.key)
    );

    for (const issue of scheduledIssues) {
      const isStory = issue.type === 'Story';
      if (isStory) storyCount += 1;
      if (issue.ready_progressive_sit_date) readyCount += 1;
      if (!issue.ready_progressive_sit_date) missingReadyCount += 1;
      if (issue.due_date) dueCount += 1;
      if (isStory && issue.dev_day) {
        storyReadyCount += 1;
        storyDaySum += issue.dev_day;
        if (issue.dev_day <= 2) storyByDay2 += 1;
        if (issue.dev_day <= 5) storyByDay5 += 1;
        if (issue.dev_day <= 8) storyByDay8 += 1;
      }

      const current = resourceMap.get(issue.assignee) || {
        assignee: issue.assignee,
        issues: 0,
        stories: 0,
        bugs: 0,
        ready_count: 0,
        due_count: 0,
        by_day_2: 0,
        by_day_5: 0,
        by_day_8: 0,
        day_sum: 0,
        next_ready_date: null,
        next_due_date: null,
      };
      current.issues += 1;
      if (issue.type === 'Story') current.stories += 1;
      if (issue.type === 'Bug') current.bugs += 1;
      if (issue.ready_progressive_sit_date) {
        current.ready_count += 1;
        current.next_ready_date = !current.next_ready_date || issue.ready_progressive_sit_date < current.next_ready_date ? issue.ready_progressive_sit_date : current.next_ready_date;
      }
      if (issue.due_date) {
        current.due_count += 1;
        current.next_due_date = !current.next_due_date || issue.due_date < current.next_due_date ? issue.due_date : current.next_due_date;
      }
      if (issue.dev_day) {
        current.day_sum += issue.dev_day;
        if (issue.dev_day <= 2) current.by_day_2 += 1;
        if (issue.dev_day <= 5) current.by_day_5 += 1;
        if (issue.dev_day <= 8) current.by_day_8 += 1;
      }
      resourceMap.set(issue.assignee, current);
    }

    const resources = Array.from(resourceMap.values()).map(resource => ({
      ...resource,
      avg_dev_day: resource.ready_count > 0 ? Math.round((resource.day_sum / resource.ready_count) * 10) / 10 : null,
      day_2_pct: percent(resource.by_day_2, resource.issues),
      day_5_pct: percent(resource.by_day_5, resource.issues),
      day_8_pct: percent(resource.by_day_8, resource.issues),
    })).sort((left, right) => (left.avg_dev_day ?? 999) - (right.avg_dev_day ?? 999) || left.assignee.localeCompare(right.assignee));

    return {
      readyCount,
      dueCount,
      missingReadyCount,
      storyCount,
      storyByDay2,
      storyByDay5,
      storyByDay8,
      avgStoryDay: storyReadyCount > 0 ? Math.round((storyDaySum / storyReadyCount) * 10) / 10 : null,
      resources,
      scheduledIssues,
    };
  }, [filteredIssues]);

  const labels = useMemo(() => [...new Set((report?.issues || []).flatMap(issue => issue.labels || []))].sort(), [report]);
  const visibleResources = labelFilter === 'All' ? dueDateStats.resources.slice(0, 5) : dueDateStats.resources;
  const visibleIssues = useMemo(() => {
    const resourceNames = new Set(visibleResources.map(resource => resource.assignee));
    return dueDateStats.scheduledIssues.filter(issue => resourceNames.has(issue.assignee));
  }, [dueDateStats.scheduledIssues, visibleResources]);

  const dueDateChartData = useMemo(() => [
    { name: 'By Day 2', value: dueDateStats.storyByDay2 },
    { name: 'Day 3-5', value: Math.max(0, dueDateStats.storyByDay5 - dueDateStats.storyByDay2) },
    { name: 'Day 6-8', value: Math.max(0, dueDateStats.storyByDay8 - dueDateStats.storyByDay5) },
    { name: 'After Day 8 / Missing', value: Math.max(0, dueDateStats.storyCount - dueDateStats.storyByDay8) },
  ].filter(item => item.value > 0), [dueDateStats.storyByDay2, dueDateStats.storyByDay5, dueDateStats.storyByDay8, dueDateStats.storyCount]);

  const missingReadyIssues = useMemo(() => filteredIssues
    .filter(issue => !issue.ready_progressive_sit_date)
    .sort((left, right) => left.assignee.localeCompare(right.assignee) || left.key.localeCompare(right.key)), [filteredIssues]);

  const missingReadyDevelopers = useMemo(() => {
    const developerMap = new Map<string, { assignee: string; issues: number; stories: number; bugs: number; story_points: number }>();
    for (const issue of missingReadyIssues) {
      const current = developerMap.get(issue.assignee) || { assignee: issue.assignee, issues: 0, stories: 0, bugs: 0, story_points: 0 };
      current.issues += 1;
      current.story_points += issue.story_points;
      if (issue.type === 'Story') current.stories += 1;
      if (issue.type === 'Bug') current.bugs += 1;
      developerMap.set(issue.assignee, current);
    }
    return Array.from(developerMap.values()).sort((left, right) => right.issues - left.issues || left.assignee.localeCompare(right.assignee));
  }, [missingReadyIssues]);

  return (
    <div>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 mb-1">JIRA Due Date</h1>
          <p className="text-sm text-gray-500">Developer completion trend from Ready for Progressive SIT date and Jira Due date.</p>
        </div>
        <div className="flex gap-2">
          <Link to="/jira" className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:border-blue-500 hover:text-blue-700 transition">JIRA Query</Link>
          <Link to="/jira/due-date" className="px-4 py-2 rounded-lg bg-blue-700 text-sm font-medium text-white transition">JIRA Due Date</Link>
          <a href="https://bootsuk.atlassian.net/wiki/spaces/cdc/pages/1443430401/Story+Point+Tracker+for+All+Team" target="_blank" rel="noreferrer" className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:border-blue-500 hover:text-blue-700 transition">Team JIRA ↗</a>
        </div>
      </div>

      {alert && <div className="bg-amber-100 border border-amber-200 text-amber-800 rounded-xl px-4 py-3 mb-5 text-sm">{alert}</div>}
      {error && <div className="bg-red-100 border border-red-200 text-red-700 rounded-xl px-4 py-3 mb-5 text-sm">{error}</div>}

      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between mb-2">
          <div className="text-xs font-medium text-gray-500">JQL</div>
          <div className="flex items-center gap-3">
            {!isViewer && <button type="button" onClick={() => setJql(report?.default_jql || 'project = "Mobile App " AND Sprint in openSprints() and issuetype in (Story, Bug, Defect)')} className="text-xs text-blue-700 hover:underline">Reset default JQL</button>}
            {!isViewer && <button type="button" onClick={loadReport} disabled={loading} className="bg-blue-700 hover:bg-blue-800 text-white px-4 py-2 rounded-lg text-sm font-medium transition disabled:opacity-50">{loading ? 'Loading...' : 'Execute'}</button>}
          </div>
        </div>
        <textarea value={jql} onChange={event => setJql(event.target.value)} readOnly={isViewer} rows={4} className={`block w-full text-xs text-gray-700 bg-gray-100 rounded-lg p-3 border border-gray-200 font-mono ${isViewer ? 'cursor-default' : ''}`} />
        {isViewer && <p className="text-xs text-gray-400 mt-2">Viewer access uses the default JQL in read-only mode.</p>}
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-5">
        <h2 className="font-semibold text-gray-800 mb-4">Filters</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
          <label className="text-xs font-medium text-gray-500">Label<select value={labelFilter} onChange={event => setLabelFilter(event.target.value)} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700"><option>All</option>{labels.map(label => <option key={label}>{label}</option>)}</select></label>
          <label className="text-xs font-medium text-gray-500">Team<select value={teamFilter} onChange={event => setTeamFilter(event.target.value)} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700"><option>All</option>{teams.map(team => <option key={team}>{team}</option>)}</select></label>
          <label className="text-xs font-medium text-gray-500">Status<select value={statusFilter} onChange={event => setStatusFilter(event.target.value)} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700"><option>All</option>{statuses.map(status => <option key={status}>{status}</option>)}</select></label>
          <label className="text-xs font-medium text-gray-500">Type<select value={typeFilter} onChange={event => setTypeFilter(event.target.value as any)} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700"><option>All</option><option>Story</option><option>Bug</option><option>Defect</option></select></label>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-3 mb-5">
        <div className="bg-white rounded-xl border border-gray-200 p-5"><div className="text-xs text-gray-500">Story Day 2 Target</div><div className="text-2xl font-semibold text-gray-900 mt-1">{percent(dueDateStats.storyByDay2, dueDateStats.storyCount)}%</div><div className="text-xs text-gray-400 mt-1">Plan: 30%</div></div>
        <div className="bg-white rounded-xl border border-gray-200 p-5"><div className="text-xs text-gray-500">Story Day 5 Target</div><div className="text-2xl font-semibold text-gray-900 mt-1">{percent(dueDateStats.storyByDay5, dueDateStats.storyCount)}%</div><div className="text-xs text-gray-400 mt-1">Plan: 60%</div></div>
        <div className="bg-white rounded-xl border border-gray-200 p-5"><div className="text-xs text-gray-500">Story Day 8 Target</div><div className="text-2xl font-semibold text-gray-900 mt-1">{percent(dueDateStats.storyByDay8, dueDateStats.storyCount)}%</div><div className="text-xs text-gray-400 mt-1">Plan: 100%</div></div>
        <div className="bg-white rounded-xl border border-gray-200 p-5"><div className="text-xs text-gray-500">Avg Dev Completion</div><div className="text-2xl font-semibold text-gray-900 mt-1">{dueDateStats.avgStoryDay ? `Day ${dueDateStats.avgStoryDay}` : '-'}</div><div className="text-xs text-gray-400 mt-1">{dueDateStats.readyCount} ready dates, {dueDateStats.dueCount} due dates</div></div>
        <div className="bg-white rounded-xl border border-gray-200 p-5"><div className="text-xs text-gray-500">Missing Ready SIT</div><div className="text-2xl font-semibold text-gray-900 mt-1">{dueDateStats.missingReadyCount}</div><div className="text-xs text-gray-400 mt-1">issues need date</div></div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[360px_1fr] gap-5 mb-5">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="font-semibold text-gray-800 mb-1">Development Completion Trend</h2>
          <p className="text-xs text-gray-500 mb-4">Story readiness buckets based on Ready for Progressive SIT date.</p>
          <div className="min-h-[280px]">
            {dueDateChartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={dueDateChartData} dataKey="value" nameKey="name" innerRadius={58} outerRadius={94} paddingAngle={2}>
                    {dueDateChartData.map((entry, index) => <Cell key={entry.name} fill={chartColors[index % chartColors.length]} />)}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex min-h-[240px] items-center justify-center text-sm text-gray-400">No chart data for the current filters.</div>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex flex-col gap-1 mb-4">
            <h2 className="font-semibold text-gray-800">Missing Ready for Progressive SIT Date</h2>
            <p className="text-xs text-gray-500">Developers with issues where the Ready for Progressive SIT date column is not filled.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs text-gray-500"><tr><th className="text-left px-3 py-2">Developer</th><th className="text-center px-3 py-2">Issues</th><th className="text-center px-3 py-2">Stories</th><th className="text-center px-3 py-2">Bugs</th><th className="text-center px-3 py-2">Story Points</th></tr></thead>
              <tbody>
                {missingReadyDevelopers.map(developer => (
                  <tr key={developer.assignee} className="border-b border-gray-100 hover:bg-gray-50"><td className="px-3 py-2 font-medium text-gray-800">{developer.assignee}</td><td className="px-3 py-2 text-center text-gray-600">{developer.issues}</td><td className="px-3 py-2 text-center text-gray-600">{developer.stories}</td><td className="px-3 py-2 text-center text-gray-600">{developer.bugs}</td><td className="px-3 py-2 text-center font-semibold text-blue-700">{developer.story_points}</td></tr>
                ))}
                {!loading && report && missingReadyDevelopers.length === 0 && <tr><td colSpan={5} className="px-3 py-8 text-center text-gray-400">All matching issues have Ready for Progressive SIT date filled.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-5">
        <div className="flex flex-col gap-1 mb-4">
          <h2 className="font-semibold text-gray-800">Developer Due Date Trend</h2>
          <p className="text-xs text-gray-500">Showing first five developers by default. Select a user to focus the report.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500"><tr><th className="text-left px-3 py-2">Developer</th><th className="text-center px-3 py-2">Stories</th><th className="text-center px-3 py-2">Bugs</th><th className="text-center px-3 py-2">Avg Dev Day</th><th className="text-center px-3 py-2">Day 2</th><th className="text-center px-3 py-2">Day 5</th><th className="text-center px-3 py-2">Day 8</th><th className="text-left px-3 py-2">Next Ready SIT</th><th className="text-left px-3 py-2">Next Due</th></tr></thead>
            <tbody>
              {visibleResources.map(resource => (
                <tr key={resource.assignee} className="border-b border-gray-100 hover:bg-gray-50"><td className="px-3 py-2 font-medium text-gray-800">{resource.assignee}</td><td className="px-3 py-2 text-center text-gray-600">{resource.stories}</td><td className="px-3 py-2 text-center text-gray-600">{resource.bugs}</td><td className="px-3 py-2 text-center text-gray-600">{resource.avg_dev_day ? `Day ${resource.avg_dev_day}` : '-'}</td><td className="px-3 py-2 text-center text-gray-600">{resource.day_2_pct}%</td><td className="px-3 py-2 text-center text-gray-600">{resource.day_5_pct}%</td><td className="px-3 py-2 text-center text-gray-600">{resource.day_8_pct}%</td><td className="px-3 py-2 text-gray-600 whitespace-nowrap">{resource.next_ready_date || '-'}</td><td className="px-3 py-2 text-gray-600 whitespace-nowrap">{resource.next_due_date || '-'}</td></tr>
              ))}
              {!loading && report && visibleResources.length === 0 && <tr><td colSpan={9} className="px-3 py-8 text-center text-gray-400">No due date data matches the current filters.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <h2 className="font-semibold text-gray-800 mb-4">Issue Due Date Schedule</h2>
        <div className="overflow-auto max-h-[560px]">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 sticky top-0"><tr><th className="text-left px-3 py-2">Key</th><th className="text-left px-3 py-2">Developer</th><th className="text-left px-3 py-2">Type</th><th className="text-left px-3 py-2">Sprint</th><th className="text-left px-3 py-2">Sprint Start</th><th className="text-left px-3 py-2">Ready SIT</th><th className="text-center px-3 py-2">Dev Day</th><th className="text-left px-3 py-2">Due Date</th><th className="text-center px-3 py-2">Due Day</th><th className="text-center px-3 py-2">SP</th></tr></thead>
            <tbody>
              {visibleIssues.map(issue => (
                <tr key={issue.key} className="border-b border-gray-100 hover:bg-gray-50"><td className="px-3 py-2 font-medium"><a className="text-blue-700 hover:underline" href={issue.url} target="_blank" rel="noreferrer">{issue.key}</a></td><td className="px-3 py-2 text-gray-600 whitespace-nowrap">{issue.assignee}</td><td className="px-3 py-2 text-gray-600">{issue.type}</td><td className="px-3 py-2 text-gray-600 whitespace-nowrap">{issue.sprint}</td><td className="px-3 py-2 text-gray-500 whitespace-nowrap">{issue.sprint_start_date || '-'}</td><td className="px-3 py-2 text-gray-500 whitespace-nowrap">{issue.ready_progressive_sit_date || '-'}</td><td className="px-3 py-2 text-center font-medium text-gray-700">{formatDay(issue.dev_day)}</td><td className="px-3 py-2 text-gray-500 whitespace-nowrap">{issue.due_date || '-'}</td><td className="px-3 py-2 text-center text-gray-600">{formatDay(issue.due_day)}</td><td className="px-3 py-2 text-center font-semibold text-blue-700">{issue.story_points}</td></tr>
              ))}
              {!loading && report && visibleIssues.length === 0 && <tr><td colSpan={10} className="px-3 py-8 text-center text-gray-400">No scheduled issues match the filters.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-5 mt-5">
        <h2 className="font-semibold text-gray-800 mb-4">Missing Ready SIT Issues</h2>
        <div className="overflow-auto max-h-[360px]">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-xs text-gray-500 sticky top-0"><tr><th className="text-left px-3 py-2">Key</th><th className="text-left px-3 py-2">Developer</th><th className="text-left px-3 py-2">Type</th><th className="text-left px-3 py-2">Summary</th><th className="text-left px-3 py-2">Due Date</th><th className="text-center px-3 py-2">SP</th></tr></thead>
            <tbody>
              {missingReadyIssues.map(issue => (
                <tr key={issue.key} className="border-b border-gray-100 hover:bg-gray-50"><td className="px-3 py-2 font-medium"><a className="text-blue-700 hover:underline" href={issue.url} target="_blank" rel="noreferrer">{issue.key}</a></td><td className="px-3 py-2 text-gray-600 whitespace-nowrap">{issue.assignee}</td><td className="px-3 py-2 text-gray-600">{issue.type}</td><td className="px-3 py-2 text-gray-800 min-w-[280px]">{issue.summary}</td><td className="px-3 py-2 text-gray-500 whitespace-nowrap">{issue.due_date || '-'}</td><td className="px-3 py-2 text-center font-semibold text-blue-700">{issue.story_points}</td></tr>
              ))}
              {!loading && report && missingReadyIssues.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-gray-400">No missing Ready for Progressive SIT date issues.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}