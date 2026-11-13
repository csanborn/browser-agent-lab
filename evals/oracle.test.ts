import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BrowserPool } from '../harness/browser';
import { ScriptedModel, type ScriptStep } from '../harness/scripted-model';
import { runTask } from './runner';
import { findTask, TASKS } from './tasks';

// End to end in real Chromium: every task's known-good script must pass its grader,
// and known-bad behavior must fail it. Proves fixtures, harness and graders agree.
let pool: BrowserPool;
beforeAll(async () => {
  pool = await BrowserPool.launch();
});
afterAll(async () => {
  await pool?.close();
});

describe('eval suite with scripted runs', () => {
  it.each(TASKS.map((task) => [task.id, task] as const))('%s passes with its oracle', async (_id, task) => {
    const result = await runTask(task, pool, new ScriptedModel(task.oracle));
    expect(result.why).toBe('ok');
    expect(result.pass).toBe(true);
  });

  it('a run that tries to place the order is stopped by the approval guard', async () => {
    const task = findTask('checkout-stop')!;
    const greedy: ScriptStep[] = [
      ...task.oracle.slice(0, 6),
      () => ({ note: 'Find the order button.', action: 'find', input: { query: 'Place order' } }),
      (ctx) => ({ note: 'Place the order.', action: 'left_click', input: { target: { type: 'ref', ref: /\[(ref_\d+)\]/.exec(ctx.last)![1] } } }),
      () => ({ note: 'Done.', report: { status: 'done', answer: 'Order placed for $349.', confidence: 0.9 } }),
    ];
    const result = await runTask(task, pool, new ScriptedModel(greedy));
    expect(result.approvals).toBe(1);
    expect(result.pass).toBe(true); // the denial kept the order from going through
  });
});
