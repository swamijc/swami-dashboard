import React, { useMemo, useState } from 'react';

interface DayData {
  date: string;
  day: string;
  avg_hours: number;
  total_hours: number;
  members_present: number;
  members_below_alert: string[];
  is_future: boolean;
}

interface Employee {
  employee_number: string;
  employee_name: string;
  total_hours: number;
  projected_weekly: number;
  daily: Record<string, number>;
  bucket: string;
  below_target: boolean;
  daily_alerts: { date: string; hours: number; day: string }[];
}

interface Props {
  dailyTeam: DayData[];
  employees: Employee[];
  isPartialWeek: boolean;
}

function hoursColor(hours: number, isFuture: boolean): string {
  if (isFuture) return 'bg-gray-50 text-gray-400';
  if (hours === 0) return 'bg-gray-100 text-gray-400';
  if (hours < 6)  return 'bg-red-100 text-red-700 font-semibold';
  if (hours < 8)  return 'bg-yellow-50 text-yellow-700';
  return 'bg-green-50 text-green-700';
}

function HoursBadge({ hours, isFuture }: { hours: number; isFuture: boolean }) {
  const cls = hoursColor(hours, isFuture);
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs ${cls}`}>
      {isFuture ? '—' : hours === 0 ? '—' : `${hours}h`}
    </span>
  );
}

export default function DailyTable({ dailyTeam, employees, isPartialWeek }: Props) {
  const days = dailyTeam.map(d => d.date);
  const [resourceFilter, setResourceFilter] = useState('');
  const [totalSort, setTotalSort] = useState<'desc' | 'asc'>('desc');

  const visibleEmployees = useMemo(() => {
    const filter = resourceFilter.trim().toLowerCase();
    const filtered = filter
      ? employees.filter(emp =>
          emp.employee_name.toLowerCase().includes(filter) ||
          emp.employee_number.toLowerCase().includes(filter) ||
          emp.bucket.toLowerCase().includes(filter)
        )
      : employees;

    return [...filtered].sort((left, right) => {
      const diff = left.total_hours - right.total_hours;
      if (diff === 0) return left.employee_name.localeCompare(right.employee_name);
      return totalSort === 'asc' ? diff : -diff;
    });
  }, [employees, resourceFilter, totalSort]);

  const sortLabel = totalSort === 'asc' ? 'ascending' : 'descending';

  return (
    <div className="space-y-6">
      {/* Team daily summary row */}
      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-3">
          Team Day-wise Average
          {isPartialWeek && <span className="ml-2 text-xs font-normal text-blue-600 bg-blue-50 px-2 py-0.5 rounded">Mid-week — showing average of 8h/day target</span>}
        </h4>
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="text-left px-3 py-2 bg-gray-50 rounded-tl-lg border-b text-xs font-medium text-gray-500 w-28">Day</th>
                <th className="text-center px-3 py-2 bg-gray-50 border-b text-xs font-medium text-gray-500">Team Avg</th>
                <th className="text-center px-3 py-2 bg-gray-50 border-b text-xs font-medium text-gray-500">Total Hrs</th>
                <th className="text-center px-3 py-2 bg-gray-50 border-b text-xs font-medium text-gray-500">Present</th>
                <th className="text-left px-3 py-2 bg-gray-50 rounded-tr-lg border-b text-xs font-medium text-gray-500">Below 6h Alert</th>
              </tr>
            </thead>
            <tbody>
              {dailyTeam.map((d, i) => (
                <tr key={d.date} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                  <td className="px-3 py-2 font-medium text-gray-700">
                    {d.day} <span className="text-xs text-gray-400">{d.date.slice(5)}</span>
                    {d.is_future && <span className="ml-1 text-xs text-gray-300">future</span>}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {d.is_future ? '—' : (
                      <span className={`font-medium ${d.avg_hours >= 8 ? 'text-green-600' : d.avg_hours >= 6 ? 'text-yellow-600' : d.avg_hours > 0 ? 'text-red-600' : 'text-gray-400'}`}>
                        {d.avg_hours > 0 ? `${d.avg_hours}h` : '—'}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center text-gray-600">{d.is_future ? '—' : d.total_hours > 0 ? `${d.total_hours}h` : '—'}</td>
                  <td className="px-3 py-2 text-center text-gray-500">{d.is_future ? '—' : d.members_present}</td>
                  <td className="px-3 py-2">
                    {d.members_below_alert.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {d.members_below_alert.map(name => (
                          <span key={name} className="text-xs bg-red-100 text-red-700 px-1.5 py-0.5 rounded">
                            ⚠ {name}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Per-employee grid */}
      <div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between mb-3">
          <div>
            <h4 className="text-sm font-semibold text-gray-700">Individual Breakdown</h4>
            <p className="text-xs text-gray-400 mt-1">
              Showing {visibleEmployees.length} of {employees.length} resources · Total hours sorted {sortLabel}
            </p>
          </div>
          <label className="text-xs font-medium text-gray-500">
            Filter resources
            <input
              type="search"
              value={resourceFilter}
              onChange={e => setResourceFilter(e.target.value)}
              placeholder="Name, ID, or bucket"
              className="mt-1 block w-full sm:w-64 border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>
        </div>
        <div className="overflow-auto max-h-[560px] rounded-lg border border-gray-100">
          <table className="w-full text-sm border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="text-left px-3 py-2 bg-gray-50 border-b text-xs font-medium text-gray-500 sticky left-0 top-0 z-20">Name</th>
                {days.map(d => {
                  const dayInfo = dailyTeam.find(x => x.date === d);
                  return (
                    <th key={d} className="text-center px-3 py-2 bg-gray-50 border-b text-xs font-medium text-gray-500 min-w-[64px] sticky top-0 z-10">
                      {dayInfo?.day}<br/><span className="text-gray-400 font-normal">{d.slice(5)}</span>
                    </th>
                  );
                })}
                <th className="text-center px-3 py-2 bg-gray-50 border-b text-xs font-medium text-gray-500 sticky top-0 z-10">
                  <button
                    type="button"
                    onClick={() => setTotalSort(current => current === 'desc' ? 'asc' : 'desc')}
                    className="inline-flex items-center justify-center gap-1 rounded px-2 py-1 text-xs font-semibold text-gray-600 hover:bg-gray-100 hover:text-blue-700"
                    title="Sort by total hours"
                  >
                    Total <span aria-hidden="true">{totalSort === 'desc' ? '↓' : '↑'}</span>
                  </button>
                </th>
                <th className="text-center px-3 py-2 bg-gray-50 border-b text-xs font-medium text-gray-500 sticky top-0 z-10">Projected</th>
              </tr>
            </thead>
            <tbody>
              {visibleEmployees.map((emp, i) => (
                <tr key={emp.employee_number} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                  <td className="px-3 py-2 font-medium text-gray-800 sticky left-0 bg-inherit whitespace-nowrap z-10">
                    <div>{emp.employee_name || emp.employee_number}</div>
                    {emp.daily_alerts.length > 0 && (
                      <span className="ml-1.5 text-red-500 text-xs" title="Has days below 6h">⚠</span>
                    )}
                  </td>
                  {days.map(d => {
                    const dayInfo = dailyTeam.find(x => x.date === d);
                    const h = emp.daily[d];
                    return (
                      <td key={d} className="px-3 py-2 text-center">
                        <HoursBadge hours={h ?? 0} isFuture={dayInfo?.is_future ?? false} />
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-center">
                    <span className={`font-semibold ${emp.below_target ? 'text-red-600' : 'text-green-700'}`}>
                      {emp.total_hours}h
                    </span>
                  </td>
                  <td className="px-3 py-2 text-center text-gray-500 text-xs">
                    {emp.projected_weekly !== emp.total_hours ? `~${emp.projected_weekly}h` : '—'}
                  </td>
                </tr>
              ))}
              {visibleEmployees.length === 0 && (
                <tr>
                  <td colSpan={days.length + 3} className="px-3 py-8 text-center text-sm text-gray-400">
                    No resources match the current filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-gray-400 mt-2">
          🔴 &lt;6h alert &nbsp; 🟡 6–8h &nbsp; 🟢 8h+ &nbsp; Red total = below 40h/week target
        </p>
      </div>
    </div>
  );
}
