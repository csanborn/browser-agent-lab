import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApprovalCard } from './ApprovalCard';

const pending = { approvalId: 'r:3', step: 3, label: 'Click button "Place order"', risk: { kind: 'form_submit' as const, reason: 'Submits a form (button "Place order").' } };

describe('ApprovalCard', () => {
  it('explains the risk and focuses the card, not a button', () => {
    render(<ApprovalCard pending={pending} onDecide={() => undefined} />);
    expect(screen.getByRole('heading', { name: 'Approve step 3?' })).toBeInTheDocument();
    expect(screen.getByText('Submits a form')).toBeInTheDocument();
    expect(screen.getByText(/will not continue until you decide/)).toBeInTheDocument();
    expect(document.activeElement).toHaveAttribute('aria-labelledby', 'approval-title');
  });

  it('sends the decision', async () => {
    const onDecide = vi.fn();
    render(<ApprovalCard pending={pending} onDecide={onDecide} />);
    await userEvent.click(screen.getByRole('button', { name: /Deny/ }));
    expect(onDecide).toHaveBeenCalledWith('denied');
    await userEvent.click(screen.getByRole('button', { name: /Approve/ }));
    expect(onDecide).toHaveBeenCalledWith('approved');
  });

  it('does not approve on a stray Enter', async () => {
    const onDecide = vi.fn();
    render(<ApprovalCard pending={pending} onDecide={onDecide} />);
    await userEvent.keyboard('{Enter}');
    expect(onDecide).not.toHaveBeenCalled();
  });
});
