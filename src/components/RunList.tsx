import type { RunView } from '../../shared/run-view';
import { StatusPill } from './StatusPill';

interface Props {
  runs: RunView[];
  current: string | null;
  onOpen: (id: string) => void;
}

export function RunList({ runs, current, onOpen }: Props) {
  if (!runs.length) return null;
  return (
    <section className="run-list" aria-labelledby="runs-title">
      <h3 id="runs-title">This session</h3>
      <ul>
        {runs.map((run) => (
          <li key={run.runId}>
            <button type="button" className="run-item" aria-current={run.runId === current ? 'true' : undefined} onClick={() => run.runId && onOpen(run.runId)}>
              <span className="run-item-task">{run.task}</span>
              <StatusPill status={run.status} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
