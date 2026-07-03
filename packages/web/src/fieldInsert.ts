/**
 * Insert-into-focused-field support: clicking a variable in the sidebar should
 * drop `{{var.name}}` into the field you were just editing. The click itself
 * steals focus, so we remember the last text-like field inside the main pane
 * and insert at its cursor using the native value setter (so React sees it).
 */

let lastField: HTMLInputElement | HTMLTextAreaElement | null = null;

function isInsertable(el: Element): el is HTMLInputElement | HTMLTextAreaElement {
  if (el instanceof HTMLTextAreaElement) return true;
  if (!(el instanceof HTMLInputElement)) return false;
  // No passwords (vault values are literal, never templated) and no checkboxes etc.
  return ['text', 'search', 'url', 'tel', 'email'].includes(el.type);
}

export function initFieldTracking(): void {
  document.addEventListener('focusin', (e) => {
    const t = e.target;
    if (t instanceof Element && isInsertable(t) && t.closest('main.main')) {
      lastField = t;
    }
  });
}

/** Insert text at the cursor of the last-focused request field. False if there is none. */
export function insertIntoLastField(text: string): boolean {
  const el = lastField;
  if (!el || !document.contains(el)) return false;

  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  const next = el.value.slice(0, start) + text + el.value.slice(end);

  // Native setter + input event: the only way a programmatic write reaches
  // React's controlled-component state.
  const proto = el instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value')!.set!.call(el, next);
  el.dispatchEvent(new Event('input', { bubbles: true }));

  el.focus();
  el.setSelectionRange(start + text.length, start + text.length);
  return true;
}
