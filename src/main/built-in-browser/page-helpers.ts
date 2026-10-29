import { PAGE_REFS_SOURCE, REF_PATTERN_SOURCE } from './page-snapshot'

/**
 * Declares `browser`, the helper object available to scripts run by the browser tool's run command. It is
 * evaluated in the page's main world right before the script body, as a local of the wrapper, so
 * the page cannot read it and a script may shadow it. The built-in-browser skill documents this
 * API; keep the two in sync.
 *
 * `operation` is an expression for the run's `{ cancelled }` record. Once the host stops waiting it
 * sets `cancelled`, and waiting helpers throw so the script stops at its next wait.
 *
 * Events dispatched here are synthetic (`isTrusted` is false) and trigger no default key actions.
 */
export function pageHelpersSource(operation: string): string {
  return `const browser = ((operation) => {
  const refs = ${PAGE_REFS_SOURCE};
  const isRef = (target) => typeof target === 'string' && ${REF_PATTERN_SOURCE}.test(target);
  const INTERACTIVE = 'a[href], button, input:not([type="hidden"]), textarea, select, summary, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="switch"], [role="tab"], [role="menuitem"], [role="option"], [role="combobox"], [role="textbox"], [contenteditable=""], [contenteditable="true"], [onclick], [tabindex]:not([tabindex="-1"])';
  const checkCancelled = () => {
    if (operation.cancelled) throw new Error('The run was stopped because the browser tool stopped waiting for it.');
  };
  const sleep = async (ms) => {
    checkCancelled();
    await new Promise((resolve) => setTimeout(resolve, ms));
    checkCancelled();
  };
  const resolve = (target) => {
    // Elements of a same-origin frame belong to that frame's realm, so they are not instances of this Element.
    if (target && target.nodeType === 1) return target;
    if (isRef(target)) {
      const element = refs.elementFor(target);
      if (!element) throw new Error('Reference ' + target + ' is not on the page anymore. Take a new snapshot.');
      return element;
    }
    if (typeof target !== 'string') throw new Error('Expected a snapshot reference, a CSS selector or an element.');
    const element = document.querySelector(target);
    if (!element) throw new Error('No element matches ' + target);
    return element;
  };
  const isVisible = (element) => {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    const style = getComputedStyle(element);
    return style.visibility !== 'hidden' && style.display !== 'none';
  };
  const isUnique = (selector) => {
    try {
      return document.querySelectorAll(selector).length === 1;
    } catch {
      return false;
    }
  };
  // A selector is resolved against this document, so elements of frames and shadow roots have none.
  const hasSelector = (element) => element.getRootNode() === document;
  // Names an element in an error message; elements of frames and shadow roots have no page selector.
  const nameForError = (element) => (hasSelector(element) ? selectorFor(element) : '<' + element.localName + '> ' + refs.refFor(element));
  const selectorFor = (element) => {
    if (!hasSelector(element)) throw new Error('This element is inside a frame or shadow root and has no page selector; use its snapshot reference.');
    if (element.id && isUnique('#' + CSS.escape(element.id))) return '#' + CSS.escape(element.id);
    for (const attribute of ['data-testid', 'data-test', 'data-qa', 'name', 'aria-label', 'placeholder']) {
      const value = element.getAttribute(attribute);
      if (!value) continue;
      const selector = element.localName + '[' + attribute + '="' + CSS.escape(value) + '"]';
      if (isUnique(selector)) return selector;
    }
    const parts = [];
    for (let node = element; node && node.nodeType === 1 && node !== document.documentElement; node = node.parentElement) {
      if (node !== element && node.id && isUnique('#' + CSS.escape(node.id))) {
        parts.unshift('#' + CSS.escape(node.id));
        break;
      }
      let part = node.localName;
      const parent = node.parentElement;
      if (parent) {
        const sameTag = Array.from(parent.children).filter((child) => child.localName === node.localName);
        if (sameTag.length > 1) part += ':nth-of-type(' + (sameTag.indexOf(node) + 1) + ')';
      }
      parts.unshift(part);
      if (isUnique(parts.join(' > '))) break;
    }
    return parts.join(' > ');
  };
  const labelFor = (element) => {
    const labelledBy = element.getAttribute('aria-labelledby');
    const labelled = labelledBy
      ? labelledBy.split(/\\s+/).map((id) => element.ownerDocument.getElementById(id)?.innerText ?? '').join(' ')
      : '';
    const text =
      element.getAttribute('aria-label') ||
      labelled ||
      (element.labels && element.labels[0] ? element.labels[0].innerText : '') ||
      (element.innerText ?? element.textContent) ||
      element.getAttribute('placeholder') ||
      element.getAttribute('title') ||
      element.getAttribute('alt') ||
      '';
    return text.replace(/\\s+/g, ' ').trim().slice(0, 80);
  };
  const pointAt = (element) => {
    element.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = element.getBoundingClientRect();
    return { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
  };
  const fire = (element, type, init) => {
    const options = { bubbles: true, cancelable: true, composed: true, ...init };
    const event = type.startsWith('pointer')
      ? new PointerEvent(type, { pointerId: 1, pointerType: 'mouse', isPrimary: true, ...options })
      : new MouseEvent(type, options);
    return element.dispatchEvent(event);
  };
  // The element with focus, followed into same-origin frames and open shadow roots.
  const focusedElement = () => {
    let element = document.activeElement || document.body;
    for (;;) {
      let inner = null;
      try {
        inner = element.localName === 'iframe' ? element.contentDocument?.activeElement : element.shadowRoot?.activeElement;
      } catch {}
      if (!inner || inner === element) return element;
      element = inner;
    }
  };
  const scrollableArea = () => {
    const root = document.scrollingElement || document.documentElement;
    if (root.scrollHeight > root.clientHeight + 1) return root;
    let best = root;
    let bestArea = 0;
    for (const element of document.querySelectorAll('body *')) {
      if (element.scrollHeight <= element.clientHeight + 1) continue;
      const overflow = getComputedStyle(element).overflowY;
      if (overflow !== 'auto' && overflow !== 'scroll') continue;
      const area = element.clientWidth * element.clientHeight;
      if (area > bestArea) {
        best = element;
        bestArea = area;
      }
    }
    return best;
  };

  return {
    sleep,
    cancelled: () => operation.cancelled === true,
    selector: (target) => selectorFor(resolve(target)),
    elements: ({ limit = 80, within } = {}) => {
      // A frame's reference searches the document it shows.
      const container = within ? resolve(within) : document;
      const root = container.localName === 'iframe' && container.contentDocument ? container.contentDocument : container;
      const visible = Array.from(root.querySelectorAll(INTERACTIVE)).filter(isVisible);
      const items = visible.slice(0, Math.max(1, limit)).map((element) => {
        const rect = element.getBoundingClientRect();
        const item = { ref: refs.refFor(element), ...(hasSelector(element) ? { selector: selectorFor(element) } : {}), tag: element.localName, text: labelFor(element) };
        const role = element.getAttribute('role');
        if (role) item.role = role;
        if (element.type && element.localName === 'input') item.type = element.type;
        if (element.href) item.href = element.href;
        if ('value' in element && typeof element.value === 'string' && element.value && element.type !== 'password')
          item.value = element.value.slice(0, 80);
        if (element.checked) item.checked = true;
        if (element.disabled || element.getAttribute('aria-disabled') === 'true') item.disabled = true;
        if (rect.bottom < 0 || rect.top > (element.ownerDocument.defaultView || window).innerHeight) item.offscreen = true;
        return item;
      });
      return { total: visible.length, items };
    },
    click: (target) => {
      checkCancelled();
      const element = resolve(target);
      const point = pointAt(element);
      fire(element, 'pointerover', point);
      fire(element, 'mouseover', point);
      fire(element, 'pointerdown', { ...point, button: 0, buttons: 1 });
      fire(element, 'mousedown', { ...point, button: 0, buttons: 1 });
      if (typeof element.focus === 'function') element.focus({ preventScroll: true });
      fire(element, 'pointerup', { ...point, button: 0 });
      fire(element, 'mouseup', { ...point, button: 0 });
      fire(element, 'click', { ...point, button: 0, detail: 1 });
      return labelFor(element);
    },
    fill: (target, text) => {
      checkCancelled();
      const element = resolve(target);
      const value = String(text);
      // A same-origin frame's elements come from that frame's realm and document.
      const frame = element.ownerDocument.defaultView || window;
      const frameDocument = element.ownerDocument;
      element.scrollIntoView({ block: 'center' });
      if (typeof element.focus === 'function') element.focus({ preventScroll: true });
      if (element instanceof frame.HTMLSelectElement) {
        const option = Array.from(element.options).find((item) => item.value === value || item.text.trim() === value);
        if (!option) throw new Error('No option ' + value + ' in ' + nameForError(element));
        element.value = option.value;
      } else if (element instanceof frame.HTMLInputElement || element instanceof frame.HTMLTextAreaElement) {
        const prototype = element instanceof frame.HTMLTextAreaElement ? frame.HTMLTextAreaElement.prototype : frame.HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
      } else if (element.isContentEditable) {
        const selection = frame.getSelection();
        const range = frameDocument.createRange();
        range.selectNodeContents(element);
        selection.removeAllRanges();
        selection.addRange(range);
        if (!frameDocument.execCommand('insertText', false, value)) {
          element.textContent = value;
          element.dispatchEvent(new frame.InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: value }));
        }
        return element.innerText;
      } else {
        throw new Error(nameForError(element) + ' is not a text field, select or editable element.');
      }
      element.dispatchEvent(new frame.InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: value }));
      element.dispatchEvent(new frame.Event('change', { bubbles: true }));
      return element.value;
    },
    press: (key, target) => {
      checkCancelled();
      const element = target ? resolve(target) : focusedElement();
      const init = { key, bubbles: true, cancelable: true, composed: true };
      const KeyEvent = (element.ownerDocument.defaultView || window).KeyboardEvent;
      // As in a browser, a canceled keydown suppresses keypress, and either one cancels the default action.
      let proceed = element.dispatchEvent(new KeyEvent('keydown', init));
      if (proceed && (key.length === 1 || key === 'Enter')) proceed = element.dispatchEvent(new KeyEvent('keypress', init));
      element.dispatchEvent(new KeyEvent('keyup', init));
      if (proceed && key === 'Enter' && element.localName === 'input' && element.form) element.form.requestSubmit();
    },
    scroll: (amount, within) => {
      checkCancelled();
      let area = within ? resolve(within) : scrollableArea();
      // A frame's reference scrolls the document it shows.
      if (area.localName === 'iframe' && area.contentDocument) area = area.contentDocument.scrollingElement || area.contentDocument.documentElement;
      const areaDocument = area.ownerDocument;
      const isRoot = area === areaDocument.scrollingElement || area === areaDocument.documentElement;
      const viewport = isRoot ? (areaDocument.defaultView || window).innerHeight : area.clientHeight;
      area.scrollBy({ top: amount ?? Math.round(viewport * 0.8), behavior: 'instant' });
      return {
        top: Math.round(area.scrollTop),
        height: area.scrollHeight,
        viewport,
        atEnd: area.scrollTop + viewport >= area.scrollHeight - 2,
      };
    },
    waitFor: async (target, timeoutMs = 3000) => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        checkCancelled();
        if (typeof target === 'function') {
          const value = await target();
          if (value) return value;
        } else {
          const element = isRef(target) ? resolve(target) : document.querySelector(target);
          if (element && isVisible(element)) return element;
        }
        if (Date.now() >= deadline) throw new Error('Timed out after ' + timeoutMs + 'ms waiting for ' + (typeof target === 'function' ? 'the condition' : target));
        await sleep(100);
      }
    },
  };
})(${operation});`
}
