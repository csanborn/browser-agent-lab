import type { Risk } from '../shared/events';

export type Decision = 'approved' | 'denied';

export interface ApprovalRequest {
  approvalId: string;
  step: number;
  label: string;
  risk: Risk;
}

/** Decides approvals without a person, for evals and the scripted demo. */
export type ApprovalPolicy = (request: ApprovalRequest) => Decision;

export class StopSignal extends Error {
  constructor(readonly reason: 'user' | 'time_limit') {
    super(reason === 'user' ? 'Stopped by the user.' : 'Time limit reached.');
  }
}

interface PendingApproval {
  request: ApprovalRequest;
  resolve: (decision: Decision) => void;
}

/**
 * The user's levers on a live run. The agent loop calls `checkpoint()` before every
 * model call and every action, so Pause holds the run at the next safe point and
 * Stop ends it there (and aborts any model call already in flight).
 */
export class RunControl {
  private paused = false;
  private stopReason: StopSignal['reason'] | null = null;
  private resumeWaiters: Array<() => void> = [];
  private pending: PendingApproval | null = null;
  private readonly abortController = new AbortController();

  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  get isStopped(): boolean {
    return this.stopReason !== null;
  }

  get stoppedBy(): StopSignal['reason'] | null {
    return this.stopReason;
  }

  get pendingApproval(): ApprovalRequest | null {
    return this.pending?.request ?? null;
  }

  pause(): boolean {
    if (this.paused || this.isStopped) return false;
    this.paused = true;
    return true;
  }

  resume(): boolean {
    if (!this.paused) return false;
    this.paused = false;
    this.flushWaiters();
    return true;
  }

  stop(reason: StopSignal['reason'] = 'user'): boolean {
    if (this.isStopped) return false;
    this.stopReason = reason;
    this.paused = false;
    this.pending?.resolve('denied');
    this.pending = null;
    this.flushWaiters();
    this.abortController.abort(new StopSignal(reason));
    return true;
  }

  async checkpoint(): Promise<void> {
    this.throwIfStopped();
    while (this.paused) {
      await new Promise<void>((resolve) => this.resumeWaiters.push(resolve));
      this.throwIfStopped();
    }
  }

  throwIfStopped(): void {
    if (this.stopReason) throw new StopSignal(this.stopReason);
  }

  /** Waits for `decide()` (from the UI) or resolves at once through `policy`. */
  requestApproval(request: ApprovalRequest, policy?: ApprovalPolicy): Promise<Decision> {
    this.throwIfStopped();
    if (policy) return Promise.resolve(policy(request));
    return new Promise<Decision>((resolve) => {
      this.pending = { request, resolve };
    });
  }

  decide(approvalId: string, decision: Decision): boolean {
    if (!this.pending || this.pending.request.approvalId !== approvalId) return false;
    const { resolve } = this.pending;
    this.pending = null;
    resolve(decision);
    return true;
  }

  private flushWaiters(): void {
    const waiters = this.resumeWaiters;
    this.resumeWaiters = [];
    for (const wake of waiters) wake();
  }
}
