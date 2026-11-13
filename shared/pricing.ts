import type { Usage } from './events';

/** USD per million tokens. Cache writes use the 5-minute TTL rate (1.25x input). */
interface Rates {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

const RATES: Record<string, Rates> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
};

export function costUsd(model: string, usage: Usage): number {
  const rates = RATES[model];
  if (!rates) return 0;
  const perToken = (millionRate: number) => millionRate / 1_000_000;
  return (
    usage.inputTokens * perToken(rates.input) +
    usage.outputTokens * perToken(rates.output) +
    usage.cacheReadTokens * perToken(rates.cacheRead) +
    usage.cacheWriteTokens * perToken(rates.cacheWrite)
  );
}

export function formatUsd(value: number): string {
  if (value === 0) return '$0.00';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

export function totalTokens(usage: Usage): number {
  return usage.inputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
}
