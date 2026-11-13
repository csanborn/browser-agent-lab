import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { AnthropicModel, backoffMs, retryable } from './model';

function apiError(status: number, headers: Record<string, string> = {}) {
  return Anthropic.APIError.generate(status, { error: { type: 'x', message: 'x' } }, 'x', new Headers(headers));
}

describe('retryable', () => {
  it('retries rate limits, overload and server errors', () => {
    expect(retryable(apiError(429)).retry).toBe(true);
    expect(retryable(apiError(529)).retry).toBe(true);
    expect(retryable(apiError(503)).retry).toBe(true);
    expect(retryable(new Anthropic.APIConnectionError({ message: 'reset' })).retry).toBe(true);
  });

  it('does not retry bad requests or aborts', () => {
    expect(retryable(apiError(400)).retry).toBe(false);
    expect(retryable(apiError(401)).retry).toBe(false);
    expect(retryable(new Anthropic.APIUserAbortError()).retry).toBe(false);
  });

  it('reads retry-after', () => {
    expect(retryable(apiError(429, { 'retry-after': '3' })).retryAfterMs).toBe(3000);
    expect(backoffMs(1, 3000)).toBe(3000);
  });

  it('backs off exponentially with jitter', () => {
    const first = backoffMs(1);
    const third = backoffMs(3);
    expect(first).toBeGreaterThanOrEqual(800);
    expect(first).toBeLessThanOrEqual(1200);
    expect(third).toBeGreaterThanOrEqual(3200);
  });
});

describe('AnthropicModel', () => {
  const ok = {
    content: [{ type: 'text', text: 'hi' }],
    stop_reason: 'end_turn',
    model: 'claude-opus-5-5',
    usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 2, cache_creation_input_tokens: 1 },
  };

  it('sends the browser toolset request and maps usage', async () => {
    const create = vi.fn().mockResolvedValue(ok);
    const client = { beta: { messages: { create } } } as unknown as Anthropic;
    const model = new AnthropicModel('claude-opus-5-5', 'medium', client);
    const turn = await model.next({ system: 's', tools: [], messages: [] }, { signal: new AbortController().signal });
    expect(turn.usage).toEqual({ inputTokens: 10, outputTokens: 5, cacheReadTokens: 2, cacheWriteTokens: 1 });
    const params = create.mock.calls[0]![0];
    expect(params).toMatchObject({ model: 'claude-opus-5-5', thinking: { type: 'adaptive', display: 'updates' }, output_config: { effort: 'medium' }, fallbacks: 'default' });
    expect(params.betas).toContain('thinking-display-updates-2026-08-18');
  });

  it('retries a retryable error and reports each retry', async () => {
    vi.useFakeTimers();
    const create = vi.fn().mockRejectedValueOnce(apiError(529, { 'retry-after': '0' })).mockResolvedValue(ok);
    const client = { beta: { messages: { create } } } as unknown as Anthropic;
    const onRetry = vi.fn();
    const pending = new AnthropicModel('claude-opus-5-5', 'medium', client).next({ system: 's', tools: [], messages: [] }, { signal: new AbortController().signal, onRetry });
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toMatchObject({ stopReason: 'end_turn' });
    expect(onRetry).toHaveBeenCalledWith(1, 0, 'API overloaded');
    vi.useRealTimers();
  });

  it('gives up on a bad request at once', async () => {
    const create = vi.fn().mockRejectedValue(apiError(400));
    const client = { beta: { messages: { create } } } as unknown as Anthropic;
    await expect(new AnthropicModel('claude-opus-5-5', 'medium', client).next({ system: 's', tools: [], messages: [] }, { signal: new AbortController().signal })).rejects.toBeInstanceOf(Anthropic.BadRequestError);
    expect(create).toHaveBeenCalledTimes(1);
  });
});
