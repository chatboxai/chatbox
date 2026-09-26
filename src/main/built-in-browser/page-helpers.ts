/**
 * Declares `browser`, the helper object available to scripts run by the browser tool's run command. It is
 * evaluated in the page's main world right before the script body, as a local of the wrapper, so
 * the page cannot read it and a script may shadow it. The built-in-browser skill documents this
 * API; keep the two in sync.
 *
 * Events dispatched here are synthetic (`isTrusted` is false) and trigger no default key actions.
 */
export const PAGE_HELPERS_SOURCE = `const browser = (() => {
  const INTERACTIVE = 'a[href], button, input:not([type="hidden"]), textarea, select, summary, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="switch"], [role="tab"], [role="menuitem"], [role="option"], [role="combobox"], [role="textbox"], [contenteditable=""], [contenteditable="true"], [onclick], [tabindex]:not([tabindex="-1"])';
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const resolve = (target) => {
    if (target instanceof Element) return target;
    if (typeof target !== 'string') throw new Error('Expected a CSS selector or an element.');
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
  const selectorFor = (element) => {
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
      ? labelledBy.split(/\\s+/).map((id) => document.getElementById(id)?.innerText ?? '').join(' ')
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
    selector: (target) => selectorFor(resolve(target)),
    elements: ({ limit = 80, within } = {}) => {
      const root = within ? resolve(within) : document;
      const visible = Array.from(root.querySelectorAll(INTERACTIVE)).filter(isVisible);
      const items = visible.slice(0, Math.max(1, limit)).map((element) => {
        const rect = element.getBoundingClientRect();
        const item = { selector: selectorFor(element), tag: element.localName, text: labelFor(element) };
        const role = element.getAttribute('role');
        if (role) item.role = role;
        if (element.type && element.localName === 'input') item.type = element.type;
        if (element.href) item.href = element.href;
        if ('value' in element && typeof element.value === 'string' && element.value && element.type !== 'password')
          item.value = element.value.slice(0, 80);
        if (element.checked) item.checked = true;
        if (element.disabled || element.getAttribute('aria-disabled') === 'true') item.disabled = true;
        if (rect.bottom < 0 || rect.top > innerHeight) item.offscreen = true;
        return item;
      });
      return { total: visible.length, items };
    },
    click: (target) => {
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
      const element = resolve(target);
      const value = String(text);
      element.scrollIntoView({ block: 'center' });
      if (typeof element.focus === 'function') element.focus({ preventScroll: true });
      if (element instanceof HTMLSelectElement) {
        const option = Array.from(element.options).find((item) => item.value === value || item.text.trim() === value);
        if (!option) throw new Error('No option ' + value + ' in ' + selectorFor(element));
        element.value = option.value;
      } else if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
      } else if (element.isContentEditable) {
        const selection = getSelection();
        const range = document.createRange();
        range.selectNodeContents(element);
        selection.removeAllRanges();
        selection.addRange(range);
        if (!document.execCommand('insertText', false, value)) {
          element.textContent = value;
          element.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: value }));
        }
        return element.innerText;
      } else {
        throw new Error(selectorFor(element) + ' is not a text field, select or editable element.');
      }
      element.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: value }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return element.value;
    },
    press: (key, target) => {
      const element = target ? resolve(target) : document.activeElement || document.body;
      const init = { key, bubbles: true, cancelable: true, composed: true };
      // As in a browser, a canceled keydown suppresses keypress, and either one cancels the default action.
      let proceed = element.dispatchEvent(new KeyboardEvent('keydown', init));
      if (proceed && (key.length === 1 || key === 'Enter')) proceed = element.dispatchEvent(new KeyboardEvent('keypress', init));
      element.dispatchEvent(new KeyboardEvent('keyup', init));
      if (proceed && key === 'Enter' && element instanceof HTMLInputElement && element.form) element.form.requestSubmit();
    },
    scroll: (amount, within) => {
      const area = within ? resolve(within) : scrollableArea();
      const isRoot = area === document.scrollingElement || area === document.documentElement;
      const viewport = isRoot ? innerHeight : area.clientHeight;
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
        if (typeof target === 'function') {
          const value = await target();
          if (value) return value;
        } else {
          const element = document.querySelector(target);
          if (element && isVisible(element)) return element;
        }
        if (Date.now() >= deadline) throw new Error('Timed out after ' + timeoutMs + 'ms waiting for ' + (typeof target === 'function' ? 'the condition' : target));
        await sleep(100);
      }
    },
  };
})();`
