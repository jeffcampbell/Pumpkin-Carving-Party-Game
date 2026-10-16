import { h, toast, copyText } from '../ui/dom.js';
import { createWorkbench } from '../ui/workbench.js';
import { CarveMask, loadImage } from '../pumpkin/mask.js';
import { PumpkinStage } from '../pumpkin/stage.js';
import { GameClient, savedSession } from '../game/client.js';
import * as api from '../api.js';
import { CATEGORIES, DEFAULT_CATEGORY, CUSTOM_LIMITS, parseCustomPrompts } from '../../shared/prompt-categories.js';

const NAME_KEY = 'pumpkin:name';
const DEFAULTS = { roundSeconds: 120, votesPerPlayer: 3, maxPlayers: 8, voteSeconds: 60 };

const storedName = () => {
  try {
    return localStorage.getItem(NAME_KEY) || '';
  } catch {
    return '';
  }
};
const rememberName = (name) => {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {}
};

/** `/game` (create or join) and `/game/:code` (join link or rejoin after refresh). */
export function gamePage(root, { code } = {}) {
  const client = new GameClient();
  const shell = h('div.game');
  root.append(shell);

  let view = null; // the current phase's view: { phase, update(state), destroy() }
  let state = null;
  let gallery = null;
  const local = { lastSubmission: null };

  client.addEventListener('state', ({ detail }) => {
    state = detail;
    if (state.code && location.pathname !== `/game/${state.code}`) {
      history.replaceState(null, '', `/game/${state.code}`);
    }
    const phaseView = state.phase === 'collecting' ? 'carving' : state.phase;
    if (view?.phase !== phaseView) {
      view?.destroy();
      shell.replaceChildren();
      view = VIEWS[phaseView]({ shell, client, local, getGallery: () => gallery });
      view.phase = phaseView;
    }
    view.update(state);
  });
  client.addEventListener('gallery', ({ detail }) => {
    gallery = detail;
    view?.update?.(state);
  });
  client.addEventListener('mask', ({ detail }) => view?.onMask?.(detail));
  client.addEventListener('error', ({ detail }) => toast(detail.message, { error: true }));
  client.addEventListener('status', ({ detail }) => {
    shell.classList.toggle('offline', detail === 'lost');
    if (detail === 'lost') toast('Connection lost — reconnecting…', { error: true });
  });

  if (code && savedSession(code)) {
    client.join(code, storedName()); // refreshed mid-game: pick up where we left off
  } else {
    shell.append(landing({ code, client }));
  }

  return () => {
    view?.destroy();
    client.close();
  };
}

// ---- landing: create or join ---------------------------------------------

function landing({ code, client }) {
  const nameInput = h('input', { type: 'text', maxLength: 20, placeholder: 'Your name', value: storedName(), required: true });
  const field = (label, input) => h('label.field', h('span', label), input);
  const select = (options, value) =>
    h('select', {}, options.map(([v, label]) => h('option', { value: v, selected: v === value }, label)));

  const roundSel = select([[60, '1 minute'], [90, '1½ minutes'], [120, '2 minutes'], [180, '3 minutes'], [300, '5 minutes']], DEFAULTS.roundSeconds);
  const votesInput = h('input', { type: 'number', min: 1, max: 10, value: DEFAULTS.votesPerPlayer });
  const playersSel = select([2, 3, 4, 5, 6, 7, 8].map((n) => [n, `${n} players`]), DEFAULTS.maxPlayers);
  const voteSel = select([[30, '30 seconds'], [60, '1 minute'], [90, '1½ minutes'], [120, '2 minutes']], DEFAULTS.voteSeconds);
  const prompts = categoryPicker();
  const codeInput = h('input.code-input', { type: 'text', maxLength: 4, placeholder: 'ABCD', value: code ?? '', autocapitalize: 'characters' });

  const name = () => {
    const n = nameInput.value.trim();
    if (!n) {
      nameInput.focus();
      toast('Pick a name first', { error: true });
      return null;
    }
    rememberName(n);
    return n;
  };

  const create = h('form.panel-card', {
    onsubmit: (e) => {
      e.preventDefault();
      const n = name();
      if (n) client.create(n, {
        roundSeconds: Number(roundSel.value),
        votesPerPlayer: Number(votesInput.value),
        maxPlayers: Number(playersSel.value),
        voteSeconds: Number(voteSel.value),
        ...prompts.value(),
      });
    },
  },
    h('h2', 'Host a party'),
    prompts.el,
    field('Carving time', roundSel),
    field('Votes per player', votesInput),
    field('Room size', playersSel),
    field('Voting time', voteSel),
    h('button.primary', { type: 'submit' }, 'Create room'),
  );

  const join = h('form.panel-card', {
    onsubmit: (e) => {
      e.preventDefault();
      const n = name();
      const c = codeInput.value.trim().toUpperCase();
      if (!n) return;
      if (c.length !== 4) return toast('Room codes are 4 letters', { error: true });
      client.join(c, n);
    },
  },
    h('h2', 'Join a room'),
    field('Room code', codeInput),
    h('button.primary', { type: 'submit' }, 'Join'),
  );

  return h('div.page.landing',
    h('h1', 'Pumpkin Party'),
    h('p.lede', 'Up to 8 carvers get the same prompt and a ticking clock. When time runs out, everyone votes for their favorites.'),
    field('Your name', nameInput),
    h('div.landing-grid', code ? [join, create] : [create, join]),
  );
}

