import type { RiskKind, RunStatus } from '../../shared/events';

export type Tone = 'info' | 'good' | 'warn' | 'bad' | 'neutral';

export const STATUS: Record<RunStatus, { label: string; tone: Tone }> = {
  running: { label: 'Working', tone: 'info' },
  paused: { label: 'Paused', tone: 'neutral' },
  awaiting_approval: { label: 'Needs your approval', tone: 'warn' },
  succeeded: { label: 'Done', tone: 'good' },
  not_possible: { label: "Couldn't be done", tone: 'warn' },
  step_limit: { label: 'Hit the step limit', tone: 'warn' },
  time_limit: { label: 'Hit the time limit', tone: 'warn' },
  budget_limit: { label: 'Hit the budget', tone: 'warn' },
  stopped: { label: 'Stopped', tone: 'neutral' },
  refused: { label: 'Model declined', tone: 'bad' },
  error: { label: 'Error', tone: 'bad' },
};

export const RISK: Record<RiskKind, string> = {
  off_allowlist: 'Leaves the allowed sites',
  form_submit: 'Submits a form',
  consequential: 'Hard to undo',
  sensitive_input: 'Sensitive field',
};

export function confidenceLevel(value: number): { label: string; tone: Tone; hint: string } {
  if (value >= 0.8) return { label: 'High confidence', tone: 'good', hint: 'Claude is sure of this answer.' };
  if (value >= 0.5) return { label: 'Medium confidence', tone: 'warn', hint: 'Worth a quick check.' };
  return { label: 'Low confidence', tone: 'bad', hint: 'Claude is unsure. Check the steps before relying on this.' };
}

export function duration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

export function compact(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n);
}
