import { readFileSync } from 'node:fs';
import { chromium, errors, type Browser, type BrowserContext, type ElementHandle, type Page } from 'playwright';
import type { BetaToolResultBlockParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import type { ParsedAction, Target } from './actions';
import { normalizeNavigation, type Allowlist } from './allowlist';
import type { ElementInfo } from './guardrail';

export type ResultContent = Exclude<BetaToolResultBlockParam['content'], undefined | string>;

export interface ActionOutcome {
  content: ResultContent;
  /** One line for the timeline. */
  summary: string;
}

/** Raised for failures the model should read and work around (stale ref, bad coordinate). */
export class ActionError extends Error {}

interface PageAgent {
  snapshot(opts: { filter?: string; depth?: number; ref?: string }): { text?: string; error?: string };
  find(query: string): string;
  pageText(): string;
  resolve(ref: string): Element | null;
  describe(ref: string): ElementInfo | null;
  describeAt(x: number, y: number): ElementInfo | null;
  describeFocused(): ElementInfo | null;
}

declare global {
  interface Window {
    __agent: PageAgent;
  }
}

export const VIEWPORT = { width: 1280, height: 800 } as const;
const TAB_ID = 'tab-1';
const PAGE_AGENT = readFileSync(new URL('./page-agent.js', import.meta.url), 'utf8');

const KEY_NAMES: Record<string, string> = {
  ctrl: 'Control', control: 'Control', cmd: 'Meta', command: 'Meta', meta: 'Meta', super: 'Meta', win: 'Meta',
  alt: 'Alt', option: 'Alt', shift: 'Shift', enter: 'Enter', return: 'Enter', esc: 'Escape', escape: 'Escape',
  backspace: 'Backspace', delete: 'Delete', del: 'Delete', tab: 'Tab', space: 'Space', up: 'ArrowUp',
  down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', pageup: 'PageUp', page_up: 'PageUp',
  pagedown: 'PageDown', page_down: 'PageDown', home: 'Home', end: 'End',
};

/** Turns "ctrl+a" or "Return" into Playwright's key names ("Control+a", "Enter"). */
export function toPlaywrightKey(combo: string): string {
  return combo
    .split('+')
    .map((part) => KEY_NAMES[part.toLowerCase()] ?? (part.length === 1 ? part : part[0]!.toUpperCase() + part.slice(1)))
    .join('+');
}

function toModifiers(raw: string | undefined): Array<'Alt' | 'Control' | 'Meta' | 'Shift'> {
  if (!raw) return [];
  return raw
    .split('+')
    .map((part) => KEY_NAMES[part.trim().toLowerCase()])
    .filter((key): key is 'Alt' | 'Control' | 'Meta' | 'Shift' => key === 'Alt' || key === 'Control' || key === 'Meta' || key === 'Shift');
}

const text = (value: string) => ({ type: 'text' as const, text: value });

export class BrowserPool {
  private constructor(private readonly browser: Browser) {}

  static async launch(options: { headless?: boolean } = {}): Promise<BrowserPool> {
    const browser = await chromium.launch({ headless: options.headless ?? true });
    return new BrowserPool(browser);
  }

  /** Each run gets a fresh context: no cookies, storage or credentials carry over. */
  async session(allowlist: Allowlist): Promise<BrowserSession> {
    const context = await this.browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 1, acceptDownloads: false });
    context.setDefaultTimeout(5_000);
    context.setDefaultNavigationTimeout(15_000);
    await context.addInitScript({ content: PAGE_AGENT });
    // Network-level allowlist: requests to other hosts never leave the browser,
    // including redirects and subresources, no matter what the page or model does.
    await context.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith('data:') || url.startsWith('blob:') || allowlist.allows(url)) return route.continue();
      return route.abort('blockedbyclient');
    });
    const page = await context.newPage();
    return new BrowserSession(context, page);
  }

  async close(): Promise<void> {
    await this.browser.close();
  }
}

export class BrowserSession {
  constructor(
    private readonly context: BrowserContext,
    readonly page: Page,
  ) {}

  url(): string {
    return this.page.url();
  }

  async open(url: string): Promise<void> {
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
  }

  /** JPEG frame for the UI timeline. Never sent to the model. */
  async frame(): Promise<Buffer> {
    return this.page.screenshot({ type: 'jpeg', quality: 60 });
  }

  async describe(action: ParsedAction): Promise<ElementInfo | null> {
    const input = action.input as { target?: Target };
    try {
      if (input.target?.type === 'ref') {
        const ref = input.target.ref;
        return await this.page.evaluate((r) => window.__agent.describe(r), ref);
      }
      if (input.target?.type === 'coordinate') {
        const { x, y } = input.target;
        return await this.page.evaluate(([px, py]) => window.__agent.describeAt(px, py), [x, y] as const);
      }
      if (action.name === 'key' || action.name === 'type') {
        return await this.page.evaluate(() => window.__agent.describeFocused());
      }
    } catch {
      // The page is mid-navigation; the action itself will report what went wrong.
    }
    return null;
  }

