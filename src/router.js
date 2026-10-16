// Minimal history-API router. Each page is `(root, params) => cleanup`.

const routes = [];
let outlet;
let cleanup = null;

export function route(pattern, page) {
  const keys = [];
  const regex = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)'))}/?$`);
  routes.push({ regex, keys, page });
}

export function navigate(path, { replace = false } = {}) {
  history[replace ? 'replaceState' : 'pushState'](null, '', path);
  render();
}

export function start(el) {
  outlet = el;
  window.addEventListener('popstate', render);
  // Same-origin links marked data-link navigate without a reload.
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-link]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(a.getAttribute('href'));
  });
  render();
}

function render() {
  cleanup?.();
  cleanup = null;
  outlet.replaceChildren();
  const path = location.pathname;
  for (const { regex, keys, page } of routes) {
    const m = path.match(regex);
    if (!m) continue;
    const params = Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
    document.querySelectorAll('nav a[data-link]').forEach((a) => {
      const href = a.getAttribute('href');
      a.classList.toggle('active', href === '/' ? path === '/' || path.startsWith('/edit') : path.startsWith(href));
    });
    cleanup = page(outlet, params) ?? null;
    return;
  }
  outlet.append(Object.assign(document.createElement('p'), { className: 'empty', textContent: 'Nothing carved here.' }));
}
