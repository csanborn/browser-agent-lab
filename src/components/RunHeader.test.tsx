import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EMPTY_RUN, type RunView } from '../../shared/run-view';
import { RunHeader } from './RunHeader';

const view: RunView = {
  ...EMPTY_RUN,
  runId: 'r1',
  task: 'Find the rate limit',
  startUrl: 'http://localhost:4174/docs/',
  model: 'claude-opus-5-5',
  status: 'running',
  limits: { maxSteps: 20, maxDurationMs: 60_000, maxCostUsd: 1 },
  startedAt: 0,
  steps: [{ step: 1, action: 'navigate', label: 'Go', reason: '', state: 'done' }],
};

const noop = () => undefined;

describe('RunHeader', () => {
  it('shows progress against each limit', () => {
    render(<RunHeader view={view} now={15_000} onPause={noop} onResume={noop} onStop={noop} />);
    expect(screen.getByRole('progressbar', { name: 'Steps' })).toHaveAttribute('aria-valuetext', '1 of 20');
    expect(screen.getByRole('progressbar', { name: 'Time' })).toHaveAttribute('aria-valuetext', '15s of 1m 0s');
    expect(screen.getByText('Working')).toBeInTheDocument();
    expect(screen.getByText('Deciding the next step')).toBeInTheDocument();
  });

  it('wires pause and stop, and offers resume while paused', async () => {
    const onPause = vi.fn();
    const onStop = vi.fn();
    const onResume = vi.fn();
    const { rerender } = render(<RunHeader view={view} now={0} onPause={onPause} onResume={onResume} onStop={onStop} />);
    await userEvent.click(screen.getByRole('button', { name: /Pause/ }));
    await userEvent.click(screen.getByRole('button', { name: /Stop/ }));
    expect(onPause).toHaveBeenCalled();
    expect(onStop).toHaveBeenCalled();
    rerender(<RunHeader view={{ ...view, status: 'paused' }} now={0} onPause={onPause} onResume={onResume} onStop={onStop} />);
    await userEvent.click(screen.getByRole('button', { name: /Resume/ }));
    expect(onResume).toHaveBeenCalled();
  });

  it('shows API retries as a visible state', () => {
    render(<RunHeader view={{ ...view, retrying: { attempt: 2, reason: 'rate limited', until: 3000 } }} now={0} onPause={noop} onResume={noop} onStop={noop} />);
    expect(screen.getByRole('status')).toHaveTextContent('The API is busy (rate limited). Retrying in 3s, attempt 2.');
  });

  it('hides the controls once the run is over', () => {
    render(<RunHeader view={{ ...view, status: 'succeeded', durationMs: 5000 }} now={0} onPause={noop} onResume={noop} onStop={noop} />);
    expect(screen.queryByRole('button', { name: /Pause/ })).not.toBeInTheDocument();
  });
});
