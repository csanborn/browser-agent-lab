import { useCallback, useEffect, useState } from 'react';
import { isTerminal } from '../shared/events';
import type { RunView } from '../shared/run-view';
import { api, type AppConfig } from './api';
import { ApprovalCard } from './components/ApprovalCard';
import { LiveView } from './components/LiveView';
import { MetricsView } from './components/MetricsView';
import { ReportCard } from './components/ReportCard';
import { RunHeader } from './components/RunHeader';
import { RunList } from './components/RunList';
import { TaskComposer } from './components/TaskComposer';
import { Timeline } from './components/Timeline';
import { useNow } from './state/useNow';
import { useRun } from './state/useRun';
import { useShortcuts } from './state/useShortcuts';

type Tab = 'run' | 'metrics';

export function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('run');
  const [runId, setRunId] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunView[]>([]);
  const [selectedStep, setSelectedStep] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const view = useRun(runId);
  const active = Boolean(view.runId) && !isTerminal(view.status);
  const now = useNow(active);

  useEffect(() => {
    api.config().then(setConfig, (err: unknown) => setConfigError(err instanceof Error ? err.message : 'The API is not reachable.'));
  }, []);

  // Keep the session's run list in step with the open run's status.
  useEffect(() => {
    let live = true;
    api.runs().then((list) => live && setRuns(list), () => undefined);
    return () => {
      live = false;
    };
  }, [view.runId, view.status]);

  const act = useCallback(
    async (work: () => Promise<unknown>) => {
      setActionError(null);
      try {
        await work();
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'That did not work.');
      }
    },
    [],
  );

  const start = async (task: string, startUrl: string) => {
    const { id } = await api.start(task, startUrl);
    setSelectedStep(null);
    setRunId(id);
    setTab('run');
  };

  const pause = () => runId && act(() => api.control(runId, 'pause'));
  const resume = () => runId && act(() => api.control(runId, 'resume'));
  const stop = () => runId && act(() => api.control(runId, 'stop'));
  const decide = (decision: 'approved' | 'denied') => runId && view.pending && act(() => api.decide(runId, view.pending!.approvalId, decision));

  useShortcuts({
    p: active ? () => void (view.status === 'paused' ? resume() : pause()) : undefined,
    'shift+s': active ? () => void stop() : undefined,
    a: view.pending ? () => void decide('approved') : undefined,
    d: view.pending ? () => void decide('denied') : undefined,
    '/': () => document.getElementById('task')?.focus(),
  });

  return (
    <div className="app">
      <a className="skip" href="#main">
        Skip to the run
      </a>
      <header className="topbar">
        <div className="brand">
          <img src="/favicon.svg" alt="" width={24} height={24} />
          <span>Browser Agent Lab</span>
        </div>
        <nav className="tabs" role="tablist" aria-label="Views">
          <button type="button" role="tab" aria-selected={tab === 'run'} aria-controls="main" onClick={() => setTab('run')}>
            Run
          </button>
          <button type="button" role="tab" aria-selected={tab === 'metrics'} aria-controls="main" onClick={() => setTab('metrics')}>
            Metrics
          </button>
        </nav>
        {config && (
          <span className={`mode tone-${config.mode === 'claude' ? 'info' : 'warn'}`}>
            {config.mode === 'claude' ? `${config.model} · effort ${config.effort}` : 'Demo mode: scripted agent'}
          </span>
        )}
      </header>

      {configError && (
        <p className="banner tone-bad" role="alert">
          {configError} Start the API with <code>npm run dev</code>.
        </p>
      )}

      {tab === 'metrics' ? (
        <main id="main" className="metrics-page" role="tabpanel">
          <MetricsView />
        </main>
      ) : (
        <div className="layout">
          <aside className="sidebar">
            {config && <TaskComposer presets={config.presets} demo={config.mode === 'demo'} defaultUrl={`${config.fixturesOrigin}/`} onStart={start} />}
            <RunList runs={runs} current={runId} onOpen={(id) => { setSelectedStep(null); setRunId(id); }} />
          </aside>

          <main id="main" className="run" role="tabpanel">
            {view.runId ? (
              <>
                <RunHeader view={view} now={now} onPause={() => void pause()} onResume={() => void resume()} onStop={() => void stop()} />
                {actionError && (
                  <p className="banner tone-bad" role="alert">
                    {actionError}
                  </p>
                )}
                {view.pending && <ApprovalCard pending={view.pending} onDecide={(d) => void decide(d)} />}
                <ReportCard view={view} />
                <Timeline steps={view.steps} selected={selectedStep} onSelect={setSelectedStep} />
              </>
            ) : (
              <div className="welcome">
                <h1>Give the agent a task. Watch every step.</h1>
                <p>
                  Claude drives a real Chromium browser. Each step shows what it did, why, and the page it left behind. You can pause or stop at any point, and anything risky (submitting a form, buying, leaving the allowed site)
                  waits for your approval.
                </p>
                <ul className="keys">
                  <li>
                    <kbd>/</kbd> focus the task box
                  </li>
                  <li>
                    <kbd>P</kbd> pause or resume
                  </li>
                  <li>
                    <kbd>A</kbd> / <kbd>D</kbd> approve or deny
                  </li>
                  <li>
                    <kbd>⇧S</kbd> stop
                  </li>
                </ul>
              </div>
            )}
          </main>

          <aside className="viewer">
            <LiveView view={view} selected={selectedStep} onLive={() => setSelectedStep(null)} />
          </aside>
        </div>
      )}
      <p className="sr-only" role="status" aria-live="polite">
        {view.runId ? `Run ${view.status.replace('_', ' ')}. ${view.steps.length} steps.` : ''}
      </p>
    </div>
  );
}
