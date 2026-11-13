// Event contract shared by the harness, the server, the eval runner and the UI.
// Every run is a flat, append-only list of these events. The UI rebuilds its view
// from them, the server streams them over SSE and the metrics view aggregates them.

export type RunStatus =
  | 'running'
  | 'paused'
  | 'awaiting_approval'
  | 'succeeded'
  | 'not_possible'
  | 'step_limit'
  | 'time_limit'
  | 'budget_limit'
  | 'stopped'
  | 'refused'
  | 'error';

export const TERMINAL_STATUSES: readonly RunStatus[] = [
  'succeeded',
  'not_possible',
  'step_limit',
  'time_limit',
  'budget_limit',
  'stopped',
  'refused',
  'error',
];

export function isTerminal(status: RunStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

export const EMPTY_USAGE: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
  };
}

export interface Limits {
  maxSteps: number;
  maxDurationMs: number;
  maxCostUsd: number;
}

export type RiskKind = 'off_allowlist' | 'form_submit' | 'consequential' | 'sensitive_input';

export interface Risk {
  kind: RiskKind;
  reason: string;
}

/** What the agent says when it calls report_result. */
export interface AgentReport {
  status: 'done' | 'not_possible';
  answer: string;
  confidence: number;
}

interface Base {
  runId: string;
  at: number;
}

export type AgentEvent =
  | (Base & {
      type: 'run_started';
      task: string;
      startUrl: string;
      model: string;
      limits: Limits;
      allowlist: string[];
    })
  | (Base & { type: 'model_call'; turn: number; ms: number; usage: Usage; costUsd: number })
  | (Base & { type: 'model_retry'; attempt: number; delayMs: number; reason: string })
  | (Base & {
      type: 'step_started';
      step: number;
      action: string;
      label: string;
      reason: string;
    })
  | (Base & {
      type: 'step_finished';
      step: number;
      ok: boolean;
      summary: string;
      ms: number;
      url: string;
      screenshot?: string;
      retried?: boolean;
    })
  | (Base & { type: 'approval_requested'; step: number; approvalId: string; risk: Risk; label: string })
  | (Base & {
      type: 'approval_resolved';
      approvalId: string;
      decision: 'approved' | 'denied';
      by: 'user' | 'policy';
    })
  | (Base & { type: 'intervention'; kind: 'pause' | 'resume' | 'stop' })
  | (Base & {
      type: 'run_finished';
      status: RunStatus;
      steps: number;
      durationMs: number;
      usage: Usage;
      costUsd: number;
      report?: AgentReport;
      error?: string;
    });

export type AgentEventType = AgentEvent['type'];

/** Removes the shared fields so emitters only supply what is specific to the event. */
export type EventInput = AgentEvent extends infer E ? (E extends AgentEvent ? Omit<E, 'runId' | 'at'> : never) : never;