// ---- shared bits ----------------------------------------------------------

function countdown() {
  const el = h('span.countdown');
  let endAt = null;
  const tick = () => {
    if (endAt === null) return (el.textContent = '');
    const s = Math.max(0, Math.ceil((endAt - performance.now()) / 1000));
    el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    el.classList.toggle('urgent', s <= 10);
  };
  const timer = setInterval(tick, 250);
  return {
    el,
    set(remainingMs) {
      endAt = remainingMs === null ? null : performance.now() + remainingMs;
      tick();
    },
    stop: () => clearInterval(timer),
  };
}

function playerChips(state, status) {
  return h('ul.player-chips', state.players.map((p) =>
    h('li', { class: [p.connected ? '' : 'away', status?.(p) ? 'done' : ''].join(' ') },
      p.id === state.hostId ? '👑 ' : '', p.name, p.id === state.you ? ' (you)' : ''),
  ));
}

// ---- phases ---------------------------------------------------------------

const VIEWS = {
  lobby({ shell, client }) {
    const players = h('div');
    const settings = h('div');
    const controls = h('div.lobby-controls');
    const link = () => `${location.origin}/game/${state.code}`;
    let state;
    let editor = null; // the host's settings form, kept across updates so typing isn't interrupted
    shell.append(h('div.page.lobby',
      h('div.room-code-box',
        h('span.muted', 'Room code'),
        h('div.room-code'),
        h('button', { onclick: () => copyText(link()) }, 'Copy invite link'),
      ),
      h('h2', 'Carvers'), players, settings, controls,
    ));

    return {
      update(s) {
        state = s;
        const isHost = s.hostId === s.you;
        shell.querySelector('.room-code').textContent = s.code;
        players.replaceChildren(playerChips(s), h('p.muted', `${s.players.length} of ${s.config.maxPlayers} spots filled`));
        if (isHost) {
          if (!editor) {
            editor = configEditor((config) => client.send({ type: 'config', config }));
            settings.replaceChildren(editor.el);
          }
          editor.set(s.config);
        } else {
          editor = null;
          settings.replaceChildren(configSummary(s.config));
        }
        const enough = s.players.filter((p) => p.connected).length >= 2;
        const needsPrompts = s.config.category === 'custom' && s.config.customCount === 0;
        controls.replaceChildren(isHost
          ? h('button.primary.big', { disabled: !enough || needsPrompts, onclick: () => client.send({ type: 'start' }) },
            !enough ? 'Waiting for another carver…' : needsPrompts ? 'Add some custom prompts first' : 'Start carving!')
          : h('p.muted', 'Waiting for the host to start…'));
      },
      destroy() {},
    };
  },

  carving({ shell, client, local }) {
    const clock = countdown();
    const prompt = h('div.prompt');
    const status = h('div.round-status');
    let editedSinceSubmit = true;
    let submittedRound = null;
    let round = null;

    const submitBtn = h('button.primary', { onclick: () => submit() }, "I'm done");
    const note = h('p.muted.small');
    const bench = createWorkbench({
      actions: [submitBtn, note],
      onEdit: () => {
        editedSinceSubmit = true;
        if (submittedRound) submitBtn.textContent = 'Resubmit';
      },
    });
    const overlay = h('div.times-up', { hidden: true }, h('div', "Time's up!"));
    shell.append(h('div.round-bar', h('div', h('span.muted', 'Carve: '), prompt), clock.el), status, h('div.bench-wrap', bench.el, overlay));

    function submit() {
      local.lastSubmission = bench.payload();
      client.send({ type: 'submit', pumpkin: local.lastSubmission });
      editedSinceSubmit = false;
      submittedRound = round;
      submitBtn.textContent = 'Submitted ✓';
      note.textContent = 'You can keep carving and resubmit until time runs out.';
    }

    return {
      update(s) {
        if (round !== s.round) {
          // Every round starts from a fresh pumpkin.
          round = s.round;
          local.lastSubmission = null;
          bench.load();
          submittedRound = null;
          editedSinceSubmit = true;
        }
        prompt.textContent = s.prompt;
        clock.set(s.remainingMs);
        status.replaceChildren(playerChips(s, (p) => p.submitted));
        if (s.phase === 'collecting') {
          overlay.hidden = false;
          bench.setEnabled(false);
          submitBtn.disabled = true;
          if (editedSinceSubmit || submittedRound !== s.round) submit();
        }
      },
      destroy() {
        clock.stop();
        bench.destroy();
      },
    };
  },

  voting({ shell, client, getGallery }) {
    const clock = countdown();
    const grid = h('div.gallery.voting');
    const remaining = h('span.votes-left');
    const doneBtn = h('button.primary', { onclick: () => client.send({ type: 'doneVoting' }) }, 'Lock in my votes');
    const status = h('div.round-status');
    const prompt = h('div.prompt');
    const inspector = createInspector(client);
    shell.append(
      h('div.round-bar', h('div', h('span.muted', 'Vote: '), prompt), clock.el),
      status,
      h('div.page.voting-page', h('div.vote-bar', remaining, doneBtn), grid),
      inspector.el,
    );
    let votes = [];
    let renderedRound = null;
    const cards = new Map();

    function render(s) {
      const g = getGallery();
      if (!g || g.round === renderedRound) return;
      renderedRound = g.round;
      grid.replaceChildren();
      cards.clear();
      g.entries.forEach((entry, i) => {
        const count = h('span.vote-count');
        const minus = h('button.icon-btn', { 'aria-label': 'Remove a vote', onclick: () => changeVote(entry.entryId, -1) }, '−');
        const plus = h('button.icon-btn', { 'aria-label': 'Add a vote', onclick: () => changeVote(entry.entryId, 1) }, '+');
        const card = h('div.card', { class: entry.mine ? 'mine' : '' },
          h('button.thumb-btn', { title: 'Look closer', onclick: () => inspector.open(entry.entryId) },
            h('img', { src: entry.thumb, alt: `Pumpkin ${i + 1}` })),
          entry.mine ? h('div.card-title', 'Yours') : h('div.vote-controls', minus, count, plus),
        );
        cards.set(entry.entryId, { count, minus, plus });
        grid.append(card);
      });
      if (!g.entries.length) grid.append(h('p.empty', 'Nobody turned anything in!'));
    }

    function changeVote(entryId, delta) {
      const next = [...votes];
      if (delta > 0) next.push(entryId);
      else next.splice(next.lastIndexOf(entryId), 1);
      votes = next;
      paint();
      client.send({ type: 'vote', entryIds: votes });
    }

    let current;
    function paint() {
      const s = current;
      const me = s.players.find((p) => p.id === s.you);
      const locked = !!me?.doneVoting;
      const left = s.config.votesPerPlayer - votes.length;
      remaining.textContent = locked ? 'Votes locked in. Waiting for everyone else…' : `${left} vote${left === 1 ? '' : 's'} left`;
      doneBtn.disabled = locked;
      for (const [entryId, c] of cards) {
        const n = votes.filter((v) => v === entryId).length;
        c.count.textContent = n ? '🎃'.repeat(n) : '0';
        c.minus.disabled = locked || n === 0;
        c.plus.disabled = locked || left <= 0;
      }
    }

    return {
      update(s) {
        current = s;
        votes = [...s.myVotes];
        prompt.textContent = s.prompt;
        clock.set(s.remainingMs);
        status.replaceChildren(playerChips(s, (p) => p.doneVoting));
        render(s);
        paint();
      },
      onMask: (m) => inspector.show(m),
      destroy() {
        clock.stop();
        inspector.destroy();
      },
    };
  },

  results({ shell, client, local, getGallery }) {
    const list = h('ol.results');
    const controls = h('div.lobby-controls');
    const saveBtn = h('button', { onclick: () => saveMine() }, 'Save my pumpkin & get a link');
    const inspector = createInspector(client);
    const prompt = h('div.prompt');
    shell.append(h('div.page.results-page', h('h1', 'Results'), prompt, list, h('div.row.center', saveBtn), controls), inspector.el);

    async function saveMine() {
      if (!local.lastSubmission) return;
      saveBtn.disabled = true;
      try {
        const meta = await api.savePumpkin({ ...local.lastSubmission, title: prompt.textContent });
        saveBtn.textContent = 'Saved! Copy link';
        saveBtn.onclick = () => copyText(api.shareUrl(meta.id));
        copyText(api.shareUrl(meta.id));
      } catch (err) {
        toast(err.message, { error: true });
      } finally {
        saveBtn.disabled = false;
      }
    }

    return {
      update(s) {
        prompt.textContent = s.prompt;
        const thumbs = new Map((getGallery()?.entries ?? []).map((e) => [e.entryId, e.thumb]));
        list.replaceChildren(...(s.results ?? []).map((r) =>
          h('li', { class: `rank-${r.rank}` },
            h('span.rank', r.rank === 1 ? '🏆' : `#${r.rank}`),
            h('button.thumb-btn', { onclick: () => inspector.open(r.entryId) }, h('img', { src: thumbs.get(r.entryId) ?? '', alt: '' })),
            h('span.result-name', r.name, r.playerId === s.you ? ' (you)' : ''),
            h('span.result-votes', `${r.votes} vote${r.votes === 1 ? '' : 's'}`),
          )));
        if (!s.results?.length) list.append(h('p.empty', 'No pumpkins this round.'));
        saveBtn.hidden = !local.lastSubmission;
        const isHost = s.hostId === s.you;
        controls.replaceChildren(...(isHost
          ? [h('button.primary', { onclick: () => client.send({ type: 'start' }) }, 'Next round'),
             h('button.ghost', { onclick: () => client.send({ type: 'lobby' }) }, 'Back to lobby')]
          : [h('p.muted', 'Waiting for the host…')]));
      },
      onMask: (m) => inspector.show(m),
      destroy() {
        inspector.destroy();
      },
    };
  },
};

