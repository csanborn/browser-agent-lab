import { randomUUID } from 'node:crypto';
import type { AgentEvent, EventInput, Limits } from '../shared/events';
import { reduceRun, EMPTY_RUN, type RunView } from '../shared/run-view';
import { runAgent } from '../harness/agent';
import { Allowlist, hostOf } from '../harness/allowlist';
import type { BrowserPool } from '../harness/browser';
import { RunControl, type Decision } from '../harness/control';
import type { ModelClient } from '../harness/model';

export const DEFAULT_LIMITS: Limits = { maxSteps: 25, maxDurationMs: 5 * 60_000, maxCostUsd: 1 };

interface RunRecord {
  id: string;
  view: RunView;
  events: AgentEvent[];
  frames: Map<number, Buffer>;
  control: RunControl;
  listeners: Set<(event: AgentEvent) => void>;
}

export interface StartRequest {
  task: string;
  startUrl: string;
  allowlist?: string[];
}

export interface RunManagerOptions {
  pool: BrowserPool;
  /** Picks the model for a task, or explains why the task cannot run. */
  modelFor: (request: StartRequest) => ModelClient | { error: string };
  /** Called for every event, for the persistent log behind the metrics view. */
  record: (event: AgentEvent) => void;
  limits?: Limits;
}

export class RunManager {
  private readonly runs = new Map<string, RunRecord>();

  constructor(private readonly options: RunManagerOptions) {}

  start(request: StartRequest): { id: string } | { error: string } {
    const model = this.options.modelFor(request);
    if ('error' in model) return model;
    const startHost = hostOf(request.startUrl);
    if (!startHost) return { error: 'Start URL must be an http or https URL.' };

    const id = randomUUID().slice(0, 8);
    const record: RunRecord = { id, view: EMPTY_RUN, events: [], frames: new Map(), control: new RunControl(), listeners: new Set() };
    this.runs.set(id, record);
    const allowlist = new Allowlist([startHost, ...(request.allowlist ?? [])]);

    void (async () => {
      let session: Awaited<ReturnType<BrowserPool['session']>> | null = null;
      try {
        session = await this.options.pool.session(allowlist);
        await runAgent({
          runId: id,
          task: request.task,
          startUrl: request.startUrl,
          model,
          browser: session,
          allowlist,
          limits: this.options.limits ?? DEFAULT_LIMITS,
          control: record.control,
          emit: (event) => this.push(record, event),
          storeFrame: (step, jpeg) => {
            record.frames.set(step, jpeg);
            return `/api/runs/${id}/frames/${step}.jpg`;
          },
        });
      } catch (error) {
        console.error(`run ${id} crashed`, error);
      } finally {
        await session?.close().catch(() => undefined);
      }
    })();
    return { id };
  }

  private push(record: RunRecord, event: AgentEvent): void {
    record.events.push(event);
    record.view = reduceRun(record.view, event);
    this.options.record(event);
    for (const listener of record.listeners) listener(event);
  }

  private emit(record: RunRecord, event: EventInput): void {
    this.push(record, { ...event, runId: record.id, at: Date.now() } as AgentEvent);
  }

  get(id: string): { view: RunView; events: AgentEvent[] } | undefined {
    const record = this.runs.get(id);
    return record && { view: record.view, events: record.events };
  }

  frame(id: string, step: number): Buffer | undefined {
    return this.runs.get(id)?.frames.get(step);
  }

  list(): RunView[] {
    return [...this.runs.values()].map((record) => record.view).sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
  }

  subscribe(id: string, listener: (event: AgentEvent) => void): (() => void) | undefined {
    const record = this.runs.get(id);
    if (!record) return undefined;
    record.listeners.add(listener);
    return () => record.listeners.delete(listener);
  }

  /** Pause, resume or stop. Each one that changes something is logged as an intervention. */
  control(id: string, action: 'pause' | 'resume' | 'stop'): boolean {
    const record = this.runs.get(id);
    if (!record) return false;
    const changed = action === 'pause' ? record.control.pause() : action === 'resume' ? record.control.resume() : record.control.stop('user');
    if (changed) this.emit(record, { type: 'intervention', kind: action });
    return changed;
  }

  decide(id: string, approvalId: string, decision: Decision): boolean {
    return this.runs.get(id)?.control.decide(approvalId, decision) ?? false;
  }

  stopAll(): void {
    for (const record of this.runs.values()) record.control.stop('user');
  }
}
