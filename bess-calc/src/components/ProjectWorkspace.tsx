import React, { useEffect, useState, useCallback } from 'react';
import {
  Project,
  Scenario,
  DatasetImportResult,
  SimulationResultRecord,
  ApiClientError,
  listProjects,
  createProject,
  importDataset,
  createScenario,
  createSimulation,
  waitForSimulation,
  getSimulationResults
} from '../api';
import {
  BessSystemInput,
  TariffInput,
  SolarInput,
  DieselInput,
  FinancialInput,
  DispatchPriorityType,
  CurrencySymbol
} from '../types/bess';

interface ProjectWorkspaceProps {
  currency: CurrencySymbol;
  system: BessSystemInput;
  tariff: TariffInput;
  diesel: DieselInput;
  solar: SolarInput;
  financial: FinancialInput;
  dispatchPriorities: DispatchPriorityType[];
}

type AsyncState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'success'; data: T };

function errorMessage(err: unknown): string {
  if (err instanceof ApiClientError) {
    return `${err.message}${err.details.length ? ' — ' + err.details.map(d => d.message).join('; ') : ''}`;
  }
  return err instanceof Error ? err.message : String(err);
}

/**
 * Persistence-backed project workflow: create/select a project, import a CSV dataset,
 * save the currently-configured scenario (whatever is set on the Quick/Interval tabs)
 * against it, then run a real simulation via the API and show its persisted results.
 *
 * This is deliberately additive: the existing Quick/Interval/Scenario/Comparison tabs
 * keep working exactly as before, entirely client-side, with no backend dependency -
 * this tab is where that same in-memory configuration gets saved and turned into a
 * reproducible, API-backed simulation run.
 */
