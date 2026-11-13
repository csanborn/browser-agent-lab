import { formatUsd } from '../shared/pricing';
import type { TaskResult } from './runner';

export interface EvalSummary {
  model: string;
  effort: string;
  startedAt: string;
  passed: number;
  total: number;
  successRate: number;
  medianSteps: number;
  totalDurationMs: number;
  totalTokens: number;
  totalCostUsd: number;
  results: TaskResult[];
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function summarize(model: string, effort: string, startedAt: Date, results: TaskResult[]): EvalSummary {
  const passed = results.filter((r) => r.pass).length;
  return {
    model,
    effort,
    startedAt: startedAt.toISOString(),
    passed,
    total: results.length,
    successRate: results.length ? passed / results.length : 0,
    medianSteps: median(results.map((r) => r.steps)),
    totalDurationMs: results.reduce((sum, r) => sum + r.durationMs, 0),
    totalTokens: results.reduce((sum, r) => sum + r.tokens, 0),
    totalCostUsd: results.reduce((sum, r) => sum + r.costUsd, 0),
    results,
  };
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
const thousands = (n: number) => n.toLocaleString('en-US');

/** Markdown table for the README and the console. */
export function toMarkdown(summary: EvalSummary): string {
  const header = '| Task | Measures | Result | Steps | Time | Tokens | Cost |\n|---|---|---|---:|---:|---:|---:|';
  const rows = summary.results.map(
    (r) => `| \`${r.id}\` | ${r.skill} | ${r.pass ? 'pass' : `fail (${r.why})`} | ${r.steps} | ${seconds(r.durationMs)} | ${thousands(r.tokens)} | ${formatUsd(r.costUsd)} |`,
  );
  const total = `| **Total** | | **${summary.passed}/${summary.total} (${Math.round(summary.successRate * 100)}%)** | median ${summary.medianSteps} | ${seconds(summary.totalDurationMs)} | ${thousands(summary.totalTokens)} | ${formatUsd(summary.totalCostUsd)} |`;
  return [header, ...rows, total].join('\n');
}
