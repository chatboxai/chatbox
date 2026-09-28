import { createHash } from 'node:crypto'

/**
 * The interactive snapshot of a page: its dialogs, landmarks, headings, lists, fields and controls
 * as an indented outline, each control carrying a short reference such as `e12`.
 *
 * References live in a registry on the page's window, keyed by a symbol, in the main world where
 * run scripts and their helpers execute. It hands an element the same reference in every snapshot
 * of the document and ends with it, so a reference names one element of one document. The page can
 * reach the registry; it only ever maps to the page's own elements.
 */

/** Expression for the page's reference registry, created on first use. */
export const PAGE_REFS_SOURCE = `(() => {
  const key = Symbol.for('chatbox.browser.refs');
  if (window[key]) return window[key];
  const refs = new WeakMap();
  const elements = new Map();
  let next = 0;
  const registry = {
    refFor(element) {
      let ref = refs.get(element);
      if (!ref) {
        ref = 'e' + ++next;
        refs.set(element, ref);
        elements.set(ref, new WeakRef(element));
      }
      return ref;
    },
    elementFor(ref) {
      const element = elements.get(ref)?.deref();
      // A frame that navigated or was removed keeps its old document connected, but without a window.
      return element && element.isConnected && element.ownerDocument.defaultView ? element : null;
    },
    /** Forgets references of collected elements, so a long-lived page does not accumulate them. */
    prune() {
      for (const [ref, element] of elements) if (!element.deref()) elements.delete(ref);
    },
  };
  Object.defineProperty(window, key, { value: registry, configurable: true });
  return registry;
})()`

/** A snapshot reference, as opposed to a CSS selector. */
export const SNAPSHOT_REF_PATTERN = /^e[1-9][0-9]*$/
/** {@link SNAPSHOT_REF_PATTERN} as a regular expression literal for page scripts. */
export const REF_PATTERN_SOURCE = String(SNAPSHOT_REF_PATTERN)

export interface PageSnapshotOptions {
  /** Reference of the element whose subtree to show. */
  scope?: string
  /** Case-insensitive text; only matching lines and the lines containing them are shown. */
  query?: string
}

export interface PageSnapshotOutcome {
  lines: string[]
  /** The snapshot shows only the open modal dialog, since the rest of the page is inert. */
  modal?: boolean
  /** The page has more elements than a snapshot lists. */
  truncated?: boolean
  error?: string
}

/** Most lines one snapshot returns before pagination. */
export const MAX_SNAPSHOT_LINES = 3000
/** Most elements one snapshot looks through, so a query can find what lies beyond the returned lines. */
export const MAX_SNAPSHOT_COLLECTED = 20_000

