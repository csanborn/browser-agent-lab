import { describe, expect, it } from 'vitest';
import { costUsd, formatUsd } from './pricing';

describe('costUsd', () => {
  it('prices Opus 5.5 input, output and cache tokens', () => {
    const cost = costUsd('claude-opus-5-5', { inputTokens: 1_000_000, outputTokens: 100_000, cacheReadTokens: 1_000_000, cacheWriteTokens: 200_000 });
    expect(cost).toBeCloseTo(4 + 2 + 0.2 + 1);
  });

  it('counts unknown models (the scripted demo) as free', () => {
    expect(costUsd('scripted', { inputTokens: 5, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 })).toBe(0);
  });
});

describe('formatUsd', () => {
  it('keeps small amounts readable', () => {
    expect(formatUsd(0)).toBe('$0.00');
    expect(formatUsd(0.0042)).toBe('$0.0042');
    expect(formatUsd(1.234)).toBe('$1.23');
  });
});
