import type {
  BetaContentBlockParam,
  BetaMessageParam,
  BetaToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { addUsage, EMPTY_USAGE, type AgentEvent, type AgentReport, type EventInput, type Limits, type RunStatus, type Usage } from '../shared/events';
import { costUsd } from '../shared/pricing';
import { labelFor, parseAction, type ParsedAction } from './actions';
import { normalizeNavigation, type Allowlist } from './allowlist';
import type { ActionOutcome } from './browser';
import { explain, isTransient } from './browser';
import { RunControl, StopSignal, type ApprovalPolicy } from './control';
import { assess, type ElementInfo } from './guardrail';
import type { ModelClient } from './model';
import { buildTools, parseReport, REPORT_TOOL, SYSTEM_PROMPT, taskMessage } from './prompt';

/** The slice of a browser session the loop needs. Tests pass a fake. */
export interface BrowserLike {
  url(): string;
  open(url: string): Promise<void>;
  frame(): Promise<Buffer>;
  describe(action: ParsedAction): Promise<ElementInfo | null>;
  run(action: ParsedAction): Promise<ActionOutcome>;
}

export interface AgentOptions {
  runId: string;
  task: string;
  startUrl: string;
  model: ModelClient;
  browser: BrowserLike;
  allowlist: Allowlist;
  limits: Limits;
  control: RunControl;
  emit: (event: AgentEvent) => void;
  /** Answers approvals without a person (evals, demo). Omit to wait for the UI. */
  approvalPolicy?: ApprovalPolicy;
  /** Keeps a step's frame and returns the URL the UI loads it from. */
  storeFrame?: (step: number, jpeg: Buffer) => string | undefined;
  now?: () => number;
}

export interface RunResult {
  status: RunStatus;
  steps: number;
  durationMs: number;
  usage: Usage;
  costUsd: number;
  report?: AgentReport;
  error?: string;
}

export const NOT_EXECUTED = 'Not executed: an earlier action in this turn failed.';
const NUDGE = `You stopped without calling ${REPORT_TOOL}. Call it now with your result, or keep working if the task is not finished.`;

type ToolUse = Extract<BetaContentBlockParam, { type: 'tool_use' }>;

class Finish {
  constructor(
    readonly status: RunStatus,
    readonly detail: { report?: AgentReport; error?: string } = {},
  ) {}
}

function noteText(block: BetaContentBlockParam): string {
  if (block.type === 'text') return block.text;
  if (block.type === 'thinking') return block.thinking;
  return '';
}

function describeElement(element: ElementInfo | null): string | undefined {
  if (!element) return undefined;
  return element.name ? `${element.role} "${element.name.slice(0, 50)}"` : element.role;
}

export async function runAgent(options: AgentOptions): Promise<RunResult> {
  const { runId, model, browser, allowlist, limits, control } = options;
  const now = options.now ?? Date.now;
  const startedAt = now();
  const emit = (event: EventInput) => options.emit({ ...event, runId, at: now() } as AgentEvent);

  let steps = 0;
  let turn = 0;
  let usage: Usage = EMPTY_USAGE;
  let spent = 0;
  let nudged = false;

  const tools = buildTools();
  const messages: BetaMessageParam[] = [];

  emit({ type: 'run_started', task: options.task, startUrl: options.startUrl, model: model.model, limits, allowlist: allowlist.list() });
  const timer = setTimeout(() => control.stop('time_limit'), limits.maxDurationMs);

  const finish = (status: RunStatus, detail: { report?: AgentReport; error?: string } = {}): RunResult => {
    const result: RunResult = { status, steps, durationMs: now() - startedAt, usage, costUsd: spent, ...detail };
    emit({ type: 'run_finished', ...result });
    return result;
  };

  async function step(block: ToolUse, reason: string): Promise<{ result: BetaToolResultBlockParam; failed: boolean }> {
    const fail = (text: string) => ({ result: { type: 'tool_result' as const, tool_use_id: block.id, toolset_name: 'browser', is_error: true, content: text }, failed: true });

    await control.checkpoint();
    steps += 1;
    const n = steps;
    const parsed = parseAction(block.name, block.input);
    if (!parsed.ok) {
      emit({ type: 'step_started', step: n, action: block.name, label: block.name, reason });
      emit({ type: 'step_finished', step: n, ok: false, summary: parsed.error, ms: 0, url: browser.url() });
      return fail(parsed.error);
    }
    const action = parsed.action;
    const element = await browser.describe(action);
    const label = labelFor(action, describeElement(element));
    emit({ type: 'step_started', step: n, action: action.name, label, reason });
    const t0 = now();

    const verdict = assess(action, element, allowlist);
    if (verdict.level === 'block') {
      emit({ type: 'step_finished', step: n, ok: false, summary: verdict.reason, ms: 0, url: browser.url() });
      return fail(`Error: ${verdict.reason}`);
    }
    if (verdict.level === 'approve') {
      const approvalId = `${runId}:${n}`;
      emit({ type: 'approval_requested', step: n, approvalId, risk: verdict.risk, label });
      const decision = await control.requestApproval({ approvalId, step: n, label, risk: verdict.risk }, options.approvalPolicy);
      control.throwIfStopped();
      emit({ type: 'approval_resolved', approvalId, decision, by: options.approvalPolicy ? 'policy' : 'user' });
      if (decision === 'denied') {
        emit({ type: 'step_finished', step: n, ok: false, summary: 'Declined by the user', ms: now() - t0, url: browser.url() });
        return fail(`The user declined this action (${verdict.risk.reason}). Do not retry it. Find another way, or call ${REPORT_TOOL} if the task cannot be finished without it.`);
      }
      if (verdict.risk.kind === 'off_allowlist') {
        const nav = action.name === 'navigate' ? normalizeNavigation(action.input.url) : null;
        if (nav?.kind === 'url') allowlist.admit(nav.url);
        else if (element?.href) allowlist.admit(element.href);
      }
    }

    let retried = false;
    let outcome: ActionOutcome | null = null;
    let error: string | null = null;
    for (;;) {
      try {
        outcome = await browser.run(action);
        break;
      } catch (err) {
        if (!retried && isTransient(err)) {
          retried = true;
          await new Promise((resolve) => setTimeout(resolve, 400));
          continue;
        }
        error = explain(err);
        break;
      }
    }
    const jpeg = await browser.frame().catch(() => null);
    const screenshot = jpeg ? options.storeFrame?.(n, jpeg) : undefined;
    emit({
      type: 'step_finished',
      step: n,
      ok: !error,
      summary: error ?? outcome?.summary ?? '',
      ms: now() - t0,
      url: browser.url(),
      ...(screenshot ? { screenshot } : {}),
      ...(retried ? { retried } : {}),
    });
    if (error || !outcome) return fail(error ?? 'Error: the action produced no result.');
    return { result: { type: 'tool_result', tool_use_id: block.id, toolset_name: 'browser', content: outcome.content }, failed: false };
  }

  try {
    await browser.open(options.startUrl);
    messages.push({ role: 'user', content: taskMessage(options.task, options.startUrl, allowlist.list()) });

    for (;;) {
      await control.checkpoint();
      turn += 1;
      const t0 = now();
      const response = await model.next(
        { system: SYSTEM_PROMPT, tools, messages },
        { signal: control.signal, onRetry: (attempt, delayMs, reason) => emit({ type: 'model_retry', attempt, delayMs, reason }) },
      );
      const turnCost = costUsd(response.model, response.usage);
      usage = addUsage(usage, response.usage);
      spent += turnCost;
      emit({ type: 'model_call', turn, ms: now() - t0, usage: response.usage, costUsd: turnCost });
      // Append-only history: the assistant turn goes back exactly as received.
      messages.push({ role: 'assistant', content: response.content });

      if (response.stopReason === 'refusal') throw new Finish('refused', { error: 'The model declined this task.' });
      if (spent > limits.maxCostUsd) throw new Finish('budget_limit', { error: `Spent ${spent.toFixed(2)} USD, over the ${limits.maxCostUsd} USD budget.` });

      const toolUses = response.content.filter((block): block is ToolUse => block.type === 'tool_use');
      if (toolUses.length === 0) {
        if (nudged) throw new Finish('error', { error: 'The agent stopped without reporting a result.' });
        nudged = true;
        messages.push({ role: 'user', content: NUDGE });
        continue;
      }

      const results: BetaToolResultBlockParam[] = [];
      let reason = '';
      let failed = false;
      let report: AgentReport | undefined;
      for (const block of response.content) {
        const text = noteText(block).trim();
        if (text) reason = reason ? `${reason} ${text}` : text;
        if (block.type !== 'tool_use') continue;
        if (block.name === REPORT_TOOL) {
          report = parseReport(block.input);
          results.push({ type: 'tool_result', tool_use_id: block.id, content: 'Recorded.' });
          continue;
        }
        if (failed) {
          results.push({ type: 'tool_result', tool_use_id: block.id, toolset_name: 'browser', is_error: true, content: NOT_EXECUTED });
          continue;
        }
        if (steps >= limits.maxSteps) throw new Finish('step_limit', { error: `Reached the ${limits.maxSteps}-step limit.` });
        const outcome = await step(block, reason);
        reason = '';
        results.push(outcome.result);
        failed = outcome.failed;
      }
      if (report) throw new Finish(report.status === 'done' ? 'succeeded' : 'not_possible', { report });
      messages.push({ role: 'user', content: results });
    }
  } catch (error) {
    if (error instanceof Finish) return finish(error.status, error.detail);
    if (error instanceof StopSignal || control.isStopped) {
      const reason = error instanceof StopSignal ? error.reason : (control.stoppedBy ?? 'user');
      return reason === 'time_limit' ? finish('time_limit', { error: `Reached the ${Math.round(limits.maxDurationMs / 1000)}s time limit.` }) : finish('stopped');
    }
    return finish('error', { error: error instanceof Error ? error.message : String(error) });
  } finally {
    clearTimeout(timer);
  }
}