/** Expression that snapshots the page and resolves to a {@link PageSnapshotOutcome}. */
export function pageSnapshotSource(options: PageSnapshotOptions): string {
  return `((options) => {
  const refs = ${PAGE_REFS_SOURCE};
  refs.prune();
  const MAX_LINES = ${MAX_SNAPSHOT_LINES};
  const MAX_COLLECTED = ${MAX_SNAPSHOT_COLLECTED};
  const clip = (value, max) => {
    const text = String(value ?? '').replace(/\\s+/g, ' ').trim();
    return text.length > max ? text.slice(0, max - 1) + '…' : text;
  };
  const INPUT_ROLES = { button: 'button', submit: 'button', reset: 'button', image: 'button', checkbox: 'checkbox', radio: 'radio', range: 'slider', number: 'spinbutton', search: 'searchbox', file: 'button' };
  const TAG_ROLES = { button: 'button', summary: 'button', textarea: 'textbox', h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading', ul: 'list', ol: 'list', li: 'listitem', nav: 'navigation', main: 'main', aside: 'complementary', dialog: 'dialog', table: 'table', tr: 'row', td: 'cell', th: 'columnheader', fieldset: 'group', details: 'group', option: 'option', progress: 'progressbar', iframe: 'iframe' };
  const INTERACTIVE = new Set(['button', 'link', 'textbox', 'searchbox', 'checkbox', 'radio', 'switch', 'slider', 'spinbutton', 'combobox', 'listbox', 'option', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'treeitem']);
  /** Containers get references too, so a snapshot can be scoped to one of them. */
  const CONTAINERS = new Set(['dialog', 'alertdialog', 'form', 'region', 'navigation', 'main', 'banner', 'contentinfo', 'complementary', 'search', 'list', 'table', 'grid', 'tree', 'menu', 'tablist', 'tabpanel', 'group', 'iframe']);
  const NAME_FROM_CONTENT = new Set(['button', 'link', 'heading', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'treeitem', 'checkbox', 'radio', 'switch', 'cell', 'columnheader', 'rowheader']);
  const LEAF_CONTROLS = new Set(['button', 'link', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'checkbox', 'radio', 'switch']);
  /** Roles whose own text is shown after them, since it is what tells one row from another. */
  const TEXT_ROLES = new Set(['listitem', 'row', 'cell', 'columnheader', 'rowheader', 'dialog', 'alertdialog', 'alert', 'status', 'paragraph', 'blockquote']);
  const roleOf = (element) => {
    const explicit = (element.getAttribute('role') || '').trim().split(/\\s+/)[0];
    if (explicit === 'presentation' || explicit === 'none') return '';
    if (explicit) return explicit;
    const tag = element.localName;
    if (tag === 'a' || tag === 'area') return element.hasAttribute('href') ? 'link' : '';
    if (tag === 'input') return INPUT_ROLES[element.type] || (element.type === 'hidden' ? '' : 'textbox');
    if (tag === 'select') return element.multiple || element.size > 1 ? 'listbox' : 'combobox';
    if (tag === 'img') return element.getAttribute('alt') ? 'img' : '';
    if (tag === 'form') return element.getAttribute('aria-label') || element.getAttribute('aria-labelledby') ? 'form' : '';
    if (tag === 'section') return element.getAttribute('aria-label') || element.getAttribute('aria-labelledby') ? 'region' : '';
    if (tag === 'header') return element.closest('article, aside, main, nav, section') ? '' : 'banner';
    if (tag === 'footer') return element.closest('article, aside, main, nav, section') ? '' : 'contentinfo';
    if (tag === 'th' && element.getAttribute('scope') === 'row') return 'rowheader';
    if (element.isContentEditable && !element.parentElement?.isContentEditable) return 'textbox';
    return TAG_ROLES[tag] || '';
  };
  const textOf = (node) => (node.innerText ?? node.textContent ?? '');
  const nameOf = (element, role) => {
    const labelledBy = element.getAttribute('aria-labelledby');
    if (labelledBy) {
      const text = labelledBy.split(/\\s+/).map((id) => element.ownerDocument.getElementById(id)).filter(Boolean).map(textOf).join(' ');
      if (text.trim()) return text;
    }
    const label = element.getAttribute('aria-label');
    if (label && label.trim()) return label;
    if (element.labels && element.labels.length) return Array.from(element.labels).map(textOf).join(' ');
    if (element.localName === 'img' || (element.localName === 'input' && element.type === 'image')) return element.getAttribute('alt') || '';
    if (element.localName === 'input' && ['button', 'submit', 'reset'].includes(element.type)) return element.value || element.type;
    if (element.localName === 'input' && element.type === 'file') return 'Choose file';
    if (element.localName === 'iframe') return element.title || element.name || '';
    if (element.localName === 'fieldset') return element.querySelector('legend') ? textOf(element.querySelector('legend')) : '';
    if (element.localName === 'table') return element.caption ? textOf(element.caption) : '';
    if (NAME_FROM_CONTENT.has(role)) {
      const text = textOf(element);
      if (text.trim()) return text;
      // Icon controls are named by their image: an alt text, a label on the icon, or an SVG title.
      const icon = element.querySelector('img[alt]:not([alt=""]), [aria-label], svg title');
      const iconName = icon && (icon.getAttribute('alt') || icon.getAttribute('aria-label') || icon.textContent);
      if (iconName && iconName.trim()) return iconName;
    }
    return element.getAttribute('title') || element.getAttribute('placeholder') || '';
  };
  const isHidden = (element) => {
    if (element.hidden || element.getAttribute('aria-hidden') === 'true' || element.localName === 'template') return true;
    const style = getComputedStyle(element);
    // A display: contents wrapper has no box of its own, but its children are laid out.
    if (style.display === 'contents') return false;
    if (typeof element.checkVisibility === 'function') return !element.checkVisibility({ visibilityProperty: true });
    return style.display === 'none' || style.visibility === 'hidden';
  };
  const stateOf = (element, role) => {
    const parts = [];
    const aria = (name) => element.getAttribute('aria-' + name);
    if (role === 'heading') parts.push('level=' + (aria('level') || (/^h[1-6]$/.test(element.localName) ? element.localName.slice(1) : '2')));
    if (element.localName === 'input' && element.type === 'file') parts.push('file');
    if (['checkbox', 'radio', 'switch', 'menuitemcheckbox', 'menuitemradio'].includes(role) && (element.checked || aria('checked') === 'true')) parts.push('checked');
    if (aria('checked') === 'mixed') parts.push('mixed');
    if (aria('selected') === 'true' || (role === 'option' && element.selected)) parts.push('selected');
    if (aria('expanded')) parts.push(aria('expanded') === 'true' ? 'expanded' : 'collapsed');
    if (aria('pressed') === 'true') parts.push('pressed');
    if (aria('current') && aria('current') !== 'false') parts.push('current');
    if (element.disabled || aria('disabled') === 'true') parts.push('disabled');
    if (element.required || aria('required') === 'true') parts.push('required');
    // A native select shows its chosen options whether it renders as a combobox or a listbox.
    if (['textbox', 'searchbox', 'spinbutton', 'combobox', 'slider'].includes(role) || element.localName === 'select') {
      // A script combobox, such as a button that opens a list, shows its value as its text.
      const value = element.localName === 'select'
        ? Array.from(element.selectedOptions).map((option) => option.text).join(', ')
        : element.isContentEditable || !('value' in element) || element.localName === 'button' ? textOf(element) : element.type === 'password' ? '' : element.value;
      if (value) parts.push('value=' + JSON.stringify(clip(value, 80)));
    }
    if (role === 'link' && element.href) {
      let url = element.href;
      try {
        const parsed = new URL(element.href);
        url = parsed.origin === location.origin ? parsed.pathname + parsed.search : parsed.origin + parsed.pathname + parsed.search;
      } catch {}
      parts.push('url=' + clip(url, 120));
    }
    return parts;
  };

  let root = document.body || document.documentElement;
  let modal = false;
  if (options.scope) {
    root = refs.elementFor(options.scope);
    if (!root) return { lines: [], error: 'Reference ' + options.scope + ' is not on the page anymore. Take a new snapshot.' };
  } else {
    // Only a native modal dialog makes the rest of the page inert. Script dialogs marked aria-modal
    // may be banners that block nothing, or open menus portaled outside them; pages usually hide
    // what they cover with aria-hidden, which the walk skips anyway.
    const isNativeModal = (element) => {
      try {
        return element.matches(':modal');
      } catch {
        return false;
      }
    };
    const open = Array.from(document.querySelectorAll('dialog')).filter(
      (element) => !isHidden(element) && isNativeModal(element)
    );
    if (open.length) {
      // Several modal dialogs can be open; the one opened last is on top and receives the input,
      // which document order does not tell. The one whose center is hit is on top.
      const onTop = open.filter((element) => {
        const box = element.getBoundingClientRect();
        const hit = document.elementFromPoint?.(box.left + box.width / 2, box.top + box.height / 2);
        return !!hit && element.contains(hit);
      });
      const candidates = onTop.length ? onTop : open;
      root = candidates[candidates.length - 1];
      modal = true;
    }
  }

  // Emitted nodes form a tree; elements without a role pass their children to the nearest emitted ancestor.
  const nodes = [];
  let truncated = false;
  const childrenOf = (node) => {
    if (node.localName === 'slot') return node.assignedNodes({ flatten: true });
    if (node.shadowRoot) return Array.from(node.shadowRoot.childNodes);
    return Array.from(node.childNodes);
  };
  const walk = (node, parent) => {
    if (truncated) return;
    if (node.nodeType === 3) {
      if (parent >= 0 && nodes[parent].collectText) nodes[parent].text += ' ' + node.textContent;
      return;
    }
    if (node.nodeType !== 1 || ['script', 'style', 'noscript', 'head'].includes(node.localName)) return;
    // An SVG is a picture unless the page gives it a role, such as an icon button; its shapes are never listed.
    if (node.localName === 'svg' && !node.getAttribute('role')) return;
    if (node !== root && isHidden(node)) return;
    const role = roleOf(node);
    let next = parent;
    if (role) {
      if (nodes.length >= MAX_COLLECTED) {
        truncated = true;
        return;
      }
      const depth = parent >= 0 ? nodes[parent].depth + 1 : 0;
      const item = { role, name: clip(nameOf(node, role), 100), state: stateOf(node, role), depth, parent, text: '', collectText: TEXT_ROLES.has(role) };
      if (INTERACTIVE.has(role) || CONTAINERS.has(role) || (node.localName === 'input' && node.type === 'file')) item.element = node;
      nodes.push(item);
      next = nodes.length - 1;
      // A control is named by its content and a select shows its chosen value, so neither lists its
      // content again. Headings and tree items go on, since they can hold links and nested items.
      if (LEAF_CONTROLS.has(role) || node.localName === 'select' || node.localName === 'svg') return;
    }
    if (node.localName === 'iframe') {
      let frameDocument = null;
      try {
        frameDocument = node.contentDocument;
      } catch {}
      if (frameDocument?.body) walk(frameDocument.body, next);
      else if (next >= 0) nodes[next].state.push('cross-origin, not shown');
      return;
    }
    for (const child of childrenOf(node)) walk(child, next);
  };
  walk(root, -1);

  // References are handed out only for lines the snapshot shows.
  const describe = (item) => {
    let line = '  '.repeat(item.depth) + '- ' + item.role;
    if (item.name) line += ' ' + JSON.stringify(item.name);
    if (item.element) line += ' [' + refs.refFor(item.element) + ']';
    if (item.state.length) line += ' ' + item.state.join(' ');
    const text = clip(item.text, 160);
    if (text && text !== item.name) line += ': ' + text;
    return line;
  };
  let shown = nodes;
  if (options.query) {
    const query = String(options.query).toLowerCase();
    const keep = new Set();
    nodes.forEach((item, index) => {
      if (!(item.role + ' ' + item.name + ' ' + item.text + ' ' + item.state.join(' ')).toLowerCase().includes(query)) return;
      for (let at = index; at >= 0 && !keep.has(at); at = nodes[at].parent) keep.add(at);
    });
    shown = nodes.filter((_, index) => keep.has(index));
  }
  // The query filters everything collected, so a match late on a large page is still found.
  if (shown.length > MAX_LINES) {
    shown = shown.slice(0, MAX_LINES);
    truncated = true;
  }
  return { lines: shown.map(describe), ...(modal ? { modal } : {}), ...(truncated ? { truncated } : {}) };
})(${JSON.stringify(options)})`
}

