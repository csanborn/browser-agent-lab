import { useEffect, useReducer } from 'react';
import type { AgentEvent } from '../../shared/events';
import { EMPTY_RUN, reduceRun, type RunView } from '../../shared/run-view';
import { api } from '../api';

/**
 * Streams a run's events over SSE and folds them into its view. The server replays
 * the run's history first, and `run_started` resets the view, so switching runs
 * needs no separate reset.
 */
export function useRun(runId: string | null): RunView {
  const [view, dispatch] = useReducer(reduceRun, EMPTY_RUN);
  useEffect(() => {
    if (!runId) return;
    const source = new EventSource(api.eventsUrl(runId));
    source.onmessage = (message) => dispatch(JSON.parse(message.data as string) as AgentEvent);
    return () => source.close();
  }, [runId]);
  return runId && view.runId === runId ? view : EMPTY_RUN;
}
