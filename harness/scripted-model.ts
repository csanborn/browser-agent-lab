import type { BetaContentBlockParam, BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { EMPTY_USAGE, type AgentReport } from '../shared/events';
import type { CallOptions, ModelClient, ModelRequest, ModelTurn } from './model';
import { REPORT_TOOL } from './prompt';

/** One scripted turn: a browser action or the final report, plus the note shown as its reason. */
export type ScriptMove =
  | { note: string; action: string; input: Record<string, unknown> }
  | { note: string; report: AgentReport };

export interface ScriptContext {
  /** Text of the previous turn's tool results, where refs can be looked up. */
  last: string;
  /** Text of every tool result so far. */
  all: string;
}

export type ScriptStep = (ctx: ScriptContext) => ScriptMove;

export class ScriptError extends Error {}

/** Pulls the ref of the first element line matching `pattern` out of read_page or find output. */
export function refIn(text: string, pattern: RegExp): string {
  for (const line of text.split('\n')) {
    if (!pattern.test(line)) continue;
    const match = /\[(ref_\d+)\]/.exec(line);
    if (match) return match[1]!;
  }
  throw new ScriptError(`No element matching ${pattern} in the page output.`);
}

function resultText(message: BetaMessageParam | undefined): string {
  if (!message || !Array.isArray(message.content)) return '';
  const parts: string[] = [];
  for (const block of message.content) {
    if (block.type !== 'tool_result') continue;
    if (typeof block.content === 'string') parts.push(block.content);
    else for (const item of block.content ?? []) if (item.type === 'text') parts.push(item.text);
  }
  return parts.join('\n');
}

/**
 * A deterministic stand-in for Claude. It plays a fixed script against the real
 * harness and browser, so tests, CI and the no-key demo exercise everything except
 * the model itself.
 */
export class ScriptedModel implements ModelClient {
  readonly model = 'scripted';
  readonly label = 'Scripted demo';
  private turn = 0;

  constructor(
    private readonly steps: ScriptStep[],
    private readonly delayMs = 0,
  ) {}

  async next(request: ModelRequest, options: CallOptions): Promise<ModelTurn> {
    if (this.delayMs) await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    options.signal.throwIfAborted();
    const ctx: ScriptContext = {
      last: resultText(request.messages.at(-1)),
      all: request.messages.map(resultText).join('\n'),
    };
    const index = this.turn;
    this.turn += 1;
    const id = `toolu_scripted_${index}`;

    let move: ScriptMove;
    try {
      const step = this.steps[index];
      move = step ? step(ctx) : { note: 'The script ran out of steps.', report: { status: 'not_possible', answer: 'The script ended early.', confidence: 0 } };
    } catch (error) {
      if (!(error instanceof ScriptError)) throw error;
      move = { note: error.message, report: { status: 'not_possible', answer: error.message, confidence: 0 } };
    }

    const content: BetaContentBlockParam[] = [{ type: 'text', text: move.note }];
    if ('report' in move) content.push({ type: 'tool_use', id, name: REPORT_TOOL, input: move.report });
    else content.push({ type: 'tool_use', id, name: move.action, input: move.input, toolset_name: 'browser' });
    return { content, stopReason: 'tool_use', usage: EMPTY_USAGE, model: this.model };
  }
}
