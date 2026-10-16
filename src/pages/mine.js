import { h } from '../ui/dom.js';
import * as api from '../api.js';

/** Pumpkins saved from this browser (we keep their edit tokens locally). */
export function minePage(root) {
  const list = api.myPumpkins();
  const grid = h('div.gallery');
  for (const p of list) {
    const card = h('div.card',
      h('a', { href: `/p/${p.id}`, 'data-link': true },
        h('img', { src: api.thumbUrl(p), alt: p.title || 'Pumpkin', loading: 'lazy' }),
        h('div.card-title', p.title || 'Untitled'),
      ),
      h('div.row',
        h('a.button.small', { href: `/edit/${p.id}`, 'data-link': true }, 'Edit'),
        h('button.small.ghost', {
          title: 'Remove from this list (the share link keeps working)',
          onclick: () => {
            api.forgetPumpkin(p.id);
            card.remove();
          },
        }, 'Hide'),
      ),
    );
    // A pumpkin deleted server-side (or a different database in dev) just drops off.
    card.querySelector('img').addEventListener('error', () => card.classList.add('missing'));
    grid.append(card);
  }
  root.append(
    h('div.page',
      h('h1', 'My pumpkins'),
      list.length
        ? grid
        : h('p.empty', 'Nothing saved yet. ', h('a', { href: '/', 'data-link': true }, 'Go carve one!')),
      h('p.muted', 'Saved pumpkins are tied to this browser. Clearing site data means you can still view them by link but not edit them.'),
    ),
  );
}
