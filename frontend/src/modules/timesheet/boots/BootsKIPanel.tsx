import React, { useState } from 'react';
import api from '../../../api/client';
import RunButton from '../../../components/RunButton';
import JobHistory from '../../../components/JobHistory';
import { format, startOfWeek, addDays } from 'date-fns';
import { useAuth } from '../../../auth/AuthContext';

type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri';
const DAYS: DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri'];

function getWeekStart(): string {
  const monday = startOfWeek(new Date(), { weekStartsOn: 1 });
  return format(monday, 'yyyy-MM-dd');
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 mb-5">
      <h3 className="font-semibold text-gray-800 mb-4">{title}</h3>
      {children}
    </div>
  );
}

function WeekPlanner({
  label, resource, hours, flags, onChange
}: {
  label: string; resource: string; hours: number;
  flags: Record<DayKey, 'Y' | 'N'>;
  onChange: (day: DayKey, val: 'Y' | 'N') => void;
}) {
  const weekStart = getWeekStart();
  const monday = new Date(weekStart + 'T00:00:00');

  return (
    <div className="mb-4">
      <div className="flex items-center gap-2 mb-2">
        <span className="font-medium text-sm text-gray-700">{label}</span>
        <span className="text-xs text-gray-400">({resource}) &nbsp; {hours}h/day</span>
      </div>
      <div className="flex gap-2">
        {DAYS.map((day, i) => {
          const date = format(addDays(monday, i), 'dd');
          const isY = flags[day] === 'Y';
          return (
            <button
              key={day}
              onClick={() => onChange(day, isY ? 'N' : 'Y')}
              className={`flex flex-col items-center w-14 py-2 rounded-lg border text-xs font-medium transition
                ${isY ? 'bg-green-50 border-green-400 text-green-700' : 'bg-orange-50 border-orange-300 text-orange-600'}`}
            >
              <span className="uppercase">{day}</span>
              <span className="text-lg">{date}</span>
              <span>{isY ? '✓' : 'OoO'}</span>
            </button>
          );
        })}
      </div>
      <p className="text-xs text-gray-400 mt-1">Green = work day (main project) · Orange = OoO/holiday</p>
    </div>
  );
}

export default function BootsKIPanel() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const defaultFlags: Record<DayKey, 'Y' | 'N'> = { mon:'Y', tue:'Y', wed:'Y', thu:'Y', fri:'Y' };
  const [swamiFlags, setSwamiFlags] = useState<Record<DayKey, 'Y' | 'N'>>(defaultFlags);
  const [pvFlags,    setPVFlags]    = useState<Record<DayKey, 'Y' | 'N'>>(defaultFlags);

  const toggleSwami = (day: DayKey, val: 'Y' | 'N') => setSwamiFlags(f => ({ ...f, [day]: val }));
  const togglePV    = (day: DayKey, val: 'Y' | 'N') => setPVFlags(f => ({ ...f, [day]: val }));

  return (
    <div className="max-w-3xl">

      {/* Swami KI */}
      <Card title="👤 Swami's KI Timesheet (KSWA1)">
        <div className="text-sm text-gray-500 mb-4 space-y-1">
          <p><span className="font-medium">Endpoint:</span> POST /TimeEntry/SaveTimeEntry?Site=KIE200143PROD</p>
          <p><span className="font-medium">Schedule:</span> Every Monday at 1:45 PM IST</p>
          <p><span className="font-medium">Project:</span> PRJ7531 · PR-002 · Task 51830 &nbsp;·&nbsp; <span className="font-medium">Hours:</span> 9.00/day</p>
        </div>
        <WeekPlanner label="Swami" resource="KSWA1" hours={9} flags={swamiFlags} onChange={toggleSwami} />
        {isAdmin && (
          <RunButton
            label="Submit Swami KI Timesheet"
            onRun={async (dryRun) => {
              await api.post('/timesheet/boots/swami/submit', {
                dry_run: dryRun, week_start: getWeekStart(), day_flags: swamiFlags
              });
            }}
          />
        )}
      </Card>

      {/* PV KI */}
      <Card title="🧢 PV's KI Timesheet (VILP1)">
        <div className="text-sm text-gray-500 mb-4 space-y-1">
          <p><span className="font-medium">Endpoint:</span> POST /TimeEntry/SaveTimeEntry?Site=KIE200143PROD</p>
          <p><span className="font-medium">Schedule:</span> Every Monday at 1:45 PM IST</p>
          <p><span className="font-medium">Project:</span> PRJ7531 · PR-002 · Task 51830 &nbsp;·&nbsp; <span className="font-medium">Hours:</span> 4.50/day (part-time)</p>
        </div>
        <WeekPlanner label="PV (Prasanna)" resource="VILP1" hours={4.5} flags={pvFlags} onChange={togglePV} />
        {isAdmin && (
          <RunButton
            label="Submit PV KI Timesheet"
            onRun={async (dryRun) => {
              await api.post('/timesheet/boots/pv/submit', {
                dry_run: dryRun, week_start: getWeekStart(), day_flags: pvFlags
              });
            }}
          />
        )}
      </Card>

      {/* Run History */}
      {isAdmin && (
        <Card title="📜 Run History — Boots KI">
          <JobHistory service="boots_ki_swami" />
        </Card>
      )}

    </div>
  );
}
