import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { useShortcuts } from './useShortcuts';

function Harness({ map }: { map: Record<string, (() => void) | undefined> }) {
  useShortcuts(map);
  return <input aria-label="field" />;
}

describe('useShortcuts', () => {
  it('fires single-key and shifted shortcuts', async () => {
    const pause = vi.fn();
    const stop = vi.fn();
    render(<Harness map={{ p: pause, 'shift+s': stop }} />);
    await userEvent.keyboard('p');
    await userEvent.keyboard('s');
    expect(pause).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();
    await userEvent.keyboard('{Shift>}S{/Shift}');
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('ignores keys typed into fields and modified keys', async () => {
    const pause = vi.fn();
    const { getByLabelText } = render(<Harness map={{ p: pause }} />);
    await userEvent.type(getByLabelText('field'), 'p');
    getByLabelText('field').blur();
    await userEvent.keyboard('{Meta>}p{/Meta}');
    expect(pause).not.toHaveBeenCalled();
  });
});
