/**
 * Tiny element builder: h('button.primary', { onclick }, 'Save').
 * Props starting with "on" become listeners; `html` sets innerHTML (trusted strings only).
 */
export function h(tag, props = {}, ...children) {
  if (typeof props !== 'object' || props === null || props instanceof Node || Array.isArray(props)) {
    children.unshift(props);
    props = {};
  }
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key === 'html') el.innerHTML = value;
    else if (key === 'class') el.className += ` ${value}`;
    else if (key === 'style' && typeof value === 'object') {
      for (const [prop, v] of Object.entries(value)) el.style.setProperty(prop, v);
    }
    else if (key in el && typeof value !== 'string') el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
}

let toastTimer;
export function toast(message, { error = false } = {}) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = h('div.toast', { role: 'status', 'aria-live': 'polite' });
    document.body.append(el);
  }
  el.textContent = message;
  el.classList.toggle('error', error);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast('Link copied!');
  } catch {
    window.prompt('Copy this link:', text);
  }
}
