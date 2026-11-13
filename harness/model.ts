import Anthropic from '@anthropic-ai/sdk';
import type {
  BetaContentBlockParam,
  BetaMessageParam,
  BetaToolUnion,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { Usage } from '../shared/events';

export interface ModelRequest {
  system: string;
  tools: BetaToolUnion[];
  messages: BetaMessageParam[];
}

export interface ModelTurn {
  /** Passed back unchanged as the assistant turn, so thinking blocks stay valid. */
  content: BetaContentBlockParam[];
  stopReason: string | null;
  usage: Usage;
  /** The model that answered (differs from the request when a fallback served it). */
  model: string;
}

export interface CallOptions {
  signal: AbortSignal;
  onRetry?: (attempt: number, delayMs: number, reason: string) => void;
}

export interface ModelClient {
  readonly model: string;
  readonly label: string;
  next(request: ModelRequest, options: CallOptions): Promise<ModelTurn>;
}

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

const BETAS = [
  // Short progress notes between tool calls come back as readable thinking
  // summaries. The timeline shows them as each step's reason.
  'thinking-display-updates-2026-08-18',
  // If a safety classifier declines a turn, the API re-runs it on a fallback model.
  'server-side-fallback-2026-07-01',
];

const MAX_RETRIES = 4;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Rate limits, overload, server errors and dropped connections are worth retrying. Bad requests are not. */
export function retryable(error: unknown): { retry: boolean; reason: string; retryAfterMs?: number } {
  if (error instanceof Anthropic.APIUserAbortError) return { retry: false, reason: 'aborted' };
  if (error instanceof Anthropic.APIConnectionError) return { retry: true, reason: 'connection error' };
  if (error instanceof Anthropic.APIError) {
    const status = error.status ?? 0;
    const header = error.headers?.get('retry-after');
    const retryAfterMs = header && Number.isFinite(Number(header)) ? Number(header) * 1000 : undefined;
    if (status === 429) return { retry: true, reason: 'rate limited', retryAfterMs };
    if (status === 529) return { retry: true, reason: 'API overloaded', retryAfterMs };
    if (status >= 500) return { retry: true, reason: `server error ${status}`, retryAfterMs };
  }
  return { retry: false, reason: error instanceof Error ? error.message : String(error) };
}

export function backoffMs(attempt: number, retryAfterMs?: number): number {
  if (retryAfterMs !== undefined) return Math.min(retryAfterMs, 60_000);
  const base = 1_000 * 2 ** (attempt - 1);
  return Math.round(base * (0.8 + Math.random() * 0.4));
}

export class AnthropicModel implements ModelClient {
  readonly label = 'Claude';
  private readonly client: Anthropic;

  constructor(
    readonly model = 'claude-opus-5-5',
    private readonly effort: Effort = 'medium',
    client?: Anthropic,
  ) {
    // Retries are handled below so each one shows up in the run's timeline.
    this.client = client ?? new Anthropic({ maxRetries: 0, timeout: 120_000 });
  }

  async next(request: ModelRequest, options: CallOptions): Promise<ModelTurn> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        const response = await this.client.beta.messages.create(
          {
            model: this.model,
            max_tokens: 16_000,
            betas: BETAS,
            thinking: { type: 'adaptive', display: 'updates' },
            output_config: { effort: this.effort },
            fallbacks: 'default',
            cache_control: { type: 'ephemeral' },
            system: request.system,
            tools: request.tools,
            messages: request.messages,
          },
          { signal: options.signal },
        );
        const usage = response.usage;
        return {
          content: response.content as BetaContentBlockParam[],
          stopReason: response.stop_reason,
          model: response.model,
          usage: {
            inputTokens: usage.input_tokens,
            outputTokens: usage.output_tokens,
            cacheReadTokens: usage.cache_read_input_tokens ?? 0,
            cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
          },
        };
      } catch (error) {
        const verdict = retryable(error);
        if (!verdict.retry || attempt > MAX_RETRIES || options.signal.aborted) throw error;
        const delayMs = backoffMs(attempt, verdict.retryAfterMs);
        options.onRetry?.(attempt, delayMs, verdict.reason);
        await sleep(delayMs, options.signal);
      }
    }
  }
}
