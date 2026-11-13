import { useEffect, useRef } from 'react';

const TYPING = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

/**
 * Single-key shortcuts ("p", or "shift+s" with Shift held), ignored while the user is typing in a field or holding a
 * modifier, so they never fire by accident inside the task box.
 */
export function useShortcuts(map: Record<string, (() => void) | undefined>): void {
  const ref = useRef(map);
  useEffect(() => {
    ref.current = map;
  });
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target && (TYPING.has(target.tagName) || target.isContentEditable)) return;
      const key = event.shiftKey ? `shift+${event.key.toLowerCase()}` : event.key.toLowerCase();
      const handler = ref.current[key];
      if (handler) {
        event.preventDefault();
        handler();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
