import { describe, expect, it } from 'vitest';
import { RunControl, StopSignal } from './control';

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('RunControl', () => {
  it('holds checkpoints while paused and releases them on resume', async () => {
    const control = new RunControl();
    control.pause();
    let passed = false;
    const waiting = control.checkpoint().then(() => {
      passed = true;
    });
    await tick();
    expect(passed).toBe(false);
    control.resume();
    await waiting;
    expect(passed).toBe(true);
  });

  it('stop wakes a paused run with a StopSignal and aborts the signal', async () => {
    const control = new RunControl();
    control.pause();
    const waiting = control.checkpoint();
    control.stop('user');
    await expect(waiting).rejects.toBeInstanceOf(StopSignal);
    expect(control.signal.aborted).toBe(true);
    expect(control.stoppedBy).toBe('user');
  });

  it('reports whether pause, resume and stop changed anything', () => {
    const control = new RunControl();
    expect(control.resume()).toBe(false);
    expect(control.pause()).toBe(true);
    expect(control.pause()).toBe(false);
    expect(control.stop()).toBe(true);
    expect(control.stop()).toBe(false);
    expect(control.pause()).toBe(false);
  });

  it('waits for a decision on a pending approval', async () => {
    const control = new RunControl();
    const request = { approvalId: 'r:1', step: 1, label: 'Click "Buy"', risk: { kind: 'consequential' as const, reason: 'Buys' } };
    const decision = control.requestApproval(request);
    expect(control.pendingApproval).toEqual(request);
    expect(control.decide('other', 'approved')).toBe(false);
    expect(control.decide('r:1', 'approved')).toBe(true);
    await expect(decision).resolves.toBe('approved');
    expect(control.pendingApproval).toBeNull();
  });

  it('denies a pending approval when stopped', async () => {
    const control = new RunControl();
    const decision = control.requestApproval({ approvalId: 'r:2', step: 2, label: 'x', risk: { kind: 'form_submit', reason: 'y' } });
    control.stop();
    await expect(decision).resolves.toBe('denied');
  });

  it('answers through a policy without waiting', async () => {
    const control = new RunControl();
    await expect(control.requestApproval({ approvalId: 'r:3', step: 3, label: 'x', risk: { kind: 'form_submit', reason: 'y' } }, () => 'denied')).resolves.toBe('denied');
  });
});
