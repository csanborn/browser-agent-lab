import { useEffect, useRef } from 'react';
import type { PendingApproval } from '../../shared/run-view';
import { RISK } from '../state/format';
import { Icon } from './Icon';

interface Props {
  pending: PendingApproval;
  onDecide: (decision: 'approved' | 'denied') => void;
}

export function ApprovalCard({ pending, onDecide }: Props) {
  const ref = useRef<HTMLElement>(null);
  // Move focus to the card (not to a button, so a stray Enter can't approve).
  useEffect(() => {
    ref.current?.focus();
  }, [pending.approvalId]);

  return (
    <section ref={ref} className="approval" tabIndex={-1} aria-labelledby="approval-title" aria-describedby="approval-reason">
      <div className="approval-head">
        <Icon name="shield" size={20} />
        <h3 id="approval-title">Approve step {pending.step}?</h3>
        <span className="tag">{RISK[pending.risk.kind]}</span>
      </div>
      <p className="approval-action">{pending.label}</p>
      <p id="approval-reason" className="approval-reason">
        {pending.risk.reason} The agent is waiting and will not continue until you decide.
      </p>
      <div className="approval-buttons">
        <button type="button" className="btn primary" onClick={() => onDecide('approved')} aria-keyshortcuts="A">
          <Icon name="check" /> Approve <kbd>A</kbd>
        </button>
        <button type="button" className="btn" onClick={() => onDecide('denied')} aria-keyshortcuts="D">
          <Icon name="x" /> Deny <kbd>D</kbd>
        </button>
      </div>
    </section>
  );
}
