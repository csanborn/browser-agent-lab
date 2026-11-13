import { addUsage, EMPTY_USAGE, isTerminal, type AgentEvent, type AgentReport, type Limits, type Risk, type RunStatus, type Usage } from './events';

export interface StepView {
  step: number;
  action: string;
  label: string;
  reason: string;
  state: 'running' | 'awaiting_approval' | 'done' | 'failed' | 'declined';
  summary?: string;
  screenshot?: string;
  url?: string;
  ms?: number;
  retried?: boolean;
  approval?: { approvalId: string; risk: Risk; decision?: 'approved' | 'denied'; by?: 'user' | 'policy' };
}

export interface PendingApproval {
  approvalId: string;
  step: number;
  label: string;
  risk: Risk;
}

export interface RunView {
  runId: string | null;
  task: string;
  startUrl: string;
  model: string;
  status: RunStatus;
  limits: Limits | null;
  allowlist: string[];
  startedAt: number | null;
  lastEventAt: number | null;
  durationMs: number | null;
  steps: StepView[];
  pending: PendingApproval | null;
  usage: Usage;
  costUsd: number;
  turns: number;
  retrying: { attempt: number; reason: string; until: number } | null;
  report?: AgentReport;
  error?: string;
}

export const EMPTY_RUN: RunView = {
  runId: null,
  task: '',
  startUrl: '',
  model: '',
  status: 'running',
  limits: null,
  allowlist: [],
  startedAt: null,
  lastEventAt: null,
  durationMs: null,
  steps: [],
  pending: null,
  usage: EMPTY_USAGE,
  costUsd: 0,
  turns: 0,
  retrying: null,
};

function patchStep(steps: StepView[], step: number, patch: (s: StepView) => StepView): StepView[] {
  return steps.map((s) => (s.step === step ? patch(s) : s));
}

/**
 * Folds one event into the run's view. Pure, so the UI (useReducer), the server's
 * run list and the tests all share it. Events after the run finishes are ignored.
 */
export function reduceRun(view: RunView, event: AgentEvent): RunView {
  if (event.type === 'run_started') {
    return {
      ...EMPTY_RUN,
      runId: event.runId,
      task: event.task,
      startUrl: event.startUrl,
      model: event.model,
      limits: event.limits,
      allowlist: event.allowlist,
      startedAt: event.at,
      lastEventAt: event.at,
    };
  }
  if (view.runId !== event.runId || isTerminal(view.status)) return view;
  const next: RunView = { ...view, lastEventAt: event.at };

  switch (event.type) {
    case 'model_call':
      return { ...next, turns: next.turns + 1, usage: addUsage(next.usage, event.usage), costUsd: next.costUsd + event.costUsd, retrying: null };
    case 'model_retry':
      return { ...next, retrying: { attempt: event.attempt, reason: event.reason, until: event.at + event.delayMs } };
    case 'step_started':
      return {
        ...next,
        steps: [...next.steps, { step: event.step, action: event.action, label: event.label, reason: event.reason, state: 'running' }],
      };
    case 'step_finished':
      return {
        ...next,
        steps: patchStep(next.steps, event.step, (s) => ({
          ...s,
          state: s.state === 'declined' ? 'declined' : event.ok ? 'done' : 'failed',
          summary: event.summary,
          screenshot: event.screenshot ?? s.screenshot,
          url: event.url,
          ms: event.ms,
          retried: event.retried,
        })),
      };
    case 'approval_requested':
      return {
        ...next,
        status: next.status === 'paused' ? 'paused' : 'awaiting_approval',
        pending: { approvalId: event.approvalId, step: event.step, label: event.label, risk: event.risk },
        steps: patchStep(next.steps, event.step, (s) => ({ ...s, state: 'awaiting_approval', approval: { approvalId: event.approvalId, risk: event.risk } })),
      };
    case 'approval_resolved': {
      const step = next.steps.find((s) => s.approval?.approvalId === event.approvalId);
      return {
        ...next,
        status: next.status === 'awaiting_approval' ? 'running' : next.status,
        pending: next.pending?.approvalId === event.approvalId ? null : next.pending,
        steps: step
          ? patchStep(next.steps, step.step, (s) => ({
              ...s,
              state: event.decision === 'denied' ? 'declined' : 'running',
              approval: s.approval && { ...s.approval, decision: event.decision, by: event.by },
            }))
          : next.steps,
      };
    }
    case 'intervention':
      if (event.kind === 'pause') return { ...next, status: 'paused' };
      if (event.kind === 'resume') return { ...next, status: next.pending ? 'awaiting_approval' : 'running' };
      return next;
    case 'run_finished':
      return {
        ...next,
        status: event.status,
        durationMs: event.durationMs,
        usage: event.usage,
        costUsd: event.costUsd,
        report: event.report,
        error: event.error,
        pending: null,
        retrying: null,
        steps: next.steps.map((s) => (s.state === 'running' || s.state === 'awaiting_approval' ? { ...s, state: 'failed', summary: s.summary ?? 'Interrupted' } : s)),
      };
    default:
      return next;
  }
}

export function replay(events: readonly AgentEvent[]): RunView {
  return events.reduce(reduceRun, EMPTY_RUN);
}
