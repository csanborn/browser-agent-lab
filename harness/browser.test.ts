import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFixtureServer, type FixtureServer } from '../fixtures/server';
import { parseAction, type ParsedAction } from './actions';
import { Allowlist } from './allowlist';
import { ActionError, BrowserPool, explain, toPlaywrightKey, type BrowserSession } from './browser';

let pool: BrowserPool;
let fixtures: FixtureServer;
let session: BrowserSession;

beforeAll(async () => {
  fixtures = await startFixtureServer(0);
  pool = await BrowserPool.launch();
  session = await pool.session(new Allowlist([fixtures.host]));
});
afterAll(async () => {
  await session?.close();
  await pool?.close();
  await fixtures?.close();
});

function action(name: string, input: unknown): ParsedAction {
  const parsed = parseAction(name, input);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.action;
}

async function text(name: string, input: unknown): Promise<string> {
  const outcome = await session.run(action(name, input));
  return outcome.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n');
}

describe('BrowserSession', () => {
  it('reads the page as roles, names and refs, with labels for form fields', async () => {
    await session.open(`${fixtures.origin}/account/settings`);
    const page = await text('read_page', { filter: 'interactive' });
    expect(page).toMatch(/combobox "Newsletter" \[ref_\d+\] value="Weekly"/);
    expect(page).toMatch(/checkbox "SMS alerts for orders" \[ref_\d+\] checked/);
  });

  it('sets form values through refs', async () => {
    const page = await text('read_page', { filter: 'interactive' });
    const ref = /combobox "Newsletter" \[(ref_\d+)\]/.exec(page)![1]!;
    await text('form_input', { target: { type: 'ref', ref }, value: 'Monthly' });
    expect(await text('read_page', { filter: 'interactive' })).toMatch(/value="Monthly"/);
  });

  it('describes the element an action targets, for the guardrail', async () => {
    const page = await text('find', { query: 'Save settings' });
    const ref = /\[(ref_\d+)\]/.exec(page)![1]!;
    const info = await session.describe(action('left_click', { target: { type: 'ref', ref } }));
    expect(info).toMatchObject({ role: 'button', name: 'Save settings', submits: true, formMethod: 'post' });
  });

  it('reports stale refs after navigation', async () => {
    await session.open(`${fixtures.origin}/docs/`);
    await expect(session.run(action('left_click', { target: { type: 'ref', ref: 'ref_999' } }))).rejects.toBeInstanceOf(ActionError);
  });

  it('notes a blocking modal dialog', async () => {
    await session.open(`${fixtures.origin}/help/`);
    expect(await text('read_page', {})).toMatch(/modal dialog is open/);
  });

  it('blocks requests to hosts off the allowlist and keeps a working page', async () => {
    await session.open(`${fixtures.origin}/`);
    const error = await session.run(action('navigate', { url: 'https://claim-rewards.example/verify' })).catch((err: unknown) => err);
    expect(explain(error)).toMatch(/not on the allowlist/);
    expect(session.url()).toBe(`${fixtures.origin}/`);
  });

  it('rejects coordinates outside the viewport', async () => {
    await expect(session.run(action('left_click', { target: { type: 'coordinate', x: 5000, y: 10 } }))).rejects.toThrow(/outside/);
  });
});

describe('toPlaywrightKey', () => {
  it('maps common key names', () => {
    expect(toPlaywrightKey('ctrl+a')).toBe('Control+a');
    expect(toPlaywrightKey('Return')).toBe('Enter');
    expect(toPlaywrightKey('page_down')).toBe('PageDown');
  });
});
