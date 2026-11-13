import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TaskComposer } from './TaskComposer';

const presets = [{ id: 'p', skill: 'Pagination', task: 'When was order #10427 placed?', startUrl: 'http://localhost:4174/orders/' }];

describe('TaskComposer', () => {
  it('fills the form from a preset and starts the run', async () => {
    const onStart = vi.fn().mockResolvedValue(undefined);
    render(<TaskComposer presets={presets} demo={false} defaultUrl="http://localhost:4174/" onStart={onStart} />);
    await userEvent.click(screen.getByRole('button', { name: /When was order/ }));
    expect(screen.getByLabelText('Start page')).toHaveValue('http://localhost:4174/orders/');
    await userEvent.click(screen.getByRole('button', { name: 'Run task' }));
    expect(onStart).toHaveBeenCalledWith('When was order #10427 placed?', 'http://localhost:4174/orders/');
  });

  it('submits with Cmd+Enter and shows server errors', async () => {
    const onStart = vi.fn().mockRejectedValue(new Error('Only preset tasks run in demo mode.'));
    render(<TaskComposer presets={presets} demo defaultUrl="http://localhost:4174/" onStart={onStart} />);
    await userEvent.type(screen.getByLabelText('What should the agent do?'), 'Buy a tent{Meta>}{Enter}{/Meta}');
    expect(onStart).toHaveBeenCalledWith('Buy a tent', 'http://localhost:4174/');
    expect(await screen.findByRole('alert')).toHaveTextContent('Only preset tasks run in demo mode.');
  });

  it('keeps the run button disabled until there is a task', () => {
    render(<TaskComposer presets={[]} demo={false} defaultUrl="http://localhost:4174/" onStart={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Run task' })).toBeDisabled();
  });
});
