// Host allowlist. An entry is a host with an optional port ("localhost:4174",
// "docs.example.com") or a wildcard for subdomains ("*.example.com").
// Matching parses the URL instead of comparing string prefixes, so
// "https://example.com.attacker.test" never passes as "example.com".

export function hostOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.host.toLowerCase();
  } catch {
    return null;
  }
}

function matches(entry: string, host: string): boolean {
  const rule = entry.toLowerCase();
  if (rule.startsWith('*.')) {
    const base = rule.slice(2);
    const hostname = host.split(':')[0] ?? host;
    return hostname === base || hostname.endsWith(`.${base}`);
  }
  if (rule.includes(':')) return host === rule;
  return (host.split(':')[0] ?? host) === rule;
}

export class Allowlist {
  private readonly entries: Set<string>;

  constructor(entries: Iterable<string>) {
    this.entries = new Set([...entries].map((entry) => entry.toLowerCase()));
  }

  allows(url: string): boolean {
    const host = hostOf(url);
    if (!host) return false;
    for (const entry of this.entries) if (matches(entry, host)) return true;
    return false;
  }

  /** Adds the URL's host after the user approves leaving the list. */
  admit(url: string): void {
    const host = hostOf(url);
    if (host) this.entries.add(host);
  }

  list(): string[] {
    return [...this.entries];
  }
}

/**
 * Normalizes what the model passes to `navigate`: keeps history keywords, adds
 * https:// to bare hosts and rejects every scheme other than http and https.
 */
export function normalizeNavigation(raw: string): { kind: 'history'; verb: 'back' | 'forward' | 'reload' } | { kind: 'url'; url: string } | { kind: 'refused'; reason: string } {
  const value = raw.trim();
  if (value === 'back' || value === 'forward' || value === 'reload') return { kind: 'history', verb: value };
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(value);
  const candidate = hasScheme ? value : `https://${value}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { kind: 'refused', reason: 'Navigation refused. Only http and https URLs are allowed.' };
    }
    return { kind: 'url', url: parsed.toString() };
  } catch {
    return { kind: 'refused', reason: `Navigation refused. "${value}" is not a valid URL.` };
  }
}
