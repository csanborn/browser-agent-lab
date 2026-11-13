import { describe, expect, it } from 'vitest';
import { EMPTY_USAGE, type AgentEvent } from './events';
import { aggregate } from './metrics';

const limits = { maxSteps: 10, maxDurationMs: 1000, maxCostUsd: 1 };
const started = (runId: string, at: number): AgentEvent => ({ type: 'run_started', runId, at, task: `task ${runId}`, startUrl: 'http://x', model: 'm', limits, allowlist: [] });
const finished = (runId: string, status: 'succeeded' | 'error', steps: number, costUsd: number): AgentEvent => ({
  type: 'run_finished',
  runId,
  at: 10,
  status,
  steps,
  durationMs: steps * 1000,
  usage: EMPTY_USAGE,
  costUsd,
});

describe('aggregate', () => {
  it('computes success rate, averages and spend over finished runs', () => {
    const metrics = aggregate([
      started('a', 1),
      finished('a', 'succeeded', 4, 0.1),
      started('b', 2),
      finished('b', 'error', 2, 0.05),
      started('c', 3),
    ]);
    expect(metrics).toMatchObject({ runs: 3, finished: 2, successRate: 0.5, avgSteps: 3, avgDurationMs: 3000, outcomes: { succeeded: 1, error: 1 } });
    expect(metrics.totalCostUsd).toBeCloseTo(0.15);
    expect(metrics.recent.map((r) => r.runId)).toEqual(['c', 'b', 'a']);
  });

  it('counts interventions and approvals', () => {
    const metrics = aggregate([
      started('a', 1),
      { type: 'intervention', runId: 'a', at: 2, kind: 'pause' },
      { type: 'approval_requested', runId: 'a', at: 3, step: 1, approvalId: 'a:1', label: 'x', risk: { kind: 'form_submit', reason: 'y' } },
      { type: 'approval_resolved', runId: 'a', at: 4, approvalId: 'a:1', decision: 'denied', by: 'user' },
      { type: 'approval_requested', runId: 'a', at: 5, step: 2, approvalId: 'a:2', label: 'x', risk: { kind: 'form_submit', reason: 'y' } },
      { type: 'approval_resolved', runId: 'a', at: 6, approvalId: 'a:2', decision: 'approved', by: 'policy' },
    ]);
    expect(metrics).toMatchObject({ approvalsRequested: 2, approvalsDenied: 1, interventions: 2 });
  });

  it('ignores events for runs it never saw start', () => {
    expect(aggregate([finished('ghost', 'succeeded', 1, 1)]).runs).toBe(0);
  });
});
