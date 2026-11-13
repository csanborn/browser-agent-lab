import { describe, expect, it } from 'vitest';
import { parseAction, type ParsedAction } from './actions';
import { Allowlist } from './allowlist';
import { assess, type ElementInfo } from './guardrail';

const allowlist = () => new Allowlist(['localhost:4174']);

function action(name: string, input: unknown): ParsedAction {
  const parsed = parseAction(name, input);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.action;
}

const click = action('left_click', { target: { type: 'ref', ref: 'ref_1' } });

function el(overrides: Partial<ElementInfo>): ElementInfo {
  return { tag: 'button', role: 'button', name: 'Open', submits: false, inForm: false, ...overrides };
}

describe('assess', () => {
  it('lets navigation inside the allowlist through', () => {
    expect(assess(action('navigate', { url: 'http://localhost:4174/shop' }), null, allowlist())).toEqual({ level: 'allow' });
  });

  it('asks before leaving the allowlist', () => {
    const verdict = assess(action('navigate', { url: 'https://claim-rewards.example/verify' }), null, allowlist());
    expect(verdict).toMatchObject({ level: 'approve', risk: { kind: 'off_allowlist' } });
  });

  it('blocks non-http navigation outright', () => {
    expect(assess(action('navigate', { url: 'javascript:alert(1)' }), null, allowlist()).level).toBe('block');
  });

  it('asks before submitting a POST form', () => {
    const verdict = assess(click, el({ name: 'Save settings', submits: true, inForm: true, formMethod: 'post' }), allowlist());
    expect(verdict).toMatchObject({ level: 'approve', risk: { kind: 'form_submit' } });
  });

  it('lets GET forms such as search run without asking', () => {
    expect(assess(click, el({ name: 'Search', submits: true, inForm: true, formMethod: 'get' }), allowlist())).toEqual({ level: 'allow' });
  });

  it('asks before consequential buttons outside forms', () => {
    expect(assess(click, el({ name: 'Buy now' }), allowlist())).toMatchObject({ level: 'approve', risk: { kind: 'consequential' } });
    expect(assess(click, el({ name: 'Delete account' }), allowlist())).toMatchObject({ level: 'approve' });
  });

  it('does not treat checkout or add-to-cart as consequential', () => {
    expect(assess(click, el({ name: 'Checkout', role: 'link', tag: 'a' }), allowlist())).toEqual({ level: 'allow' });
    expect(assess(click, el({ name: 'Add to cart' }), allowlist())).toEqual({ level: 'allow' });
  });

  it('asks before following a link off the allowlist', () => {
    const link = el({ tag: 'a', role: 'link', name: 'Claim', href: 'https://elsewhere.test/x' });
    expect(assess(click, link, allowlist())).toMatchObject({ level: 'approve', risk: { kind: 'off_allowlist' } });
  });

  it('asks when Enter would submit a POST form', () => {
    const field = el({ tag: 'input', role: 'textbox', name: 'Email', inForm: true, formMethod: 'post' });
    expect(assess(action('key', { text: 'Enter' }), field, allowlist())).toMatchObject({ level: 'approve', risk: { kind: 'form_submit' } });
    expect(assess(action('key', { text: 'Tab' }), field, allowlist())).toEqual({ level: 'allow' });
    const area = el({ tag: 'textarea', role: 'textbox', inForm: true, formMethod: 'post' });
    expect(assess(action('key', { text: 'Enter' }), area, allowlist())).toEqual({ level: 'allow' });
  });

  it('asks before typing into password or card fields', () => {
    const password = el({ tag: 'input', role: 'textbox', inputType: 'password' });
    const card = el({ tag: 'input', role: 'textbox', autocomplete: 'cc-number' });
    expect(assess(action('type', { text: 'x' }), password, allowlist())).toMatchObject({ risk: { kind: 'sensitive_input' } });
    expect(assess(action('form_input', { target: { type: 'ref', ref: 'ref_2' }, value: '4242' }), card, allowlist())).toMatchObject({ risk: { kind: 'sensitive_input' } });
  });

  it('allows reading actions', () => {
    expect(assess(action('read_page', {}), null, allowlist())).toEqual({ level: 'allow' });
  });
});
