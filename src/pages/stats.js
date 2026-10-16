import { h, toast } from '../ui/dom.js';
import { SCENES } from '../../shared/scenes.js';

const REFRESH_MS = 30_000;
const SVG = 'http://www.w3.org/2000/svg';

const TOMBSTONES = [
  ['pumpkinsSaved', 'Pumpkins carved & kept'],
  ['gamePumpkins', 'Carved in a frenzy at parties'],
  ['visitors', 'Souls who wandered in'],
  ['roomsCreated', 'Parties thrown'],
  ['roundsPlayed', 'Rounds against the clock'],
  ['votesCast', 'Votes cast into the void'],
];

const CHARTS = {
  visitors: { label: 'Souls', noun: ['soul', 'souls'] },
  pumpkins: { label: 'Pumpkins', noun: ['pumpkin', 'pumpkins'] },
  rounds: { label: 'Rounds', noun: ['round', 'rounds'] },
};

/** `/stats`: spooky site numbers, refreshed while the page is open. */
export function statsPage(root) {
  document.title = 'After Dark · Pumpkin Patch';
  const live = h('p.live');
  const since = h('p.lede');
  const stones = TOMBSTONES.map(([key, label]) => {
    const value = h('div.stone-number', '–');
    return { key, value, el: h('div.tombstone', value, h('div.stone-label', label)) };
  });
  const chartTabs = Object.entries(CHARTS).map(([key, { label }]) =>
    h('button.chip', { 'data-chart': key, onclick: () => showChart(key) }, label));
  const chart = h('div.candle-chart');
  const chartNote = h('p.muted.chart-note');
  const haunts = h('ol.haunts');
  const candles = h('div.candle-colors');
  const lastCarved = h('p.muted');

  root.append(h('div.stats-page',
    h('div.moon', { 'aria-hidden': 'true' }),
    h('div.fog', h('div.fog-layer'), h('div.fog-layer.slow')),
    h('div.bats', { 'aria-hidden': 'true' }, ['🦇', '🦇', '🦇'].map((b) => h('span.bat', b))),
    h('div.page.stats-content',
      h('h1.spooky-title', 'The Patch After Dark'),
      since,
      live,
      h('section.graveyard', stones.map((s) => s.el)),
      h('section.stats-card',
        h('div.card-head', h('h2', 'The last 30 nights'), h('div.chips', chartTabs)),
        chart,
        chartNote,
      ),
      h('div.stats-split',
        h('section.stats-card', h('h2', 'Favorite haunts'), haunts),
        h('section.stats-card', h('h2', 'Most-lit candles'), candles, lastCarved),
      ),
      h('p.muted.privacy', 'Souls are counted without cookies: each visitor becomes an anonymous code that changes every day and is forgotten after two.'),
    ),
  ));

  let data = null;
  let chartKey = 'visitors';
  let firstLoad = true;

  async function load() {
    try {
      const res = await fetch('/api/stats');
      if (!res.ok) throw new Error('The spirits are not answering. Try again soon.');
      data = await res.json();
      render();
    } catch (err) {
      if (firstLoad) toast(err.message, { error: true });
    }
  }

  function render() {
    since.textContent = data.since
      ? `A ledger of every soul and pumpkin since ${formatDay(data.since, { month: 'long', day: 'numeric', year: 'numeric' })}.`
      : 'The ledger is empty. Be the first to carve.';
    live.replaceChildren(liveLine(data.live));
    for (const s of stones) countUp(s.value, data.totals[s.key] ?? 0, firstLoad);
    showChart(chartKey);
    renderHaunts();
    renderCandles();
    lastCarved.textContent = data.lastCarvedAt ? `Last pumpkin carved ${timeAgo(data.lastCarvedAt)}.` : '';
    firstLoad = false;
  }

  function showChart(key) {
    chartKey = key;
    for (const b of chartTabs) b.classList.toggle('active', b.dataset.chart === key);
    if (!data) return;
    const { noun } = CHARTS[key];
    const values = data.nights.map((n) => n[key]);
    const total = values.reduce((a, b) => a + b, 0);
    chart.replaceChildren(candleChart(data.nights, key, noun));
    chartNote.textContent = total
      ? `${total.toLocaleString()} ${total === 1 ? noun[0] : noun[1]} in 30 nights. Taller candles, busier nights.`
      : 'Not a single flicker yet.';
  }

  function renderHaunts() {
    const max = Math.max(1, ...data.scenes.map((s) => s.count));
    haunts.replaceChildren(...(data.scenes.length
      ? data.scenes.map(({ scene, count }) => {
        const info = SCENES[scene] ?? { label: scene, icon: '❔' };
        return h('li',
          h('span.haunt-name', `${info.icon} ${info.label}`),
          h('span.haunt-bar', h('span', { style: { width: `${(count / max) * 100}%` } })),
          h('span.haunt-count', count.toLocaleString()));
      })
      : [h('li.muted', 'No pumpkins have settled anywhere yet.')]));
  }

  function renderCandles() {
    candles.replaceChildren(...(data.candles.length
      ? data.candles.map(({ color, count }) =>
        h('div.candle-color', { title: color },
          h('span.flame-dot', { style: { '--flame': color } }),
          h('span', count.toLocaleString())))
      : [h('p.muted', 'No candles lit yet.')]));
  }

  load();
  const timer = setInterval(load, REFRESH_MS);
  return () => {
    clearInterval(timer);
    document.title = 'Pumpkin Patch';
  };
}

