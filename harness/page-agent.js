// Installed into every document the agent's browser loads (Playwright addInitScript).
// It reads the page the way read_page/find describe it: a role, an accessible name
// and a stable reference per element. Refs live in a WeakMap, so the page's DOM is
// never modified, and they reset only when the document is replaced (navigation).
// Plain JavaScript on purpose: the file is injected as text, untouched by any build.
(() => {
  if (window.__agent) return;

  const refByElement = new WeakMap();
  const elementByRef = new Map();
  let nextRef = 1;

  const INTERACTIVE_ROLES = new Set([
    'link', 'button', 'textbox', 'searchbox', 'checkbox', 'radio', 'combobox', 'listbox',
    'option', 'slider', 'spinbutton', 'switch', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
  ]);
  const LANDMARKS = new Set(['main', 'navigation', 'banner', 'contentinfo', 'form', 'search', 'dialog', 'region', 'complementary']);
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'HEAD', 'META', 'LINK']);

  function refFor(el) {
    let ref = refByElement.get(el);
    if (!ref) {
      ref = `ref_${nextRef++}`;
      refByElement.set(el, ref);
      elementByRef.set(ref, new WeakRef(el));
    }
    return ref;
  }

  function resolve(ref) {
    const el = elementByRef.get(ref)?.deref();
    return el && el.isConnected ? el : null;
  }

  function inputRole(el) {
    const type = (el.getAttribute('type') || 'text').toLowerCase();
    if (type === 'hidden') return null;
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    if (type === 'range') return 'slider';
    if (type === 'number') return 'spinbutton';
    if (type === 'search') return 'searchbox';
    if (['submit', 'button', 'reset', 'image'].includes(type)) return 'button';
    return 'textbox';
  }

  function roleOf(el) {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit.split(/\s+/)[0];
    switch (el.tagName) {
      case 'A': return el.hasAttribute('href') ? 'link' : null;
      case 'BUTTON': return 'button';
      case 'INPUT': return inputRole(el);
      case 'SELECT': return el.multiple ? 'listbox' : 'combobox';
      case 'TEXTAREA': return 'textbox';
      case 'OPTION': return 'option';
      case 'IMG': return el.getAttribute('alt') === '' ? null : 'img';
      case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6': return 'heading';
      case 'NAV': return 'navigation';
      case 'MAIN': return 'main';
      case 'HEADER': return el.closest('article, section, main') ? null : 'banner';
      case 'FOOTER': return el.closest('article, section, main') ? null : 'contentinfo';
      case 'FORM': return 'form';
      case 'DIALOG': return 'dialog';
      case 'TABLE': return 'table';
      case 'TR': return 'row';
      case 'TH': return 'columnheader';
      case 'TD': return 'cell';
      case 'UL': case 'OL': return 'list';
      case 'LI': return 'listitem';
      case 'LABEL': return 'label';
      case 'P': return 'paragraph';
      case 'ARTICLE': return 'article';
      case 'ASIDE': return 'complementary';
      case 'SECTION': return el.hasAttribute('aria-label') || el.hasAttribute('aria-labelledby') ? 'region' : null;
      case 'DETAILS': return 'group';
      case 'SUMMARY': return 'button';
      default:
        if (el.tabIndex >= 0 && el.hasAttribute('tabindex')) return 'generic';
        return null;
    }
  }

  function squash(text, max = 100) {
    const clean = (text || '').replace(/\s+/g, ' ').trim();
    return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
  }

  // Label text without the text of any control nested inside the label (a wrapped
  // <select> would otherwise add every option to the name).
  function textOfLabel(label) {
    const copy = label.cloneNode(true);
    copy.querySelectorAll('select, input, textarea, button').forEach((node) => node.remove());
    return copy.textContent;
  }

  function labelText(el) {
    if (el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label) return textOfLabel(label);
    }
    const wrapping = el.closest('label');
    return wrapping ? textOfLabel(wrapping) : '';
  }

  function nameOf(el, role) {
    const aria = el.getAttribute('aria-label');
    if (aria) return squash(aria);
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const text = labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ');
      if (text.trim()) return squash(text);
    }
    if (['textbox', 'searchbox', 'checkbox', 'radio', 'combobox', 'listbox', 'slider', 'spinbutton', 'switch'].includes(role)) {
      const label = labelText(el);
      if (label.trim()) return squash(label);
      return squash(el.getAttribute('placeholder') || el.getAttribute('title') || el.getAttribute('name') || '');
    }
    if (el.tagName === 'INPUT') return squash(el.value || el.getAttribute('alt') || '');
    if (el.tagName === 'IMG') return squash(el.getAttribute('alt') || el.getAttribute('title') || '');
    if (['link', 'button', 'heading', 'option', 'tab', 'menuitem', 'columnheader', 'cell', 'label', 'generic'].includes(role) || role.startsWith('menuitem')) {
      return squash(el.innerText || el.textContent || '');
    }
    return squash(el.getAttribute('title') || '');
  }

  function isVisible(el) {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    if (Number(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0 || style.display === 'contents';
  }

  function isHiddenSubtree(el) {
    return el.hidden || el.getAttribute('aria-hidden') === 'true' || getComputedStyle(el).display === 'none';
  }

  function isInteractive(el, role) {
    if (role && INTERACTIVE_ROLES.has(role)) return true;
    return el.tagName === 'SUMMARY' || (el.hasAttribute('tabindex') && el.tabIndex >= 0);
  }

  function stateOf(el, role) {
    const parts = [];
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      if (role === 'checkbox' || role === 'radio') parts.push(el.checked ? 'checked' : 'unchecked');
      else if (el.type !== 'password') parts.push(`value=${JSON.stringify(squash(el.value, 80))}`);
      else parts.push(el.value ? 'value=(hidden)' : 'value=""');
    }
    if (el.tagName === 'SELECT') {
      const chosen = [...el.selectedOptions].map((o) => squash(o.textContent, 40));
      parts.push(`value=${JSON.stringify(chosen.join(', '))}`);
      parts.push(`options=${JSON.stringify([...el.options].map((o) => squash(o.textContent, 40)))}`);
    }
    if (el.tagName === 'A' && el.getAttribute('href')) parts.push(`href="${el.getAttribute('href')}"`);
    if (role === 'heading') parts.push(`level=${el.tagName.slice(1) || el.getAttribute('aria-level') || '2'}`);
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') parts.push('disabled');
    if (el.getAttribute('aria-expanded')) parts.push(`expanded=${el.getAttribute('aria-expanded')}`);
    if (el.required) parts.push('required');
    return parts.join(' ');
  }

  function directText(el) {
    let text = '';
    for (const node of el.childNodes) if (node.nodeType === Node.TEXT_NODE) text += node.textContent;
    return squash(text, 200);
  }

  // Walks the DOM and returns { line, depth } entries. Elements without a useful role
  // are flattened into their parent so the outline stays short.
  function walk(root, opts) {
    const lines = [];
    const maxDepth = opts.depth ?? 15;
    const visit = (el, depth) => {
      if (SKIP_TAGS.has(el.tagName.toUpperCase())) return;
      if (!opts.all && (isHiddenSubtree(el) || !isVisible(el))) return;
      const role = roleOf(el);
      const interactive = isInteractive(el, role);
      let nextDepth = depth;
      const include = opts.interactiveOnly ? interactive : role && (interactive || role !== 'generic');
      if (include && role !== 'label') {
        const name = nameOf(el, role);
        const state = stateOf(el, role);
        const show = interactive || name || LANDMARKS.has(role) || ['table', 'row', 'list', 'listitem', 'paragraph', 'article'].includes(role);
        if (show) {
          const parts = [role];
          if (name) parts.push(JSON.stringify(name));
          parts.push(`[${refFor(el)}]`);
          if (state) parts.push(state);
          lines.push({ line: parts.join(' '), depth: opts.interactiveOnly ? 0 : depth });
          nextDepth = depth + 1;
          if (interactive || role === 'heading' || role === 'cell' || role === 'columnheader') return;
        }
      }
      if (!opts.interactiveOnly) {
        const text = directText(el);
        if (text && !(include && ['paragraph', 'listitem'].includes(role) && nameOf(el, role))) {
          lines.push({ line: `text ${JSON.stringify(text)}`, depth: nextDepth });
        }
      }
      if (nextDepth > maxDepth) return;
      for (const child of el.children) visit(child, nextDepth);
      if (el.shadowRoot) for (const child of el.shadowRoot.children) visit(child, nextDepth);
    };
    visit(root, 0);
    return lines;
  }

  const LIMIT = 50_000;

  function render(lines) {
    let out = '';
    for (const { line, depth } of lines) {
      const next = `${'  '.repeat(depth)}${line}\n`;
      if (out.length + next.length > LIMIT) return `${out}… output truncated at ${LIMIT} characters. Use filter "interactive", a smaller depth or a ref.`;
      out += next;
    }
    return out.trimEnd();
  }

  function snapshot(opts = {}) {
    let root = document.body;
    if (opts.ref) {
      root = resolve(opts.ref);
      if (!root) return { error: `Error: ${opts.ref} is stale or not found on the current page. Re-read the page to get fresh references.` };
    }
    const lines = walk(root, {
      interactiveOnly: opts.filter === 'interactive',
      all: opts.filter === 'all',
      depth: opts.depth,
    });
    const modal = document.querySelector('dialog[open]:modal, [aria-modal="true"]');
    const blocked = modal && !opts.ref ? `A modal ${roleOf(modal) || 'dialog'} is open (${refFor(modal)}); the rest of the page cannot be clicked until it is closed.\n` : '';
    const header = `Page: ${document.title || '(untitled)'}\nURL: ${location.href}\nViewport: ${innerWidth}x${innerHeight}, scrolled to y=${Math.round(scrollY)} of ${document.documentElement.scrollHeight}\n${blocked}`;
    return { text: `${header}\n${render(lines) || '(no visible elements)'}` };
  }

  function find(query) {
    const needle = query.toLowerCase().trim();
    const words = needle.split(/\s+/).filter(Boolean);
    const lines = walk(document.body, { interactiveOnly: false, all: false })
      .filter(({ line }) => !line.startsWith('text '))
      .map(({ line }) => line)
      .filter((line) => {
        const hay = line.toLowerCase();
        return hay.includes(needle) || words.every((word) => hay.includes(word));
      });
    if (!lines.length) return `No elements match "${query}".`;
    const shown = lines.slice(0, 20);
    const more = lines.length > 20 ? `\n(${lines.length - 20} more matches not shown)` : '';
    return `${shown.join('\n')}${more}`;
  }

  function pageText() {
    const root = document.querySelector('main, [role="main"], article') || document.body;
    const text = (root.innerText || '').replace(/\n{3,}/g, '\n\n').trim();
    return text.length > LIMIT ? `${text.slice(0, LIMIT)}\n… truncated` : text;
  }

  function info(el) {
    if (!el) return null;
    const role = roleOf(el) || el.tagName.toLowerCase();
    const form = el.form || el.closest('form');
    const type = el.tagName === 'INPUT' ? (el.getAttribute('type') || 'text').toLowerCase() : el.tagName === 'BUTTON' ? (el.getAttribute('type') || 'submit').toLowerCase() : undefined;
    const submits = Boolean(form) && ((el.tagName === 'BUTTON' && type === 'submit') || (el.tagName === 'INPUT' && (type === 'submit' || type === 'image')));
    const link = el.closest('a[href]');
    return {
      tag: el.tagName.toLowerCase(),
      role,
      name: nameOf(el, role) || squash(el.innerText || '', 60),
      inputType: type,
      autocomplete: el.getAttribute('autocomplete') || undefined,
      href: link ? link.href : undefined,
      submits,
      formMethod: form ? (form.getAttribute('method') || 'get').toLowerCase() : undefined,
      inForm: Boolean(form),
    };
  }

  // The interactive element at a point, so coordinate clicks get the same checks as ref clicks.
  function elementAt(x, y) {
    const hit = document.elementFromPoint(x, y);
    return hit ? hit.closest('a[href], button, input, select, textarea, summary, label, [role], [tabindex]') || hit : null;
  }

  function focused() {
    const el = document.activeElement;
    return el && el !== document.body ? el : null;
  }

  window.__agent = {
    snapshot,
    find,
    pageText,
    resolve,
    describe: (ref) => info(resolve(ref)),
    describeAt: (x, y) => info(elementAt(x, y)),
    describeFocused: () => info(focused()),
  };
})();
