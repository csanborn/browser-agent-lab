import type { AgentEvent, RunStatus } from './events';

export interface RunSummary {
  runId: string;
  task: string;
  status: RunStatus;
  steps: number;
  durationMs: number;
  costUsd: number;
  interventions: number;
  startedAt: number;
}

export interface Metrics {
  runs: number;
  finished: number;
  successRate: number;
  avgSteps: number;
  avgDurationMs: number;
  totalCostUsd: number;
  approvalsRequested: number;
  approvalsDenied: number;
  interventions: number;
  outcomes: Partial<Record<RunStatus, number>>;
  recent: RunSummary[];
}

/** Folds a raw event stream (any order of runs, append-only) into the metrics view. */
export function aggregate(events: readonly AgentEvent[], recentLimit = 10): Metrics {
  const runs = new Map<string, RunSummary>();
  let approvalsRequested = 0;
  let approvalsDenied = 0;

  for (const event of events) {
    if (event.type === 'run_started') {
      runs.set(event.runId, {
        runId: event.runId,
        task: event.task,
        status: 'running',
        steps: 0,
        durationMs: 0,
        costUsd: 0,
        interventions: 0,
        startedAt: event.at,
      });
      continue;
    }
    const run = runs.get(event.runId);
    if (!run) continue;
    switch (event.type) {
      case 'approval_requested':
        approvalsRequested += 1;
        break;
      case 'approval_resolved':
        if (event.decision === 'denied') approvalsDenied += 1;
        if (event.by === 'user') run.interventions += 1;
        break;
      case 'intervention':
        run.interventions += 1;
        break;
      case 'run_finished':
        run.status = event.status;
        run.steps = event.steps;
        run.durationMs = event.durationMs;
        run.costUsd = event.costUsd;
        break;
      default:
        break;
    }
  }

  const all = [...runs.values()];
  const finished = all.filter((run) => run.status !== 'running');
  const outcomes: Partial<Record<RunStatus, number>> = {};
  for (const run of finished) outcomes[run.status] = (outcomes[run.status] ?? 0) + 1;
  const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);

  return {
    runs: all.length,
    finished: finished.length,
    successRate: finished.length ? (outcomes.succeeded ?? 0) / finished.length : 0,
    avgSteps: mean(finished.map((run) => run.steps)),
    avgDurationMs: mean(finished.map((run) => run.durationMs)),
    totalCostUsd: finished.reduce((sum, run) => sum + run.costUsd, 0),
    approvalsRequested,
    approvalsDenied,
    interventions: all.reduce((sum, run) => sum + run.interventions, 0),
    outcomes,
    recent: all.sort((a, b) => b.startedAt - a.startedAt).slice(0, recentLimit),
  };
}