function liveLine(live) {
  if (!live || live.players === 0) return h('span', '🕯️ The patch is quiet… for now.');
  const spirits = `${live.players} ${live.players === 1 ? 'spirit is' : 'spirits are'}`;
  const parties = `${live.rooms} ${live.rooms === 1 ? 'party' : 'parties'}`;
  const carving = live.carving ? `, and ${live.carving} ${live.carving === 1 ? 'is' : 'are'} carving as we speak` : '';
  return h('span', h('span.live-dot'), `${spirits} haunting ${parties} right now${carving}.`);
}

/** One candle per night; height follows the value, and the flame flickers. */
function candleChart(nights, key, noun) {
  const W = 600, H = 190, base = 168, maxWax = 128;
  const max = Math.max(1, ...nights.map((n) => n[key]));
  const step = W / nights.length;
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${CHARTS[key].label} per night for the last 30 nights`);
  const el = (tag, attrs, parent = svg) => {
    const node = document.createElementNS(SVG, tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    parent.append(node);
    return node;
  };
  el('line', { x1: 0, x2: W, y1: base + 0.5, y2: base + 0.5, class: 'chart-ground' });
  nights.forEach((night, i) => {
    const value = night[key];
    const x = i * step + step / 2;
    const wax = value ? 6 + (value / max) * maxWax : 3;
    const g = el('g', { class: value ? 'candle lit' : 'candle', style: `--i:${i % 7}` });
    const title = el('title', {}, g);
    title.textContent = `${formatDay(night.day, { month: 'short', day: 'numeric' })}: ${value.toLocaleString()} ${value === 1 ? noun[0] : noun[1]}`;
    el('rect', { x: x - step * 0.22, y: base - wax, width: step * 0.44, height: wax, rx: 2, class: 'wax' }, g);
    if (value) {
      el('ellipse', { cx: x, cy: base - wax - 9, rx: 9, ry: 12, class: 'glow' }, g);
      el('path', { d: `M${x} ${base - wax - 16} q5 8 0 13 q-5 -5 0 -13z`, class: 'flame' }, g);
    }
    if (i % 7 === nights.length % 7 || i === nights.length - 1) {
      const label = el('text', { x, y: H - 4, class: 'chart-day' });
      label.textContent = i === nights.length - 1 ? 'Tonight' : formatDay(night.day, { month: 'short', day: 'numeric' });
    }
  });
  return svg;
}

function countUp(el, target, animate) {
  const from = Number(el.dataset.value ?? 0);
  el.dataset.value = target;
  if (!animate || matchMedia('(prefers-reduced-motion: reduce)').matches || target === from) {
    el.textContent = target.toLocaleString();
    return;
  }
  const start = performance.now();
  const ms = 1200;
  const tick = (now) => {
    const t = Math.min(1, (now - start) / ms);
    el.textContent = Math.round(from + (target - from) * (1 - (1 - t) ** 3)).toLocaleString();
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function formatDay(day, options) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { timeZone: 'UTC', ...options });
}

function timeAgo(when) {
  const seconds = (new Date(when).getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const [unit, size] of [['day', 86400], ['hour', 3600], ['minute', 60]]) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return 'moments ago';
}
