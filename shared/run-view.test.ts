import { describe, expect, it } from 'vitest';
import { EMPTY_USAGE, type AgentEvent } from './events';
import { replay } from './run-view';

const runId = 'r1';
const base = { runId };
const start: AgentEvent = { ...base, at: 0, type: 'run_started', task: 'Find it', startUrl: 'http://x/', model: 'claude-opus-5-5', limits: { maxSteps: 5, maxDurationMs: 1000, maxCostUsd: 1 }, allowlist: ['x'] };

describe('reduceRun', () => {
  it('builds steps from start and finish events', () => {
    const view = replay([
      start,
      { ...base, at: 1, type: 'step_started', step: 1, action: 'navigate', label: 'Go to x', reason: 'Open it.' },
      { ...base, at: 2, type: 'step_finished', step: 1, ok: true, summary: 'Loaded', ms: 5, url: 'http://x/a', screenshot: '/f/1.jpg' },
    ]);
    expect(view.steps).toEqual([{ step: 1, action: 'navigate', label: 'Go to x', reason: 'Open it.', state: 'done', summary: 'Loaded', screenshot: '/f/1.jpg', url: 'http://x/a', ms: 5, retried: undefined }]);
    expect(view.status).toBe('running');
  });

  it('tracks a pending approval and clears it on decision', () => {
    const asked = [
      start,
      { ...base, at: 1, type: 'step_started', step: 1, action: 'left_click', label: 'Click "Buy"', reason: '' },
      { ...base, at: 2, type: 'approval_requested', step: 1, approvalId: 'r1:1', label: 'Click "Buy"', risk: { kind: 'consequential', reason: 'Buys' } },
    ] satisfies AgentEvent[];
    const waiting = replay(asked);
    expect(waiting.status).toBe('awaiting_approval');
    expect(waiting.pending?.approvalId).toBe('r1:1');
    expect(waiting.steps[0]!.state).toBe('awaiting_approval');

    const denied = replay([...asked, { ...base, at: 3, type: 'approval_resolved', approvalId: 'r1:1', decision: 'denied', by: 'user' }, { ...base, at: 4, type: 'step_finished', step: 1, ok: false, summary: 'Declined by the user', ms: 1, url: 'http://x/' }]);
    expect(denied.status).toBe('running');
    expect(denied.pending).toBeNull();
    expect(denied.steps[0]).toMatchObject({ state: 'declined', approval: { decision: 'denied', by: 'user' } });
  });

  it('pauses and resumes, returning to the approval if one is pending', () => {
    const paused = replay([start, { ...base, at: 1, type: 'intervention', kind: 'pause' }]);
    expect(paused.status).toBe('paused');
    const resumed = replay([start, { ...base, at: 1, type: 'intervention', kind: 'pause' }, { ...base, at: 2, type: 'intervention', kind: 'resume' }]);
    expect(resumed.status).toBe('running');
  });

  it('adds up usage and shows retries until the next call', () => {
    const usage = { inputTokens: 10, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 };
    const retrying = replay([start, { ...base, at: 1, type: 'model_retry', attempt: 1, delayMs: 2000, reason: 'rate limited' }]);
    expect(retrying.retrying).toEqual({ attempt: 1, reason: 'rate limited', until: 2001 });
    const view = replay([start, { ...base, at: 1, type: 'model_retry', attempt: 1, delayMs: 2000, reason: 'rate limited' }, { ...base, at: 2, type: 'model_call', turn: 1, ms: 5, usage, costUsd: 0.01 }]);
    expect(view).toMatchObject({ turns: 1, usage, costUsd: 0.01, retrying: null });
  });

  it('closes out running steps and ignores late events when the run ends', () => {
    const view = replay([
      start,
      { ...base, at: 1, type: 'step_started', step: 1, action: 'wait', label: 'Wait 1s', reason: '' },
      { ...base, at: 2, type: 'run_finished', status: 'stopped', steps: 1, durationMs: 2, usage: EMPTY_USAGE, costUsd: 0 },
      { ...base, at: 3, type: 'intervention', kind: 'pause' },
    ]);
    expect(view.status).toBe('stopped');
    expect(view.steps[0]).toMatchObject({ state: 'failed', summary: 'Interrupted' });
  });

  it('ignores events from other runs', () => {
    const view = replay([start, { runId: 'other', at: 1, type: 'intervention', kind: 'pause' }]);
    expect(view.status).toBe('running');
  });
});
