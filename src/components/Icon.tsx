const PATHS = {
  globe: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 0c2.5 2.4 3.8 5.4 3.8 9s-1.3 6.6-3.8 9m0-18C9.5 5.4 8.2 8.4 8.2 12s1.3 6.6 3.8 9M3.5 9h17M3.5 15h17',
  pointer: 'm5 3 13 7-6 2-2 6L5 3Z',
  keyboard: 'M3 7h18v10H3zM7 11h.01M11 11h.01M15 11h.01M8 14h8',
  eye: 'M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12Zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  scroll: 'M12 4v16m0 0-4-4m4 4 4-4',
  camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v5l3 2',
  shield: 'M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6l-8-3Z',
  check: 'm5 12 5 5 9-10',
  x: 'm6 6 12 12M18 6 6 18',
  pause: 'M8 5v14M16 5v14',
  play: 'M7 4v16l13-8L7 4Z',
  stop: 'M6 6h12v12H6z',
  alert: 'M12 4 2 20h20L12 4Zm0 6v4m0 3h.01',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

export function iconForAction(action: string): IconName {
  if (action === 'navigate') return 'globe';
  if (action.endsWith('click') || action === 'hover') return 'pointer';
  if (action === 'type' || action === 'key' || action === 'form_input') return 'keyboard';
  if (action === 'read_page' || action === 'find' || action === 'get_page_text') return 'eye';
  if (action === 'scroll' || action === 'scroll_to') return 'scroll';
  if (action === 'screenshot' || action === 'zoom') return 'camera';
  if (action === 'wait') return 'clock';
  return 'pointer';
}
