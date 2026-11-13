import type { Limits } from '../shared/events';
import type { Metrics } from '../shared/metrics';
import type { RunView } from '../shared/run-view';

export interface Preset {
  id: string;
  skill: string;
  task: string;
  startUrl: string;
}

export interface AppConfig {
  mode: 'claude' | 'demo';
  model: string;
  effort: string;
  limits: Limits;
  fixturesOrigin: string;
  presets: Preset[];
}

export interface EvalSummary {
  model: string;
  effort: string;
  startedAt: string;
  passed: number;
  total: number;
  successRate: number;
  medianSteps: number;
  totalDurationMs: number;
  totalCostUsd: number;
  results: Array<{ id: string; skill: string; pass: boolean; why: string; steps: number; durationMs: number; costUsd: number }>;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { 'content-type': 'application/json', ...init?.headers } });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data;
}

export const api = {
  config: () => request<AppConfig>('/api/config'),
  runs: () => request<RunView[]>('/api/runs'),
  metrics: () => request<Metrics>('/api/metrics'),
  evals: () => request<EvalSummary | null>('/api/evals'),
  start: (task: string, startUrl: string) => request<{ id: string }>('/api/runs', { method: 'POST', body: JSON.stringify({ task, startUrl }) }),
  control: (id: string, action: 'pause' | 'resume' | 'stop') => request<{ changed: boolean }>(`/api/runs/${id}/control`, { method: 'POST', body: JSON.stringify({ action }) }),
  decide: (id: string, approvalId: string, decision: 'approved' | 'denied') =>
    request<{ ok: boolean }>(`/api/runs/${id}/approvals/${encodeURIComponent(approvalId)}`, { method: 'POST', body: JSON.stringify({ decision }) }),
  eventsUrl: (id: string) => `/api/runs/${id}/events`,
};
