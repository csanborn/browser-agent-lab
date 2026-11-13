import type { RunStatus } from '../../shared/events';
import { STATUS } from '../state/format';

export function StatusPill({ status }: { status: RunStatus }) {
  const { label, tone } = STATUS[status];
  return (
    <span className={`pill tone-${tone}`} data-status={status}>
      {status === 'running' && <span className="pulse" aria-hidden="true" />}
      {label}
    </span>
  );
}
