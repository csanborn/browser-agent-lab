import { z } from 'zod';

// Input schemas for the browser toolset members this harness implements.
// The API does not enforce input bounds, so the executor validates every call
// before it touches the page.

const coordinate = z.object({ type: z.literal('coordinate'), x: z.number().int(), y: z.number().int() });
const ref = z.object({ type: z.literal('ref'), ref: z.string().regex(/^ref_\d+$/) });
const target = z.discriminatedUnion('type', [coordinate, ref]);
const tabId = z.string().optional();
const modifiers = z.string().optional();

const click = z.object({ target, modifiers, tab_id: tabId });

export const MEMBER_SCHEMAS = {
  navigate: z.object({ url: z.string().min(1), tab_id: tabId }),
  screenshot: z.object({ tab_id: tabId }),
  zoom: z.object({
    region: z.tuple([z.number(), z.number(), z.number(), z.number()]),
    tab_id: tabId,
  }),
  left_click: click,
  right_click: click,
  middle_click: click,
  double_click: click,
  triple_click: click,
  hover: z.object({ target, tab_id: tabId }),
  scroll: z.object({
    target: coordinate,
    scroll_direction: z.enum(['up', 'down', 'left', 'right']),
    scroll_amount: z.number().int().min(1).max(10).optional(),
    tab_id: tabId,
  }),
  scroll_to: z.object({ target: ref, tab_id: tabId }),
  type: z.object({ text: z.string(), tab_id: tabId }),
  key: z.object({ text: z.string().min(1), repeat: z.number().int().min(1).max(100).optional(), tab_id: tabId }),
  wait: z.object({ duration: z.number().min(0).max(30), tab_id: tabId }),
  read_page: z.object({
    filter: z.enum(['interactive', 'all']).optional(),
    depth: z.number().int().min(1).optional(),
    ref: z.string().optional(),
    tab_id: tabId,
  }),
  find: z.object({ query: z.string().min(1), tab_id: tabId }),
  get_page_text: z.object({ tab_id: tabId }),
  form_input: z.object({ target: ref, value: z.union([z.string(), z.number(), z.boolean()]), tab_id: tabId }),
} as const;

export type MemberName = keyof typeof MEMBER_SCHEMAS;
export type MemberInput<N extends MemberName> = z.infer<(typeof MEMBER_SCHEMAS)[N]>;
export type Target = z.infer<typeof target>;

/** Default-enabled members this harness does not run. They are switched off in the toolset config. */
export const DISABLED_MEMBERS = ['new_tab', 'list_tabs', 'switch_tab', 'close_tab', 'left_click_drag', 'mouse_move'] as const;

export function isImplemented(name: string): name is MemberName {
  return Object.hasOwn(MEMBER_SCHEMAS, name);
}

export type ParsedAction = { [N in MemberName]: { name: N; input: MemberInput<N> } }[MemberName];

export function parseAction(name: string, input: unknown): { ok: true; action: ParsedAction } | { ok: false; error: string } {
  if (!isImplemented(name)) return { ok: false, error: `Error: ${name} is not available in this browser. Use another action.` };
  const result = MEMBER_SCHEMAS[name].safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue?.path.length ? ` at ${issue.path.join('.')}` : '';
    return { ok: false, error: `Error: invalid input for ${name}${where}: ${issue?.message ?? 'unknown problem'}` };
  }
  if (result.data.tab_id !== undefined && result.data.tab_id !== 'tab-1') {
    return { ok: false, error: `Error: tab ${result.data.tab_id} does not exist. This browser has one tab, tab-1.` };
  }
  return { ok: true, action: { name, input: result.data } as ParsedAction };
}

function describeTarget(value: Target, element?: string): string {
  if (element) return element;
  return value.type === 'ref' ? value.ref : `(${value.x}, ${value.y})`;
}

function clip(text: string, max = 60): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Short, human label for the timeline, such as `Click "Add to cart"`. */
export function labelFor(action: ParsedAction, element?: string): string {
  switch (action.name) {
    case 'navigate':
      return `Go to ${clip(action.input.url)}`;
    case 'screenshot':
      return 'Take a screenshot';
    case 'zoom':
      return 'Zoom into a region';
    case 'left_click':
      return `Click ${describeTarget(action.input.target, element)}`;
    case 'right_click':
      return `Right-click ${describeTarget(action.input.target, element)}`;
    case 'middle_click':
      return `Middle-click ${describeTarget(action.input.target, element)}`;
    case 'double_click':
      return `Double-click ${describeTarget(action.input.target, element)}`;
    case 'triple_click':
      return `Triple-click ${describeTarget(action.input.target, element)}`;
    case 'hover':
      return `Hover ${describeTarget(action.input.target, element)}`;
    case 'scroll':
      return `Scroll ${action.input.scroll_direction}`;
    case 'scroll_to':
      return `Scroll to ${describeTarget(action.input.target, element)}`;
    case 'type':
      return `Type "${clip(action.input.text, 40)}"`;
    case 'key':
      return `Press ${action.input.text}`;
    case 'wait':
      return `Wait ${action.input.duration}s`;
    case 'read_page':
      return action.input.filter === 'interactive' ? 'Read the page controls' : 'Read the page';
    case 'find':
      return `Find "${clip(action.input.query, 40)}"`;
    case 'get_page_text':
      return 'Read the page text';
    case 'form_input':
      return `Set ${describeTarget(action.input.target, element)} to ${JSON.stringify(action.input.value)}`;
  }
}
