import type { BetaContentBlockParam, BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { describe, expect, it } from 'vitest';
import type { AgentEvent, Limits, Usage } from '../shared/events';
import { NOT_EXECUTED, runAgent, type BrowserLike } from './agent';
import type { ParsedAction } from './actions';
import { Allowlist } from './allowlist';
import { ActionError, type ActionOutcome } from './browser';
import { RunControl } from './control';
import type { ElementInfo } from './guardrail';
import type { ModelClient, ModelRequest, ModelTurn } from './model';
import { ScriptedModel, type ScriptStep } from './scripted-model';

const LIMITS: Limits = { maxSteps: 10, maxDurationMs: 10_000, maxCostUsd: 1 };

class FakeBrowser implements BrowserLike {
  actions: ParsedAction[] = [];
  private current = 'http://localhost:4174/';
  constructor(
    private readonly elements: Record<string, ElementInfo> = {},
    private readonly failures: Record<string, Error> = {},
  ) {}
  url() {
    return this.current;
  }
  async open(url: string) {
    this.current = url;
  }
  async frame() {
    return Buffer.from('jpeg');
  }
  async describe(action: ParsedAction) {
    const target = (action.input as { target?: { type: string; ref?: string } }).target;
    return target?.ref ? (this.elements[target.ref] ?? null) : null;
  }
  async run(action: ParsedAction): Promise<ActionOutcome> {
    this.actions.push(action);
    const failure = this.failures[action.name];
    if (failure) throw failure;
    if (action.name === 'navigate') this.current = action.input.url;
    return { content: [{ type: 'text', text: `did ${action.name}` }], summary: `did ${action.name}` };
  }
}

/** Plays back fixed assistant turns, for cases the scripted model can't express. */
class TurnModel implements ModelClient {
  readonly model = 'claude-opus-5-5';
  readonly label = 'test';
  requests: BetaMessageParam[][] = [];
  constructor(private readonly turns: Array<Partial<ModelTurn> & { content: BetaContentBlockParam[] }>) {}
  async next(request: ModelRequest): Promise<ModelTurn> {
    this.requests.push(structuredClone(request.messages));
    const turn = this.turns.shift();
    if (!turn) throw new Error('out of turns');
    return { stopReason: 'tool_use', usage: { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0 }, model: this.model, ...turn };
  }
}

const browserCall = (id: string, name: string, input: unknown): BetaContentBlockParam => ({ type: 'tool_use', id, name, input, toolset_name: 'browser' });
const report = (id: string, answer = 'ok', status = 'done'): BetaContentBlockParam => ({ type: 'tool_use', id, name: 'report_result', input: { status, answer, confidence: 0.9 } });

async function run(model: ModelClient, browser = new FakeBrowser(), extra: Partial<Parameters<typeof runAgent>[0]> = {}) {
  const events: AgentEvent[] = [];
  const control = extra.control ?? new RunControl();
  const result = await runAgent({
    runId: 'test',
    task: 'Do the thing',
    startUrl: 'http://localhost:4174/',
    model,
    browser,
    allowlist: new Allowlist(['localhost:4174']),
    limits: LIMITS,
    control,
    emit: (event) => events.push(event),
    approvalPolicy: () => 'approved',
    ...extra,
  });
  return { result, events, browser };
}

const types = (events: AgentEvent[]) => events.map((e) => e.type);

describe('runAgent', () => {
  it('runs steps, emits the timeline and finishes with the report', async () => {
    const steps: ScriptStep[] = [
      () => ({ note: 'Read the page first.', action: 'read_page', input: {} }),
      () => ({ note: 'Done.', report: { status: 'done', answer: '42', confidence: 0.8 } }),
    ];
    const { result, events } = await run(new ScriptedModel(steps));
    expect(result).toMatchObject({ status: 'succeeded', steps: 1, report: { answer: '42' } });
    expect(types(events)).toEqual(['run_started', 'model_call', 'step_started', 'step_finished', 'model_call', 'run_finished']);
    const started = events.find((e) => e.type === 'step_started');
    expect(started).toMatchObject({ label: 'Read the page', reason: 'Read the page first.' });
  });

  it('reports not_possible when the agent says so', async () => {
    const { result } = await run(new ScriptedModel([() => ({ note: 'No such item.', report: { status: 'not_possible', answer: 'Not listed', confidence: 0.7 } })]));
    expect(result.status).toBe('not_possible');
  });

  it('keeps history append-only and echoes toolset_name on results', async () => {
    const model = new TurnModel([{ content: [{ type: 'text', text: 'Look.' }, browserCall('t1', 'get_page_text', {})] }, { content: [report('t2')] }]);
    await run(model);
    const second = model.requests[1]!;
    expect(second[1]).toEqual({ role: 'assistant', content: [{ type: 'text', text: 'Look.' }, browserCall('t1', 'get_page_text', {})] });
    expect(second[2]).toMatchObject({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', toolset_name: 'browser' }] });
  });

  it('stops a batch at the first failure and marks the rest not executed', async () => {
    const browser = new FakeBrowser({}, { left_click: new ActionError('Error: ref_9 is stale or not found on the current page.') });
    const model = new TurnModel([
      { content: [browserCall('a', 'left_click', { target: { type: 'ref', ref: 'ref_9' } }), browserCall('b', 'type', { text: 'hi' })] },
      { content: [report('c')] },
    ]);
    const { browser: used } = await run(model, browser);
    expect(used.actions.map((a) => a.name)).toEqual(['left_click']);
    const results = model.requests[1]![2]!.content as Array<{ tool_use_id: string; is_error?: boolean; content: unknown }>;
    expect(results[0]).toMatchObject({ tool_use_id: 'a', is_error: true, content: expect.stringContaining('stale') });
    expect(results[1]).toMatchObject({ tool_use_id: 'b', is_error: true, content: NOT_EXECUTED });
  });

  it('returns invalid input to the model instead of running it', async () => {
    const model = new TurnModel([{ content: [browserCall('a', 'scroll', { target: { type: 'coordinate', x: 1, y: 1 }, scroll_direction: 'sideways' })] }, { content: [report('b')] }]);
    const { browser, events } = await run(model);
    expect(browser.actions).toHaveLength(0);
    expect(events.find((e) => e.type === 'step_finished')).toMatchObject({ ok: false });
  });

  it('asks for approval and skips the action when denied', async () => {
    const browser = new FakeBrowser({ ref_1: { tag: 'button', role: 'button', name: 'Place order', submits: true, inForm: true, formMethod: 'post' } });
    const model = new TurnModel([{ content: [browserCall('a', 'left_click', { target: { type: 'ref', ref: 'ref_1' } })] }, { content: [report('b')] }]);
    const { events } = await run(model, browser, { approvalPolicy: () => 'denied' });
    expect(browser.actions).toHaveLength(0);
    expect(events.find((e) => e.type === 'approval_requested')).toMatchObject({ risk: { kind: 'form_submit' } });
    expect(events.find((e) => e.type === 'approval_resolved')).toMatchObject({ decision: 'denied', by: 'policy' });
    const result = (model.requests[1]![2]!.content as Array<{ content: string }>)[0]!;
    expect(result.content).toMatch(/declined/);
  });

  it('waits for the user when there is no policy', async () => {
    const control = new RunControl();
    const browser = new FakeBrowser({ ref_1: { tag: 'button', role: 'button', name: 'Delete', submits: false, inForm: false } });
    const model = new TurnModel([{ content: [browserCall('a', 'left_click', { target: { type: 'ref', ref: 'ref_1' } })] }, { content: [report('b')] }]);
    const pending = run(model, browser, { control, approvalPolicy: undefined });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(control.pendingApproval?.approvalId).toBe('test:1');
    control.decide('test:1', 'approved');
    const { events } = await pending;
    expect(browser.actions).toHaveLength(1);
    expect(events.find((e) => e.type === 'approval_resolved')).toMatchObject({ decision: 'approved', by: 'user' });
  });

  it('admits an approved off-allowlist host for the rest of the run', async () => {
    const allowlist = new Allowlist(['localhost:4174']);
    const model = new TurnModel([{ content: [browserCall('a', 'navigate', { url: 'https://partner.test/page' })] }, { content: [report('b')] }]);
    await run(model, new FakeBrowser(), { allowlist });
    expect(allowlist.allows('https://partner.test/other')).toBe(true);
  });

  it('ends at the step limit', async () => {
    const forever: ScriptStep[] = Array.from({ length: 20 }, () => () => ({ note: 'Look again.', action: 'get_page_text', input: {} }));
    const { result } = await run(new ScriptedModel(forever), new FakeBrowser(), { limits: { ...LIMITS, maxSteps: 3 } });
    expect(result).toMatchObject({ status: 'step_limit', steps: 3 });
  });

  it('ends at the time limit, aborting an in-flight call', async () => {
    const slow: ModelClient = {
      model: 'claude-opus-5-5',
      label: 'slow',
      next: (_request, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted')))),
    };
    const { result } = await run(slow, new FakeBrowser(), { limits: { ...LIMITS, maxDurationMs: 30 } });
    expect(result.status).toBe('time_limit');
  });

  it('ends when the user stops it', async () => {
    const control = new RunControl();
    const steps: ScriptStep[] = Array.from({ length: 20 }, () => () => ({ note: 'Look.', action: 'get_page_text', input: {} }));
    const pending = run(new ScriptedModel(steps, 5), new FakeBrowser(), { control });
    setTimeout(() => control.stop('user'), 20);
    const { result } = await pending;
    expect(result.status).toBe('stopped');
  });

  it('ends over budget', async () => {
    const usage: Usage = { inputTokens: 300_000, outputTokens: 10_000, cacheReadTokens: 0, cacheWriteTokens: 0 };
    const model = new TurnModel([{ content: [browserCall('a', 'get_page_text', {})], usage }]);
    const { result } = await run(model);
    expect(result.status).toBe('budget_limit');
    expect(result.costUsd).toBeCloseTo(1.4);
  });

  it('marks refusals', async () => {
    const { result } = await run(new TurnModel([{ content: [], stopReason: 'refusal' }]));
    expect(result.status).toBe('refused');
  });

  it('nudges once when the model stops without reporting, then errors', async () => {
    const model = new TurnModel([{ content: [{ type: 'text', text: 'All done!' }], stopReason: 'end_turn' }, { content: [{ type: 'text', text: 'Really.' }], stopReason: 'end_turn' }]);
    const { result } = await run(model);
    expect(model.requests[1]!.at(-1)).toMatchObject({ role: 'user', content: expect.stringContaining('report_result') });
    expect(result).toMatchObject({ status: 'error', error: expect.stringContaining('without reporting') });
  });

  it('retries a transient browser failure once', async () => {
    const { errors } = await import('playwright');
    let calls = 0;
    const browser = new FakeBrowser();
    browser.run = async (action) => {
      calls += 1;
      if (calls === 1) throw new errors.TimeoutError('slow');
      return { content: [{ type: 'text', text: 'ok' }], summary: `did ${action.name}` };
    };
    const model = new TurnModel([{ content: [browserCall('a', 'left_click', { target: { type: 'coordinate', x: 5, y: 5 } })] }, { content: [report('b')] }]);
    const { events } = await run(model, browser);
    expect(calls).toBe(2);
    expect(events.find((e) => e.type === 'step_finished')).toMatchObject({ ok: true, retried: true });
  });
});
