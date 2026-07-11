import React, { useState, useCallback } from 'react';
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer, Sector
} from 'recharts';

const BUCKET_COLORS: Record<string, string> = {
  '<40':   '#ef4444',  // red
  '40–41': '#f97316',  // orange
  '41–42': '#eab308',  // yellow
  '42–43': '#84cc16',  // lime
  '43–45': '#22c55e',  // green
  '45–50': '#3b82f6',  // blue
  '50+':   '#8b5cf6',  // purple
};

interface Bucket {
  bucket: string;
  count: number;
  pct: number;
  employees: string[];
}

interface Props {
  buckets: Bucket[];
}

const InteractivePie = Pie as any;
const InteractiveTooltip = Tooltip as any;

function renderActiveShape(props: any) {
  const {
    cx, cy, innerRadius, outerRadius, startAngle, endAngle,
    fill, payload, percent,
  } = props;
  return (
    <g>
      <text x={cx} y={cy - 12} textAnchor="middle" fill="#111827" className="text-sm font-semibold">
        {payload.bucket}
      </text>
      <text x={cx} y={cy + 12} textAnchor="middle" fill="#6b7280" className="text-xs">
        {payload.count} member{payload.count !== 1 ? 's' : ''} · {(percent * 100).toFixed(1)}%
      </text>
      <Sector cx={cx} cy={cy} innerRadius={innerRadius} outerRadius={outerRadius + 8}
        startAngle={startAngle} endAngle={endAngle} fill={fill} />
      <Sector cx={cx} cy={cy} innerRadius={outerRadius + 12} outerRadius={outerRadius + 16}
        startAngle={startAngle} endAngle={endAngle} fill={fill} />
    </g>
  );
}

export default function WeeklyPieChart({ buckets }: Props) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [selectedBucket, setSelectedBucket] = useState<Bucket | null>(null);

  const data = buckets.filter(b => b.count > 0).map(b => ({
    ...b,
    value: b.count,
    name: b.bucket,
  }));

  const onPieClick = useCallback((_: any, index: number) => {
    const bucket = data[index];
    setSelectedBucket(prev => prev?.bucket === bucket.bucket ? null : bucket);
    setActiveIndex(index);
  }, [data]);

  return (
    <div className="flex gap-8 items-start flex-wrap">
      <div style={{ width: 320, height: 320 }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <InteractivePie
              data={data}
              cx="50%" cy="50%"
              innerRadius={70} outerRadius={110}
              dataKey="value"
              activeIndex={activeIndex ?? undefined}
              activeShape={renderActiveShape}
              onClick={onPieClick}
              onMouseEnter={(_: any, i: number) => setActiveIndex(i)}
              onMouseLeave={() => { if (!selectedBucket) setActiveIndex(null); }}
            >
              {data.map((entry) => (
                <Cell key={entry.bucket}
                  fill={BUCKET_COLORS[entry.bucket] || '#94a3b8'}
                  cursor="pointer" />
              ))}
            </InteractivePie>
            <InteractiveTooltip
              formatter={(val: any, _name: string, props: any) =>
                [`${val} member${Number(val) !== 1 ? 's' : ''} (${props.payload.pct}%)`, props.payload.bucket]
              }
            />
            <Legend
              formatter={(value) => (
                <span className="text-sm text-gray-700">{value} hrs</span>
              )}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/* Employee list on click */}
      <div className="flex-1 min-w-48">
        {selectedBucket ? (
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="font-semibold text-gray-800">
                <span className="inline-block w-3 h-3 rounded-full mr-2"
                  style={{ background: BUCKET_COLORS[selectedBucket.bucket] || '#94a3b8' }} />
                {selectedBucket.bucket} hrs — {selectedBucket.count} member{selectedBucket.count !== 1 ? 's' : ''}
              </h4>
              <button onClick={() => { setSelectedBucket(null); setActiveIndex(null); }}
                className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
            </div>
            <ul className="space-y-1">
              {selectedBucket.employees.map(name => (
                <li key={name} className="text-sm text-gray-700 flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs flex items-center justify-center font-medium">
                    {name.charAt(0).toUpperCase()}
                  </span>
                  {name}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="text-sm text-gray-400 pt-4">
            Click a segment to see team members in that bracket
          </div>
        )}

        {/* Bucket legend */}
        <div className="mt-4 space-y-1">
          {buckets.map(b => (
            <div key={b.bucket} className="flex items-center gap-2 text-xs text-gray-500">
              <span className="w-3 h-3 rounded-sm flex-shrink-0"
                style={{ background: BUCKET_COLORS[b.bucket] || '#94a3b8' }} />
              <span className="w-14">{b.bucket} hrs</span>
              <div className="flex-1 bg-gray-100 rounded-full h-1.5">
                <div className="h-1.5 rounded-full"
                  style={{ width: `${b.pct}%`, background: BUCKET_COLORS[b.bucket] || '#94a3b8' }} />
              </div>
              <span className="w-12 text-right">{b.count} ({b.pct}%)</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
