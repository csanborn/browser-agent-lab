import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { StepView } from '../../shared/run-view';
import { Timeline } from './Timeline';

const steps: StepView[] = [
  { step: 1, action: 'navigate', label: 'Go to /docs', reason: 'Start at the docs.', state: 'done', summary: 'Loaded', ms: 320, screenshot: '/f/1.jpg' },
  { step: 2, action: 'left_click', label: 'Click ref_9', reason: '', state: 'failed', summary: 'Error: ref_9 is stale', ms: 40, retried: true },
  { step: 3, action: 'left_click', label: 'Click button "Place order"', reason: 'Finish checkout.', state: 'declined', approval: { approvalId: 'r:3', risk: { kind: 'form_submit', reason: 'x' }, decision: 'denied', by: 'user' } },
];

describe('Timeline', () => {
  it('shows each step with its action, reason and state', () => {
    render(<Timeline steps={steps} selected={null} onSelect={() => undefined} />);
    const items = within(screen.getByRole('list', { name: 'Steps' })).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(within(items[0]!).getByText('Start at the docs.')).toBeInTheDocument();
    expect(within(items[1]!).getByText('Failed')).toBeInTheDocument();
    expect(within(items[1]!).getByText('Retried once')).toBeInTheDocument();
    expect(within(items[2]!).getByText('Submits a form: denied')).toBeInTheDocument();
  });

  it('lets the user pick a step to inspect its page', async () => {
    const onSelect = vi.fn();
    render(<Timeline steps={steps} selected={null} onSelect={onSelect} />);
    await userEvent.click(screen.getByRole('button', { name: 'Show the page after step 1' }));
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it('has an empty state', () => {
    render(<Timeline steps={[]} selected={null} onSelect={() => undefined} />);
    expect(screen.getByText(/Steps appear here/)).toBeInTheDocument();
  });
});