  async run(action: ParsedAction): Promise<ActionOutcome> {
    const before = this.page.url();
    let outcome: ActionOutcome;
    try {
      outcome = await this.dispatch(action);
    } catch (error) {
      if (String(error).includes('ERR_BLOCKED_BY_CLIENT')) {
        await this.page.waitForURL((url) => url.protocol === 'chrome-error:', { timeout: 2_000 }).catch(() => undefined);
      }
      throw error;
    } finally {
      // A blocked request leaves Chromium on its error page. Go back so the agent
      // keeps a working page and the next navigation is not interrupted.
      if (this.page.url().startsWith('chrome-error://')) await this.page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => undefined);
    }
    const after = this.page.url();
    if (action.name === 'navigate' || before !== after) outcome.content.push(await this.state());
    return outcome;
  }

  private async state(): Promise<ResultContent[number]> {
    return {
      type: 'browser_state',
      tabs: [{ tab_id: TAB_ID, title: (await this.page.title().catch(() => '')).slice(0, 4096), url: this.page.url().slice(0, 4096), active: true }],
    };
  }

  private async element(ref: string): Promise<ElementHandle<Element>> {
    const handle = await this.page.evaluateHandle((r) => window.__agent.resolve(r), ref);
    const element = handle.asElement();
    if (!element) {
      await handle.dispose();
      throw new ActionError(`Error: ${ref} is stale or not found on the current page. Re-read the page to get fresh references.`);
    }
    return element as ElementHandle<Element>;
  }

  private checkPoint(x: number, y: number): void {
    if (x < 0 || y < 0 || x >= VIEWPORT.width || y >= VIEWPORT.height) {
      throw new ActionError(`Error: (${x}, ${y}) is outside the ${VIEWPORT.width}x${VIEWPORT.height} viewport.`);
    }
  }

  /** Gives clicks that start a navigation or a fetch a moment to land. */
  private async settle(): Promise<void> {
    await this.page.waitForLoadState('domcontentloaded', { timeout: 5_000 }).catch(() => undefined);
    await this.page.waitForTimeout(120);
  }

  private async pointer(target: Target, run: (point: { x: number; y: number } | ElementHandle<Element>) => Promise<void>): Promise<string> {
    if (target.type === 'coordinate') {
      this.checkPoint(target.x, target.y);
      await run({ x: target.x, y: target.y });
      return `(${target.x}, ${target.y})`;
    }
    const element = await this.element(target.ref);
    try {
      await run(element);
    } finally {
      await element.dispose();
    }
    return `element ${target.ref}`;
  }

  private async dispatch(action: ParsedAction): Promise<ActionOutcome> {
    const { page } = this;
    switch (action.name) {
      case 'navigate': {
        const nav = normalizeNavigation(action.input.url);
        if (nav.kind === 'refused') throw new ActionError(`Error: ${nav.reason}`);
        if (nav.kind === 'history') {
          if (nav.verb === 'back') await page.goBack({ waitUntil: 'domcontentloaded' });
          else if (nav.verb === 'forward') await page.goForward({ waitUntil: 'domcontentloaded' });
          else await page.reload({ waitUntil: 'domcontentloaded' });
          return { content: [text(`Went ${nav.verb}. Now at ${page.url()}`)], summary: `Now at ${page.url()}` };
        }
        await page.goto(nav.url, { waitUntil: 'domcontentloaded' });
        return { content: [text(`Navigated to ${page.url()}`)], summary: `Loaded ${page.url()}` };
      }
      case 'screenshot': {
        const png = await page.screenshot({ type: 'png' });
        return { content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: png.toString('base64') } }], summary: 'Captured the viewport' };
      }
      case 'zoom': {
        const [x0, y0, x1, y1] = action.input.region;
        this.checkPoint(x0, y0);
        this.checkPoint(x1 - 1, y1 - 1);
        if (x1 <= x0 || y1 <= y0) throw new ActionError('Error: zoom region must have x1 > x0 and y1 > y0.');
        const png = await page.screenshot({ type: 'png', clip: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 } });
        return { content: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: png.toString('base64') } }], summary: 'Zoomed into a region' };
      }
      case 'left_click':
      case 'right_click':
      case 'middle_click':
      case 'double_click':
      case 'triple_click': {
        const button = action.name === 'right_click' ? 'right' : action.name === 'middle_click' ? 'middle' : 'left';
        const clickCount = action.name === 'double_click' ? 2 : action.name === 'triple_click' ? 3 : 1;
        const modifiers = toModifiers(action.input.modifiers);
        const where = await this.pointer(action.input.target, async (point) => {
          if ('x' in point) {
            for (const key of modifiers) await page.keyboard.down(key);
            await page.mouse.click(point.x, point.y, { button, clickCount });
            for (const key of modifiers) await page.keyboard.up(key);
          } else {
            await point.click({ button, clickCount, modifiers });
          }
        });
        await this.settle();
        return { content: [text(`Clicked ${where}.`)], summary: `Clicked ${where}` };
      }
      case 'hover': {
        const where = await this.pointer(action.input.target, (point) => ('x' in point ? page.mouse.move(point.x, point.y) : point.hover()));
        return { content: [text(`Hovered ${where}.`)], summary: `Hovered ${where}` };
      }
      case 'scroll': {
        const { x, y } = action.input.target;
        this.checkPoint(x, y);
        const amount = (action.input.scroll_amount ?? 3) * 100;
        const dir = action.input.scroll_direction;
        await page.mouse.move(x, y);
        await page.mouse.wheel(dir === 'left' ? -amount : dir === 'right' ? amount : 0, dir === 'up' ? -amount : dir === 'down' ? amount : 0);
        await page.waitForTimeout(150);
        const scrollY = await page.evaluate(() => Math.round(window.scrollY));
        return { content: [text(`Scrolled ${dir}. Page is now at y=${scrollY}.`)], summary: `Scrolled ${dir}` };
      }
      case 'scroll_to': {
        await this.pointer(action.input.target, async (point) => {
          if (!('x' in point)) await point.scrollIntoViewIfNeeded();
        });
        return { content: [text(`Scrolled ${action.input.target.ref} into view.`)], summary: `Scrolled to ${action.input.target.ref}` };
      }
      case 'type': {
        await page.keyboard.type(action.input.text, { delay: 8 });
        return { content: [text(`Typed ${action.input.text.length} characters.`)], summary: `Typed ${action.input.text.length} characters` };
      }
      case 'key': {
        const combos = action.input.text.split(/\s+/).filter(Boolean).map(toPlaywrightKey);
        for (let i = 0; i < (action.input.repeat ?? 1); i += 1) for (const combo of combos) await page.keyboard.press(combo);
        await this.settle();
        return { content: [text(`Pressed ${combos.join(' ')}.`)], summary: `Pressed ${combos.join(' ')}` };
      }
      case 'wait': {
        await page.waitForTimeout(action.input.duration * 1000);
        return { content: [text(`Waited ${action.input.duration}s.`)], summary: `Waited ${action.input.duration}s` };
      }
      case 'read_page': {
        const { filter, depth, ref } = action.input;
        const result = await page.evaluate((opts) => window.__agent.snapshot(opts), { filter, depth, ref });
        if (result.error) throw new ActionError(result.error);
        const body = result.text ?? '';
        return { content: [text(body)], summary: `Read ${body.split('\n').length} lines` };
      }
      case 'find': {
        const result = await page.evaluate((query) => window.__agent.find(query), action.input.query);
        const count = result.startsWith('No elements') ? 0 : result.split('\n').length;
        return { content: [text(result)], summary: count ? `Found ${count} match${count === 1 ? '' : 'es'}` : 'No matches' };
      }
      case 'get_page_text': {
        const body = await page.evaluate(() => window.__agent.pageText());
        return { content: [text(body || '(the page has no visible text)')], summary: `Read ${body.length} characters` };
      }
      case 'form_input': {
        const { target, value } = action.input;
        const element = await this.element(target.ref);
        try {
          const kind = await element.evaluate((el) => (el instanceof HTMLSelectElement ? 'select' : el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio') ? 'check' : 'fill'));
          if (kind === 'select') {
            const wanted = String(value);
            const byLabel = await element.selectOption({ label: wanted }).catch(() => null);
            if (!byLabel?.length) await element.selectOption({ value: wanted });
          } else if (kind === 'check') {
            await element.setChecked(Boolean(value));
          } else {
            await element.fill(String(value));
          }
        } finally {
          await element.dispose();
        }
        return { content: [text(`Set ${target.ref} to ${JSON.stringify(value)}.`)], summary: 'Value set' };
      }
    }
  }

  async close(): Promise<void> {
    await this.context.close();
  }
}

/** Playwright timeouts are worth one retry (an animation, a late render). Everything else is not. */
export function isTransient(error: unknown): boolean {
  return error instanceof errors.TimeoutError;
}

/** Turns a Playwright error into one line the model can act on. */
export function explain(error: unknown): string {
  if (error instanceof ActionError) return error.message;
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('ERR_BLOCKED_BY_CLIENT')) return 'Error: blocked. That host is not on the allowlist for this task.';
  if (message.includes('intercepts pointer events')) {
    const match = /<([a-z]+)[^>]*>.*? intercepts pointer events/s.exec(message);
    return `Error: another element${match ? ` (<${match[1]}>)` : ''} is covering the target. Close or dismiss it first.`;
  }
  if (error instanceof errors.TimeoutError) return 'Error: the element did not become ready in time (hidden, disabled or covered). Re-read the page.';
  const firstLine = message.split('\n')[0] ?? message;
  return `Error: ${firstLine.slice(0, 300)}`;
}
