import React, { useEffect, useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import photonIcon from '../assets/icons/photon.png';

type Provider = 'photon' | 'boots';
type FlowType = 'onboarding' | 'offboarding';

interface ResourceForm {
  projectId: string;
  employeeId: string;
  fullName: string;
  email: string;
  location: string;
  role: string;
  startDate: string;
}

interface PipelineRecord extends ResourceForm {
  id: string;
  provider: Provider;
  flowType: FlowType;
  steps: Record<string, boolean>;
  createdAt: string;
  odcEroomUrl?: string;
  odcEmailSent?: boolean;
}

const providerTabs = [
  { id: 'photon' as Provider, label: 'Photon', path: '/onboarding/photon', logo: photonIcon },
  { id: 'boots' as Provider, label: 'Boots', path: '/onboarding/boots', logo: 'https://www.boots.com/favicon.ico' },
];

const photonProjects = [
  { value: '12667 - Mobile App\'23', label: "12667 - Mobile App'23" },
  { value: '13755 - Mobile App Condor Squad', label: '13755 - Mobile App Condor Squad' },
];

const workflowSteps: Record<Provider, Record<FlowType, string[]>> = {
  photon: {
    onboarding: [
      'ODC completion',
      'Compliance certificate completed',
      'Compliance team approved the eRoom JIRA',
      'System wipeout',
      'Enter into ODC',
    ],
    offboarding: [
      'eRoom ticket raised and approved',
    ],
  },
  boots: {
    onboarding: [
      'DWP request raised',
      'Approved by Laura',
      'Approved by Fleur',
      'Team confirmed by pinging from Boots ID in MS Teams',
      'VDI request raised',
      'KeyedIn raised',
      'JIRA access raised',
      'ADO access raised',
      'Manager added the resource under the appropriate group in MS Teams',
    ],
    offboarding: [
      'Leaver request raised and approved',
    ],
  },
};

// Steps that should open an external URL when clicked.
const stepLinks: Record<string, string> = {
  'ODC completion': 'https://photon.atlassian.net/jira/core/projects/BOOTSEROOM/board?filter=&groupBy=none',
};

const emptyForm: ResourceForm = {
  projectId: photonProjects[0].value,
  employeeId: '',
  fullName: '',
  email: '',
  location: '',
  role: '',
  startDate: '',
};

function stepState(steps: string[]) {
  return Object.fromEntries(steps.map(step => [step, false]));
}

function completionPercent(record: PipelineRecord) {
  const steps = workflowSteps[record.provider][record.flowType];
  const done = steps.filter(step => record.steps[step]).length;
  return steps.length ? Math.round((done / steps.length) * 100) : 0;
}

function parsePastedResource(value: string): Partial<ResourceForm> {
  const parts = value
    .split(/[\t,\n]+/)
    .map(part => part.trim())
    .filter(Boolean);

  return {
    employeeId: parts[0] || '',
    fullName: parts[1] || '',
    email: parts[2] || '',
    location: parts[3] || '',
    role: parts[4] || '',
    startDate: parts[5] || '',
  };
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="text-xs font-medium text-gray-600">
      {label}
      {children}
    </label>
  );
}

