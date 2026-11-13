import type { Risk } from '../shared/events';
import type { ParsedAction } from './actions';
import { normalizeNavigation, type Allowlist } from './allowlist';

/** What the page agent reports about the element an action would touch. */
export interface ElementInfo {
  tag: string;
  role: string;
  name: string;
  inputType?: string;
  autocomplete?: string;
  href?: string;
  /** True when activating the element submits its form. */
  submits: boolean;
  formMethod?: 'get' | 'post' | 'dialog';
  inForm: boolean;
}

export type Verdict = { level: 'allow' } | { level: 'approve'; risk: Risk } | { level: 'block'; reason: string };

// Words on a control that usually mean money moves, data leaves or something is
// hard to undo. "Checkout" is left out on purpose: it opens a page, it doesn't buy.
const CONSEQUENTIAL =
  /\b(buy|purchase|pay|place order|confirm order|complete order|send|delete|remove|unsubscribe|subscribe|transfer|book now|sign up|confirm|submit)\b/i;

const SENSITIVE_AUTOCOMPLETE = /^cc-|^(current-password|new-password|one-time-code)$/;

const CLICKS = new Set(['left_click', 'right_click', 'middle_click', 'double_click', 'triple_click']);

function describe(el: ElementInfo): string {
  return el.name ? `${el.role} "${el.name}"` : el.role;
}

function isSensitiveField(el: ElementInfo): boolean {
  return el.inputType === 'password' || SENSITIVE_AUTOCOMPLETE.test(el.autocomplete ?? '');
}

function submitRisk(el: ElementInfo): Risk | null {
  // GET forms (search boxes, filters) only read data, so they run without asking.
  if (!el.submits || el.formMethod === 'get') return null;
  return { kind: 'form_submit', reason: `Submits a form (${describe(el)}).` };
}

/**
 * Decides, before an action runs, whether it can go ahead, needs the user's
 * approval or must be refused. `element` is the element the action targets
 * (for `key` and `type`, the focused element).
 */
export function assess(action: ParsedAction, element: ElementInfo | null, allowlist: Allowlist): Verdict {
  if (action.name === 'navigate') {
    const nav = normalizeNavigation(action.input.url);
    if (nav.kind === 'refused') return { level: 'block', reason: nav.reason };
    if (nav.kind === 'url' && !allowlist.allows(nav.url)) {
      return { level: 'approve', risk: { kind: 'off_allowlist', reason: `Leaves the allowed sites for ${new URL(nav.url).host}.` } };
    }
    return { level: 'allow' };
  }

  if (!element) return { level: 'allow' };

  if (CLICKS.has(action.name)) {
    if (element.href && /^https?:/i.test(element.href) && !allowlist.allows(element.href)) {
      return { level: 'approve', risk: { kind: 'off_allowlist', reason: `Opens ${new URL(element.href).host}, which is not on the allowlist.` } };
    }
    const submit = submitRisk(element);
    if (submit) return { level: 'approve', risk: submit };
    if (CONSEQUENTIAL.test(element.name)) {
      return { level: 'approve', risk: { kind: 'consequential', reason: `"${element.name}" may make a change that is hard to undo.` } };
    }
    return { level: 'allow' };
  }

  if (action.name === 'key') {
    const pressesEnter = /(^|\s|\+)enter($|\s)/i.test(action.input.text);
    const singleLine = element.tag === 'input';
    if (pressesEnter && singleLine && element.inForm && element.formMethod !== 'get') {
      return { level: 'approve', risk: { kind: 'form_submit', reason: 'Pressing Enter here submits the form.' } };
    }
    return { level: 'allow' };
  }

  if (action.name === 'type' || action.name === 'form_input') {
    if (isSensitiveField(element)) {
      return { level: 'approve', risk: { kind: 'sensitive_input', reason: `Enters data into a sensitive field (${describe(element)}).` } };
    }
    return { level: 'allow' };
  }

  return { level: 'allow' };
}
