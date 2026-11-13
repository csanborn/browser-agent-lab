import { useEffect, useState } from 'react';
import type { RunStatus } from '../../shared/events';
import type { Metrics } from '../../shared/metrics';
import { formatUsd } from '../../shared/pricing';
import { api, type EvalSummary } from '../api';
import { duration, STATUS } from '../state/format';
import { StatusPill } from './StatusPill';

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="tile">
      <span className="tile-label">{label}</span>
      <span className="tile-value">{value}</span>
      {note && <span className="tile-note">{note}</span>}
    </div>
  );
}

function Outcomes({ outcomes, total }: { outcomes: Metrics['outcomes']; total: number }) {
  const entries = (Object.entries(outcomes) as Array<[RunStatus, number]>).sort((a, b) => b[1] - a[1]);
  if (!total) return null;
  return (
    <div className="outcomes">
      <div className="outcome-bar" role="img" aria-label={entries.map(([s, n]) => `${STATUS[s].label}: ${n}`).join(', ')}>
        {entries.map(([status, n]) => (
          <span key={status} className={`seg tone-${STATUS[status].tone}`} style={{ flexGrow: n }} />
        ))}
      </div>
      <ul className="legend">
        {entries.map(([status, n]) => (
          <li key={status}>
            <span className={`swatch tone-${STATUS[status].tone}`} aria-hidden="true" />
            {STATUS[status].label} <strong>{n}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MetricsView() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [evals, setEvals] = useState<EvalSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let live = true;
    Promise.all([api.metrics(), api.evals()])
      .then(([m, e]) => {
        if (!live) return;
        setMetrics(m);
        setEvals(e);
        setError(null);
      })
      .catch((err: unknown) => live && setError(err instanceof Error ? err.message : 'Could not load metrics.'));
    return () => {
      live = false;
    };
  }, [version]);

  return (
    <div className="metrics">
      <div className="metrics-head">
        <h2>Metrics</h2>
        <button type="button" className="btn small" onClick={() => setVersion((v) => v + 1)}>
          Refresh
        </button>
      </div>
      <p className="hint">From the event log every run writes: task started, each step, interventions, and how it ended.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      {metrics && (
        <>
          <div className="tiles">
            <Tile label="Runs" value={String(metrics.runs)} note={`${metrics.finished} finished`} />
            <Tile label="Success rate" value={`${Math.round(metrics.successRate * 100)}%`} />
            <Tile label="Avg steps" value={metrics.avgSteps.toFixed(1)} />
            <Tile label="Avg time" value={duration(metrics.avgDurationMs)} />
            <Tile label="Spend" value={formatUsd(metrics.totalCostUsd)} />
            <Tile label="Approvals" value={String(metrics.approvalsRequested)} note={`${metrics.approvalsDenied} denied`} />
            <Tile label="Interventions" value={String(metrics.interventions)} note="pause, stop, approve, deny" />
          </div>
          <h3>Outcomes</h3>
          <Outcomes outcomes={metrics.outcomes} total={metrics.finished} />
          {metrics.recent.length > 0 && (
            <>
              <h3>Recent runs</h3>
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Task</th>
                    <th scope="col">Outcome</th>
                    <th scope="col" className="num">Steps</th>
                    <th scope="col" className="num">Time</th>
                    <th scope="col" className="num">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.recent.map((run) => (
                    <tr key={run.runId}>
                      <td>{run.task}</td>
                      <td>
                        <StatusPill status={run.status} />
                      </td>
                      <td className="num">{run.steps}</td>
                      <td className="num">{duration(run.durationMs)}</td>
                      <td className="num">{formatUsd(run.costUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
      {evals && (
        <>
          <h3>
            Latest eval: {evals.passed}/{evals.total} with {evals.model}
          </h3>
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Task</th>
                <th scope="col">Result</th>
                <th scope="col" className="num">Steps</th>
                <th scope="col" className="num">Time</th>
                <th scope="col" className="num">Cost</th>
              </tr>
            </thead>
            <tbody>
              {evals.results.map((r) => (
                <tr key={r.id}>
                  <td>
                    <span className="mono">{r.id}</span> <span className="muted">{r.skill}</span>
                  </td>
                  <td>{r.pass ? <span className="tag tone-good">pass</span> : <span className="tag tone-bad" title={r.why}>fail</span>}</td>
                  <td className="num">{r.steps}</td>
                  <td className="num">{duration(r.durationMs)}</td>
                  <td className="num">{formatUsd(r.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
