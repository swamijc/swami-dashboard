import React, { useState } from 'react';

interface Props {
  label: string;
  onRun: (dryRun: boolean) => Promise<void>;
  disabled?: boolean;
}

export default function RunButton({ label, onRun, disabled }: Props) {
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<string>('');

  const execute = async (dryRun: boolean) => {
    setState('running'); setResult('');
    try {
      await onRun(dryRun);
      setState('done');
      setResult(dryRun ? 'Dry run complete — no data submitted.' : 'Submitted successfully.');
    } catch (err: any) {
      setState('error');
      setResult(err?.response?.data?.error || err.message || 'Failed');
    }
    setTimeout(() => setState('idle'), 5000);
  };

  const base = 'px-4 py-2 rounded-lg text-sm font-medium transition disabled:opacity-40';

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <button
          onClick={() => execute(false)}
          disabled={disabled || state === 'running'}
          className={`${base} bg-blue-700 hover:bg-blue-800 text-white`}
        >
          {state === 'running' ? '⟳ Running…' : `▶ ${label}`}
        </button>
        <button
          onClick={() => execute(true)}
          disabled={disabled || state === 'running'}
          className={`${base} border border-gray-300 hover:bg-gray-50 text-gray-700`}
        >
          Dry Run
        </button>
      </div>
      {result && (
        <div className={`text-xs px-3 py-1.5 rounded ${state === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200'}`}>
          {result}
        </div>
      )}
    </div>
  );
}
