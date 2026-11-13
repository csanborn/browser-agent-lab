import type { AgentEvent, Limits, RunStatus } from '../shared/events';
import { totalTokens } from '../shared/pricing';
import { runAgent } from '../harness/agent';
import { Allowlist } from '../harness/allowlist';
import type { BrowserPool } from '../harness/browser';
import { RunControl } from '../harness/control';
import type { ModelClient } from '../harness/model';
import { startFixtureServer } from '../fixtures/server';
import type { EvalTask } from './tasks';

export const EVAL_LIMITS: Limits = { maxSteps: 30, maxDurationMs: 240_000, maxCostUsd: 2 };

export interface TaskResult {
  id: string;
  skill: string;
  pass: boolean;
  why: string;
  status: RunStatus;
  steps: number;
  durationMs: number;
  tokens: number;
  costUsd: number;
  approvals: number;
  answer: string;
  confidence: number | null;
}

/** Runs one task against its own fixture server and grades what the agent left behind. */
export async function runTask(task: EvalTask, pool: BrowserPool, model: ModelClient, limits: Limits = EVAL_LIMITS): Promise<TaskResult> {
  const fixtures = await startFixtureServer(0);
  const allowlist = new Allowlist([fixtures.host]);
  const session = await pool.session(allowlist);
  const events: AgentEvent[] = [];
  try {
    const result = await runAgent({
      runId: `eval-${task.id}`,
      task: task.prompt,
      startUrl: `${fixtures.origin}${task.path}`,
      model,
      browser: session,
      allowlist,
      limits,
      control: new RunControl(),
      emit: (event) => events.push(event),
      approvalPolicy: () => task.approvals,
    });
    const grade = task.grade({ status: result.status, report: result.report, state: fixtures.state(), events });
    return {
      id: task.id,
      skill: task.skill,
      pass: grade.pass,
      why: grade.pass ? 'ok' : grade.why,
      status: result.status,
      steps: result.steps,
      durationMs: result.durationMs,
      tokens: totalTokens(result.usage),
      costUsd: result.costUsd,
      approvals: events.filter((e) => e.type === 'approval_requested').length,
      answer: result.report?.answer ?? result.error ?? '',
      confidence: result.report?.confidence ?? null,
    };
  } finally {
    await session.close();
    await fixtures.close();
  }
}

/** Runs tasks with at most `concurrency` in flight, keeping the input order in the output. */
export async function runAll<T, R>(items: T[], concurrency: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]!);
    }
  });
  await Promise.all(workers);
  return results;
}