export interface SnapshotPageOfLines {
  content: string
  /** A cursor was passed but belongs to another page, scope or query, so the lines start over. */
  restarted?: true
  /** Pass to the next snapshot of the same page to continue after the lines shown. */
  nextCursor?: string
  totalLines: number
}

/**
 * The part of a snapshot that fits `maxChars`, starting at `cursor`. A cursor names the page and the
 * `scope` and `query` it was issued for, so one from another page or another view starts over.
 */
export function pageOfLines(
  lines: string[],
  options: PageSnapshotOptions & { page: string; cursor?: string; maxChars: number }
): SnapshotPageOfLines {
  const view = `${options.page}~${createHash('sha256')
    .update(JSON.stringify([options.scope ?? '', options.query ?? '']))
    .digest('hex')
    .slice(0, 8)}`
  const at = (options.cursor ?? '').lastIndexOf('@')
  const cursorView = at >= 0 ? options.cursor?.slice(0, at) : undefined
  const cursorOffset = at >= 0 ? options.cursor?.slice(at + 1) : undefined
  const matches = cursorView === view
  const start = matches ? Math.min(Math.max(Number(cursorOffset) || 0, 0), lines.length) : 0
  let end = start
  let size = 0
  while (end < lines.length && (end === start || size + lines[end].length + 1 <= options.maxChars)) {
    size += lines[end].length + 1
    end += 1
  }
  return {
    content: lines.slice(start, end).join('\n'),
    ...(end < lines.length ? { nextCursor: `${view}@${end}` } : {}),
    ...(options.cursor && !matches ? { restarted: true as const } : {}),
    totalLines: lines.length,
  }
}