function categoryLabel(config) {
  const { label, icon } = CATEGORIES[config.category] ?? CATEGORIES[DEFAULT_CATEGORY];
  return config.category === 'custom' ? `${icon} ${label} (${config.customCount})` : `${icon} ${label}`;
}

function configSummary(c) {
  return h('p.muted', `Prompts: ${categoryLabel(c)} · ${c.roundSeconds / 60} min to carve · ${c.votesPerPlayer} votes each · ${c.voteSeconds}s to vote`);
}

/** The host's lobby settings. `set` refreshes values from the server without clobbering a field being edited. */
function configEditor(onChange) {
  const prompts = categoryPicker({ onChange });
  const inputs = {};
  const num = (key, label, min, max, step = 1) =>
    h('label.field.inline', h('span', label), (inputs[key] = h('input', {
      type: 'number', min, max, step,
      onchange: (e) => onChange({ [key]: Number(e.target.value) }),
    })));
  const el = h('div.config-wrap', prompts.el, h('div.config-edit',
    num('roundSeconds', 'Carving seconds', 30, 600, 15), num('votesPerPlayer', 'Votes each', 1, 10),
    num('voteSeconds', 'Voting seconds', 15, 300, 15), num('maxPlayers', 'Max players', 2, 8)));
  return {
    el,
    set(config) {
      prompts.set(config);
      for (const [key, input] of Object.entries(inputs)) if (document.activeElement !== input) input.value = config[key];
    },
  };
}