export function ProjectWorkspace({ currency, system, tariff, diesel, solar, financial, dispatchPriorities }: ProjectWorkspaceProps) {
  const [projectsState, setProjectsState] = useState<AsyncState<Project[]>>({ status: 'idle' });
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectLocation, setNewProjectLocation] = useState('');
  const [createProjectState, setCreateProjectState] = useState<AsyncState<Project>>({ status: 'idle' });

  const [datasetState, setDatasetState] = useState<AsyncState<DatasetImportResult>>({ status: 'idle' });
  const [timezone, setTimezone] = useState('UTC');

  const [scenarioName, setScenarioName] = useState('Draft scenario');
  const [scenarioState, setScenarioState] = useState<AsyncState<Scenario>>({ status: 'idle' });

  const [simulationState, setSimulationState] = useState<AsyncState<SimulationResultRecord>>({ status: 'idle' });

  const loadProjects = useCallback(() => {
    setProjectsState({ status: 'loading' });
    listProjects()
      .then(data => setProjectsState({ status: 'success', data }))
      .catch(err => setProjectsState({ status: 'error', message: errorMessage(err) }));
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const selectedProject =
    projectsState.status === 'success' ? projectsState.data.find(p => p.id === selectedProjectId) ?? null : null;

  const handleCreateProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newProjectName.trim()) return;
    setCreateProjectState({ status: 'loading' });
    try {
      const project = await createProject({ name: newProjectName.trim(), location: newProjectLocation.trim() || undefined });
      setCreateProjectState({ status: 'success', data: project });
      setNewProjectName('');
      setNewProjectLocation('');
      setSelectedProjectId(project.id);
      loadProjects();
    } catch (err) {
      setCreateProjectState({ status: 'error', message: errorMessage(err) });
    }
  };

  const handleFileUpload = async (file: File) => {
    if (!selectedProjectId) return;
    setDatasetState({ status: 'loading' });
    try {
      const csvText = await file.text();
      const result = await importDataset({
        projectId: selectedProjectId,
        csvText,
        tariffTimezone: timezone,
        sourceFile: file.name
      });
      setDatasetState({ status: 'success', data: result });
    } catch (err) {
      setDatasetState({ status: 'error', message: errorMessage(err) });
    }
  };

  const handleSaveScenario = async () => {
    if (!selectedProjectId) return;
    setScenarioState({ status: 'loading' });
    try {
      const datasetId = datasetState.status === 'success' ? datasetState.data.datasetId : undefined;
      const scenario = await createScenario(selectedProjectId, {
        name: scenarioName,
        intervalDatasetId: datasetId,
        batteryConfig: system,
        tariffConfig: tariff,
        solarConfig: solar,
        generatorConfig: diesel,
        financialConfig: financial,
        dispatchPriorities
      });
      setScenarioState({ status: 'success', data: scenario });
      setSimulationState({ status: 'idle' });
    } catch (err) {
      setScenarioState({ status: 'error', message: errorMessage(err) });
    }
  };

  const handleRunSimulation = async () => {
    if (scenarioState.status !== 'success') return;
    setSimulationState({ status: 'loading' });
    try {
      const created = await createSimulation(scenarioState.data.id);
      const run = await waitForSimulation(created.simulationId);
      if (run.status === 'failed') {
        throw new Error(run.errorMessage ?? 'Simulation failed with no error message');
      }
      const results = await getSimulationResults(created.simulationId);
      setSimulationState({ status: 'success', data: results });
    } catch (err) {
      setSimulationState({ status: 'error', message: errorMessage(err) });
    }
  };

  const canSaveScenario = Boolean(selectedProjectId);
  const canRunSimulation = scenarioState.status === 'success' && Boolean(scenarioState.data.intervalDatasetId);

  return (
    <div className="space-y-6">
      <section className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-4">
        <h2 className="text-lg font-semibold text-slate-100">Projects</h2>

        <form onSubmit={handleCreateProject} className="flex flex-wrap gap-2 items-end">
          <div className="flex flex-col">
            <label className="text-xs text-slate-400">Project name</label>
            <input
              className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-slate-100"
              value={newProjectName}
              onChange={e => setNewProjectName(e.target.value)}
              placeholder="e.g. Acme Warehouse BESS"
            />
          </div>
          <div className="flex flex-col">
            <label className="text-xs text-slate-400">Location (optional)</label>
            <input
              className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-slate-100"
              value={newProjectLocation}
              onChange={e => setNewProjectLocation(e.target.value)}
              placeholder="e.g. Pune, IN"
            />
          </div>
          <button
            type="submit"
            disabled={!newProjectName.trim() || createProjectState.status === 'loading'}
            className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm px-3 py-1.5 rounded"
          >
            {createProjectState.status === 'loading' ? 'Creating…' : 'Create project'}
          </button>
        </form>
        {createProjectState.status === 'error' && (
          <p className="text-xs text-red-400">{createProjectState.message}</p>
        )}

        {projectsState.status === 'loading' && <p className="text-sm text-slate-400">Loading projects…</p>}
        {projectsState.status === 'error' && (
          <p className="text-sm text-red-400">
            Could not load projects: {projectsState.message}. Is the API server running (pnpm dev:server) and
            DATABASE_URL configured?
          </p>
        )}
        {projectsState.status === 'success' && (
          <ul className="divide-y divide-slate-800">
            {projectsState.data.length === 0 && <li className="text-sm text-slate-400 py-2">No projects yet.</li>}
            {projectsState.data.map(project => (
              <li key={project.id} className="py-2 flex items-center justify-between">
                <button
                  onClick={() => setSelectedProjectId(project.id)}
                  className={`text-sm text-left flex-1 ${project.id === selectedProjectId ? 'text-emerald-400 font-medium' : 'text-slate-200'}`}
                >
                  {project.name}
                  {project.location && <span className="text-slate-500"> — {project.location}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {selectedProject && (
        <section className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-4">
          <h2 className="text-lg font-semibold text-slate-100">Load dataset — {selectedProject.name}</h2>
          <div className="flex flex-wrap gap-2 items-end">
            <div className="flex flex-col">
              <label className="text-xs text-slate-400">Dataset timezone (IANA name)</label>
              <input
                className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-slate-100"
                value={timezone}
                onChange={e => setTimezone(e.target.value)}
                placeholder="Asia/Kolkata"
              />
            </div>
            <div className="flex flex-col">
              <label className="text-xs text-slate-400">CSV file (timestamp,load_kw,solar_kw,...)</label>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={e => e.target.files?.[0] && handleFileUpload(e.target.files[0])}
                className="text-sm text-slate-300"
              />
            </div>
          </div>

          {datasetState.status === 'loading' && <p className="text-sm text-slate-400">Importing…</p>}
          {datasetState.status === 'error' && <p className="text-sm text-red-400">{datasetState.message}</p>}
          {datasetState.status === 'success' && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <Stat label="Accepted rows" value={String(datasetState.data.summary.acceptedRows)} />
              <Stat label="Interval length" value={`${datasetState.data.summary.intervalDurationMinutes ?? '—'} min`} />
              <Stat label="Start" value={datasetState.data.summary.startTimestamp?.slice(0, 10) ?? '—'} />
              <Stat label="End" value={datasetState.data.summary.endTimestamp?.slice(0, 10) ?? '—'} />
              <Stat label="Peak load" value={datasetState.data.summary.peakLoadKw !== undefined ? `${datasetState.data.summary.peakLoadKw.toFixed(1)} kW` : '—'} />
              <Stat label="Energy" value={datasetState.data.summary.totalLoadEnergyKwh !== undefined ? `${datasetState.data.summary.totalLoadEnergyKwh.toFixed(0)} kWh` : '—'} />
              <Stat label="Solar contribution" value={datasetState.data.summary.solarContributionPct !== undefined ? `${datasetState.data.summary.solarContributionPct.toFixed(1)}%` : '—'} />
              <Stat label="Engineering grade" value={datasetState.data.summary.engineeringGrade ? 'Yes' : 'No'} />
            </div>
          )}
        </section>
      )}

      {selectedProject && (
        <section className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-4">
          <h2 className="text-lg font-semibold text-slate-100">Save scenario</h2>
          <p className="text-xs text-slate-400">
            Saves the battery/tariff/solar/generator/financial configuration currently set on the Quick/Interval
            tabs, attached to the dataset imported above (if any).
          </p>
          <div className="flex flex-wrap gap-2 items-end">
            <div className="flex flex-col">
              <label className="text-xs text-slate-400">Scenario name</label>
              <input
                className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-sm text-slate-100"
                value={scenarioName}
                onChange={e => setScenarioName(e.target.value)}
              />
            </div>
            <button
              onClick={handleSaveScenario}
              disabled={!canSaveScenario || scenarioState.status === 'loading'}
              className="bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-sm px-3 py-1.5 rounded"
            >
              {scenarioState.status === 'loading' ? 'Saving…' : 'Save scenario'}
            </button>
          </div>
          {scenarioState.status === 'error' && <p className="text-sm text-red-400">{scenarioState.message}</p>}
          {scenarioState.status === 'success' && (
            <p className="text-sm text-emerald-400">Saved scenario "{scenarioState.data.name}" (id: {scenarioState.data.id.slice(0, 8)}…)</p>
          )}

          {scenarioState.status === 'success' && (
            <div className="pt-2 border-t border-slate-800 space-y-2">
              <button
                onClick={handleRunSimulation}
                disabled={!canRunSimulation || simulationState.status === 'loading'}
                className="bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-sm px-3 py-1.5 rounded"
              >
                {simulationState.status === 'loading' ? 'Running…' : 'Run simulation'}
              </button>
              {!canRunSimulation && (
                <p className="text-xs text-amber-400">Import a dataset above before running a simulation.</p>
              )}
            </div>
          )}
        </section>
      )}

      {simulationState.status === 'error' && (
        <section className="bg-slate-900 border border-red-900 rounded-lg p-4">
          <p className="text-sm text-red-400">Simulation failed: {simulationState.message}</p>
        </section>
      )}

      {simulationState.status === 'success' && (
        <section className="bg-slate-900 border border-slate-800 rounded-lg p-4 space-y-3">
          <h2 className="text-lg font-semibold text-slate-100">Simulation results</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <Stat label="Peak reduction" value={`${simulationState.data.peakReductionKw.toFixed(1)} kW`} />
            <Stat label="Total savings / yr" value={`${currency}${simulationState.data.totalSavings.toLocaleString()}`} />
            <Stat label="NPV" value={`${currency}${simulationState.data.npv.toLocaleString()}`} />
            <Stat label="IRR" value={simulationState.data.irr !== null ? `${simulationState.data.irr.toFixed(1)}%` : 'n/a'} />
            <Stat label="ROI (lifetime)" value={`${simulationState.data.financialResult.roiPct.toFixed(0)}%`} />
            <Stat label="Simple payback" value={simulationState.data.financialResult.simplePaybackYears !== null ? `${simulationState.data.financialResult.simplePaybackYears} yr` : 'n/a'} />
            <Stat label="LCOS" value={`${currency}${simulationState.data.financialResult.lcoePerKwh.toFixed(2)}/kWh`} />
          </div>
          {simulationState.data.warnings.length > 0 && (
            <div className="pt-2 border-t border-slate-800">
              <p className="text-xs text-slate-400 mb-1">{simulationState.data.warnings.length} validation warning(s):</p>
              <ul className="text-xs text-amber-400 space-y-0.5 list-disc list-inside">
                {simulationState.data.warnings.slice(0, 5).map(w => (
                  <li key={w.id}>{w.message}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-slate-800/60 rounded px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className="text-slate-100 font-medium">{value}</div>
    </div>
  );
}
