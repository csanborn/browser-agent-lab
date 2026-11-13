import { describe, expect, it } from 'vitest';
import { Allowlist, hostOf, normalizeNavigation } from './allowlist';

describe('Allowlist', () => {
  it('matches exact hosts with and without ports', () => {
    const list = new Allowlist(['localhost:4174', 'docs.example.com']);
    expect(list.allows('http://localhost:4174/shop')).toBe(true);
    expect(list.allows('http://localhost:9999/')).toBe(false);
    expect(list.allows('https://docs.example.com/a')).toBe(true);
    expect(list.allows('https://docs.example.com:8443/a')).toBe(true);
    expect(list.allows('https://example.com/')).toBe(false);
  });

  it('parses URLs instead of matching prefixes', () => {
    const list = new Allowlist(['example.com']);
    expect(list.allows('https://example.com.attacker.test/')).toBe(false);
    expect(list.allows('https://attacker.test/?next=https://example.com')).toBe(false);
    expect(list.allows('https://user@attacker.test')).toBe(false);
  });

  it('supports subdomain wildcards', () => {
    const list = new Allowlist(['*.example.com']);
    expect(list.allows('https://a.b.example.com/')).toBe(true);
    expect(list.allows('https://example.com/')).toBe(true);
    expect(list.allows('https://badexample.com/')).toBe(false);
  });

  it('never allows non-http schemes', () => {
    const list = new Allowlist(['localhost']);
    expect(list.allows('file:///etc/passwd')).toBe(false);
    expect(list.allows('javascript:alert(1)')).toBe(false);
    expect(hostOf('data:text/html,hi')).toBeNull();
  });

  it('admits a host after approval', () => {
    const list = new Allowlist(['localhost:4174']);
    list.admit('https://partner.test/offer');
    expect(list.allows('https://partner.test/other')).toBe(true);
    expect(list.list()).toContain('partner.test');
  });
});

describe('normalizeNavigation', () => {
  it('keeps history verbs', () => {
    expect(normalizeNavigation('back')).toEqual({ kind: 'history', verb: 'back' });
  });

  it('adds https to bare hosts', () => {
    expect(normalizeNavigation('example.com/docs')).toEqual({ kind: 'url', url: 'https://example.com/docs' });
  });

  it('refuses other schemes', () => {
    expect(normalizeNavigation('javascript:alert(1)').kind).toBe('refused');
    expect(normalizeNavigation('file:///tmp/x').kind).toBe('refused');
  });
});