/**
 * Category buttons plus, for "Custom", a textarea with one prompt per line.
 * `onChange` (optional) gets `{ category, customPrompts }` as the host edits.
 */
function categoryPicker({ onChange } = {}) {
  let category = DEFAULT_CATEGORY;
  let typingTimer;
  const count = h('span.muted.custom-count');
  const textarea = h('textarea.custom-prompts', {
    rows: 6,
    placeholder: 'One prompt per line, for example:\nA lazy cat\nA happy dog',
    oninput: () => {
      render();
      clearTimeout(typingTimer);
      typingTimer = setTimeout(emit, 500);
    },
    onblur: () => {
      if (typingTimer === undefined) return;
      clearTimeout(typingTimer);
      emit();
    },
  });
  const buttons = Object.entries(CATEGORIES).map(([id, { label, icon }]) =>
    h('button.category', { type: 'button', 'data-category': id, onclick: () => pick(id) }, h('span.tool-icon', icon), h('span', label)));
  const customBox = h('div.custom-box', textarea, count);
  const el = h('div.field.category-field', h('span', 'Prompts'), h('div.categories', buttons), customBox);

  const value = () => ({ category, customPrompts: parseCustomPrompts(textarea.value) });

  function emit() {
    typingTimer = undefined;
    onChange?.(value());
  }

  function render() {
    for (const b of buttons) b.classList.toggle('active', b.dataset.category === category);
    customBox.hidden = category !== 'custom';
    const n = parseCustomPrompts(textarea.value).length;
    count.textContent = n === CUSTOM_LIMITS.count ? `${n} prompts (that's the max)` : `${n} prompt${n === 1 ? '' : 's'}`;
  }

  function pick(id) {
    category = id;
    render();
    if (id === 'custom') textarea.focus();
    onChange?.(value());
  }

  render();
  return {
    el,
    value,
    set(config) {
      category = config.category;
      if (document.activeElement !== textarea && typingTimer === undefined) textarea.value = config.customPrompts.join('\n');
      render();
    },
  };
}

