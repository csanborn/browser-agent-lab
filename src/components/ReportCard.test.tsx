import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EMPTY_RUN } from '../../shared/run-view';
import { ReportCard } from './ReportCard';

describe('ReportCard', () => {
  it('flags low confidence', () => {
    render(<ReportCard view={{ ...EMPTY_RUN, status: 'succeeded', durationMs: 4000, report: { status: 'done', answer: 'Probably 14 days', confidence: 0.3 } }} />);
    expect(screen.getByText('Probably 14 days')).toBeInTheDocument();
    expect(screen.getByText('Low confidence')).toBeInTheDocument();
    expect(screen.getByRole('meter', { name: 'Agent confidence' })).toHaveAttribute('aria-valuenow', '30');
  });

  it('shows the error when there is no report', () => {
    render(<ReportCard view={{ ...EMPTY_RUN, status: 'step_limit', durationMs: 1000, error: 'Reached the 25-step limit.' }} />);
    expect(screen.getByRole('heading', { name: 'Hit the step limit' })).toBeInTheDocument();
    expect(screen.getByText('Reached the 25-step limit.')).toBeInTheDocument();
  });
});