export default function Onboarding() {
  const { user } = useAuth();
  const isViewer = user?.role === 'viewer';
  const location = useLocation();
  const provider: Provider = location.pathname.includes('/boots') ? 'boots' : 'photon';
  const [flowType, setFlowType] = useState<FlowType>('onboarding');
  const [form, setForm] = useState<ResourceForm>(emptyForm);
  const [pasteValue, setPasteValue] = useState('');
  const [records, setRecords] = useState<PipelineRecord[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('swami-onboarding-pipelines') || '[]');
    } catch {
      return [];
    }
  });

  const steps = workflowSteps[provider][flowType];
  const filteredRecords = useMemo(
    () => records.filter(record => record.provider === provider && record.flowType === flowType),
    [records, provider, flowType]
  );

  useEffect(() => {
    localStorage.setItem('swami-onboarding-pipelines', JSON.stringify(records));
  }, [records]);

  useEffect(() => {
    setForm(current => ({ ...current, projectId: photonProjects[0].value }));
    setPasteValue('');
  }, [provider, flowType]);

  const updateForm = (field: keyof ResourceForm, value: string) => {
    setForm(current => ({ ...current, [field]: value }));
  };

  const applyPaste = () => {
    if (isViewer) return;
    setForm(current => ({ ...current, ...parsePastedResource(pasteValue) }));
  };

  const saveRecord = (event: React.FormEvent) => {
    event.preventDefault();
    if (isViewer) return;
    if (!form.employeeId.trim() || !form.fullName.trim() || !form.email.trim()) return;

    const record: PipelineRecord = {
      ...form,
      id: `${Date.now()}`,
      provider,
      flowType,
      projectId: provider === 'photon' && flowType === 'onboarding' ? form.projectId : '',
      steps: stepState(steps),
      createdAt: new Date().toISOString(),
    };

    setRecords(current => [record, ...current]);
    setForm({ ...emptyForm, projectId: photonProjects[0].value });
    setPasteValue('');
  };

  const toggleStep = (recordId: string, step: string) => {
    if (isViewer) return;
    setRecords(current => current.map(record => (
      record.id === recordId
        ? { ...record, steps: { ...record.steps, [step]: !record.steps[step] } }
        : record
    )));
  };

  const updateRecordField = <K extends keyof PipelineRecord>(recordId: string, field: K, value: PipelineRecord[K]) => {
    if (isViewer) return;
    setRecords(current => current.map(record =>
      record.id === recordId ? { ...record, [field]: value } : record
    ));
  };

  const removeRecord = (recordId: string) => {
    if (isViewer) return;
    setRecords(current => current.filter(record => record.id !== recordId));
  };

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">Onboarding</h1>

      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg mb-6 w-fit">
        {providerTabs.map(tab => (
          <Link
            key={tab.id}
            to={tab.path}
            className={`px-5 py-2 rounded-md text-sm font-medium transition flex items-center gap-2
              ${provider === tab.id ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}
          >
            <img
              src={tab.logo}
              alt=""
              className="h-5 w-5 object-contain rounded-sm"
              referrerPolicy="no-referrer"
              onError={event => { event.currentTarget.style.display = 'none'; }}
            />
            <span>{tab.label}</span>
          </Link>
        ))}
      </div>

      <div className="flex gap-2 mb-8">
        {(['onboarding', 'offboarding'] as FlowType[]).map(type => (
          <button
            key={type}
            type="button"
            onClick={() => setFlowType(type)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition border
              ${flowType === type ? 'bg-blue-700 text-white border-blue-700' : 'bg-white text-gray-700 border-gray-200 hover:border-blue-500 hover:text-blue-700'}`}
          >
            {type === 'onboarding' ? 'Onboarding' : 'Offboarding'}
          </button>
        ))}
      </div>

      <div className={`grid grid-cols-1 ${isViewer ? '' : 'xl:grid-cols-[420px_minmax(0,1fr)]'} gap-6`}>
        {!isViewer && <form onSubmit={saveRecord} className="bg-white rounded-xl border border-gray-200 p-6 h-fit">
          <h2 className="font-semibold text-gray-800 mb-1">
            Add {provider === 'photon' ? 'Photon' : 'Boots'} {flowType === 'onboarding' ? 'Developer' : 'Leaver'}
          </h2>
          <p className="text-xs text-gray-500 mb-5">
            Paste employee details from a row, or fill the fields directly.
          </p>

          <div className="space-y-4">
            <Field label="Paste row: emp id, name, email, location, role, start date">
              <textarea
                value={pasteValue}
                onChange={event => setPasteValue(event.target.value)}
                rows={3}
                className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700"
                placeholder="17463, Swami K, swami@example.com, Chennai, Developer, 2026-07-13"
              />
            </Field>
            <button
              type="button"
              onClick={applyPaste}
              className="text-sm px-3 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-50 transition"
            >
              Apply pasted details
            </button>

            {provider === 'photon' && flowType === 'onboarding' && (
              <Field label="Project ID">
                <select
                  value={form.projectId}
                  onChange={event => updateForm('projectId', event.target.value)}
                  className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700"
                >
                  {photonProjects.map(project => (
                    <option key={project.value} value={project.value}>{project.label}</option>
                  ))}
                </select>
              </Field>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Employee ID">
                <input value={form.employeeId} onChange={event => updateForm('employeeId', event.target.value)} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700" required />
              </Field>
              <Field label="Name">
                <input value={form.fullName} onChange={event => updateForm('fullName', event.target.value)} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700" required />
              </Field>
              <Field label="Email ID">
                <input type="email" value={form.email} onChange={event => updateForm('email', event.target.value)} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700" required />
              </Field>
              <Field label="Location">
                <input value={form.location} onChange={event => updateForm('location', event.target.value)} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700" />
              </Field>
              <Field label="Role">
                <input value={form.role} onChange={event => updateForm('role', event.target.value)} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700" />
              </Field>
              <Field label="Start Date">
                <input type="date" value={form.startDate} onChange={event => updateForm('startDate', event.target.value)} className="mt-1 w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700" />
              </Field>
            </div>

            <button type="submit" className="w-full bg-blue-700 hover:bg-blue-800 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition">
              Add to workflow
            </button>
          </div>
        </form>}

        <section className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-200 p-6">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between mb-5">
              <div>
                <h2 className="font-semibold text-gray-800">
                  {provider === 'photon' ? 'Photon' : 'Boots'} {flowType === 'onboarding' ? 'Onboarding' : 'Offboarding'} Workflow
                </h2>
                <p className="text-xs text-gray-500">{isViewer ? 'Viewer access shows workflow status only.' : 'Use each workflow button to mark the step completed.'}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full">
                  {filteredRecords.length} active
                </span>
                {!isViewer && filteredRecords.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm(`Remove ALL ${filteredRecords.length} record(s) in this view? This cannot be undone.`)) {
                        setRecords(current =>
                          current.filter(r => !(r.provider === provider && r.flowType === flowType))
                        );
                      }
                    }}
                    className="text-xs text-red-500 hover:text-red-700 border border-red-200 hover:border-red-400 rounded-md px-2 py-1 transition"
                  >
                    Clear all
                  </button>
                )}
              </div>
            </div>

            {filteredRecords.length === 0 ? (
              <div className="border border-dashed border-gray-300 rounded-xl p-8 text-center text-sm text-gray-500">
                No {flowType} records yet.
              </div>
            ) : (
              <div className="space-y-4">
                {filteredRecords.map(record => {
                  const percent = completionPercent(record);
                  const recordSteps = workflowSteps[record.provider][record.flowType];
                  return (
                    <div key={record.id} className="border border-gray-200 rounded-xl p-4 bg-gray-50/50">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between mb-4">
                        <div>
                          <h3 className="font-semibold text-gray-900">{record.fullName}</h3>
                          <p className="text-xs text-gray-500">
                            {record.employeeId} · {record.email} {record.location && `· ${record.location}`} {record.role && `· ${record.role}`}
                          </p>
                          {record.projectId && <p className="text-xs text-blue-700 mt-1">{record.projectId}</p>}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded-full">{percent}% complete</span>
                          {!isViewer && <button type="button" onClick={() => removeRecord(record.id)} className="text-xs text-gray-400 hover:text-red-600 transition">Remove</button>}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
                        {recordSteps.map(step => {
                          const completed = Boolean(record.steps[step]);
                          const stepUrl = stepLinks[step];
                          return (
                            <button
                              key={step}
                              type="button"
                              onClick={() => {
                                if (!isViewer) toggleStep(record.id, step);
                                if (stepUrl) window.open(stepUrl, '_blank', 'noopener,noreferrer');
                              }}
                              disabled={isViewer && !stepUrl}
                              className={`text-left rounded-lg border px-3 py-2 text-sm transition
                                ${completed ? 'border-green-200 bg-green-100 text-green-800' : 'border-gray-200 bg-white text-gray-700'} ${isViewer && !stepUrl ? 'cursor-default' : 'hover:border-blue-500 hover:text-blue-700'}`}
                            >
                              <span className="font-medium">{completed ? 'Done' : 'Pending'}</span>
                              {stepUrl && <span className="ml-1 text-xs opacity-60">↗</span>}
                              <span className="block text-xs mt-0.5 opacity-80">{step}</span>
                            </button>
                          );
                        })}
                      </div>

                      {/* ODC details — shown only for Photon onboarding records */}
                      {record.provider === 'photon' && record.flowType === 'onboarding' && (
                        <div className="mt-4 pt-4 border-t border-gray-200 flex flex-col sm:flex-row sm:items-end gap-3">
                          <div className="flex-1">
                            <label className="block text-xs font-medium text-gray-600 mb-1">Boots eRoom URL</label>
                            <input
                              type="url"
                              value={record.odcEroomUrl || ''}
                              onChange={e => updateRecordField(record.id, 'odcEroomUrl', e.target.value)}
                              disabled={isViewer}
                              placeholder="https://allianceboots.atlassian.net/..."
                              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm text-gray-700 disabled:bg-gray-50"
                            />
                          </div>
                          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none pb-2">
                            <input
                              type="checkbox"
                              checked={Boolean(record.odcEmailSent)}
                              onChange={e => updateRecordField(record.id, 'odcEmailSent', e.target.checked)}
                              disabled={isViewer}
                              className="w-4 h-4 accent-blue-700"
                            />
                            Email sent to employee
                          </label>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}