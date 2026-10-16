import './style.css';
import { h } from './ui/dom.js';
import { route, start } from './router.js';
import { editorPage } from './pages/editor.js';
import { viewerPage } from './pages/viewer.js';
import { minePage } from './pages/mine.js';
import { gamePage } from './pages/game.js';
import { statsPage } from './pages/stats.js';

route('/', editorPage);
route('/edit/:id', editorPage);
route('/p/:id', viewerPage);
route('/mine', minePage);
route('/game', gamePage);
route('/game/:code', gamePage);
route('/stats', statsPage);

const main = h('main');
document.getElementById('app').append(
  h('header.topbar',
    h('a.logo', { href: '/', 'data-link': true }, '🎃', h('span.logo-text', ' Pumpkin Patch')),
    h('nav',
      h('a', { href: '/', 'data-link': true }, 'Carve'),
      h('a', { href: '/mine', 'data-link': true }, 'My pumpkins'),
      h('a', { href: '/game', 'data-link': true }, 'Party game'),
      h('a', { href: '/stats', 'data-link': true, title: 'Stats', 'aria-label': 'Stats' }, '👻'),
    ),
  ),
  main,
);
start(main);