/** A modal with one shared 3D stage for looking at any submitted pumpkin up close. */
function createInspector(client) {
  const masks = new Map();
  const stageEl = h('div.stage');
  const el = h('div.modal', { hidden: true, onclick: (e) => e.target === el && close() },
    h('div.modal-body', h('button.icon-btn.modal-close', { 'aria-label': 'Close', onclick: () => close() }, '✕'), h('div.stage-wrap', stageEl)));
  let stage = null;
  let mask = null;
  let wanted = null;

  function close() {
    el.hidden = true;
    wanted = null;
  }

  async function show(m) {
    masks.set(m.entryId, m);
    if (wanted !== m.entryId) return;
    if (!stage) {
      mask = new CarveMask();
      stage = new PumpkinStage(stageEl, mask, { autoRotate: true });
    }
    mask.reset(await loadImage(m.mask));
    stage.setCandleColor(m.candleColor);
    stage.setSkinColor(m.skinColor);
    stage.setScene(m.scene);
    stage.resetView();
  }

  return {
    el,
    open(entryId) {
      wanted = entryId;
      el.hidden = false;
      if (masks.has(entryId)) show(masks.get(entryId));
      else client.send({ type: 'getMask', entryId });
    },
    show,
    destroy() {
      stage?.dispose();
      mask?.texture.dispose();
    },
  };
}
