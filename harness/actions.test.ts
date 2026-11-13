import { describe, expect, it } from 'vitest';
import { labelFor, parseAction } from './actions';

describe('parseAction', () => {
  it('accepts valid member calls', () => {
    const parsed = parseAction('left_click', { target: { type: 'coordinate', x: 10, y: 20 } });
    expect(parsed.ok).toBe(true);
  });

  it('rejects members this browser does not run', () => {
    const parsed = parseAction('javascript_exec', { text: 'alert(1)' });
    expect(parsed).toMatchObject({ ok: false });
    if (!parsed.ok) expect(parsed.error).toMatch(/not available/);
  });

  it('validates bounds the API does not enforce', () => {
    expect(parseAction('scroll', { target: { type: 'coordinate', x: 1, y: 1 }, scroll_direction: 'down', scroll_amount: 50 }).ok).toBe(false);
    expect(parseAction('wait', { duration: 90 }).ok).toBe(false);
    expect(parseAction('form_input', { target: { type: 'ref', ref: 'button-1' }, value: 'x' }).ok).toBe(false);
  });

  it('rejects tabs other than the single tab', () => {
    const parsed = parseAction('screenshot', { tab_id: 'tab-2' });
    expect(parsed.ok).toBe(false);
  });
});

describe('labelFor', () => {
  it('uses the element description when it has one', () => {
    const parsed = parseAction('left_click', { target: { type: 'ref', ref: 'ref_4' } });
    if (!parsed.ok) throw new Error(parsed.error);
    expect(labelFor(parsed.action, 'button "Add to cart"')).toBe('Click button "Add to cart"');
    expect(labelFor(parsed.action)).toBe('Click ref_4');
  });

  it('clips long text', () => {
    const parsed = parseAction('type', { text: 'x'.repeat(100) });
    if (!parsed.ok) throw new Error(parsed.error);
    expect(labelFor(parsed.action).length).toBeLessThan(50);
  });
});
