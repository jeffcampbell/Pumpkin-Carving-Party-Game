import { h } from './dom.js';
import { CarveMask } from '../pumpkin/mask.js';
import { PumpkinStage, DEFAULT_CANDLE, DEFAULT_SKIN } from '../pumpkin/stage.js';
import { Carver, TOOLS } from '../pumpkin/carver.js';
import { SHAPES, shapeIcon } from '../pumpkin/shapes.js';
import { SCENES, DEFAULT_SCENE } from '../../shared/scenes.js';

export const CANDLES = [
  ['Classic', DEFAULT_CANDLE],
  ['Ember', '#ff5a1f'],
  ['Ghostly', '#7dffb0'],
  ['Witchy', '#b06bff'],
  ['Icy', '#6bd5ff'],
  ['Blood moon', '#ff2a2a'],
];

export const SKINS = [
  ['Orange', DEFAULT_SKIN],
  ['Deep orange', '#d4541a'],
  ['Ghost white', '#efe6d2'],
  ['Green', '#6f9a3a'],
];

const TOOL_ICONS = { saw: '🪚', drill: '🔩', cutter: '⭐', etch: '✏️', patch: '🩹', rotate: '🔄' };

/**
 * The carving UI shared by the solo editor and the game: a 3D stage plus a tool
 * panel. `actions` are extra elements placed at the bottom of the panel.
 */
export function createWorkbench({ actions = [], onEdit } = {}) {
  const colors = { candle: DEFAULT_CANDLE, skin: DEFAULT_SKIN, scene: DEFAULT_SCENE };
  const mask = new CarveMask();
  const stageEl = h('div.stage');
  const hint = h('div.stage-hint');
  const undoBtn = h('button.icon-btn', { title: 'Undo (Ctrl+Z)', onclick: () => edit(() => mask.undo()) }, '↶');
  const redoBtn = h('button.icon-btn', { title: 'Redo (Ctrl+Shift+Z)', onclick: () => edit(() => mask.redo()) }, '↷');
  const viewBtn = h('button.icon-btn', { title: 'Face front', onclick: () => stage.resetView() }, '⌖');

  const toolButtons = Object.entries(TOOLS).map(([key, tool], i) =>
    h('button.tool', { 'data-tool': key, title: `${tool.label} (${i + 1})`, onclick: () => selectTool(key) },
      h('span.tool-icon', TOOL_ICONS[key]), h('span', tool.label)),
  );

  const sizeInput = h('input', { type: 'range', min: 0, max: 1, step: 0.01, oninput: () => setSizeFromSlider() });
  const sizeRow = h('label.field', h('span', 'Size'), sizeInput);

  const shapeButtons = Object.keys(SHAPES).map((name) =>
    h('button.shape', { 'data-shape': name, title: SHAPES[name].label, html: shapeIcon(name), onclick: () => selectShape(name) }),
  );
  const rotateInput = h('input', {
    type: 'range', min: -180, max: 180, step: 5, value: 0,
    oninput: () => (carver.rotation = (Number(rotateInput.value) * Math.PI) / 180),
  });
  const shapeSection = h('div.shape-options', h('div.shapes', shapeButtons), h('label.field', h('span', 'Tilt'), rotateInput));

  const candleSwatches = swatchRow(CANDLES, (hex) => setCandle(hex));
  const candleInput = h('input.color-input', { type: 'color', value: colors.candle, title: 'Any color', oninput: () => setCandle(candleInput.value) });
  const skinSwatches = swatchRow(SKINS, (hex) => setSkin(hex));
  const sceneButtons = Object.entries(SCENES).map(([id, { label, icon }]) =>
    h('button.scene', { 'data-scene': id, title: label, onclick: () => setScene(id) }, h('span.tool-icon', icon), h('span', label)),
  );

  const el = h('div.workbench',
    h('div.stage-wrap', stageEl, hint, h('div.stage-buttons', undoBtn, redoBtn, viewBtn)),
    h('aside.panel',
      h('section', h('h3', 'Tools'), h('div.tools', toolButtons)),
      h('section.tool-options', sizeRow, shapeSection),
      h('section', h('h3', 'Candle'), h('div.swatches', candleSwatches, candleInput)),
      h('section', h('h3', 'Pumpkin'), h('div.swatches', skinSwatches)),
      h('section', h('h3', 'Scene'), h('div.scenes', sceneButtons)),
      h('section.actions', actions),
    ),
  );

  const stage = new PumpkinStage(stageEl, mask);
  const carver = new Carver(stage, mask, { onEdit: () => changed() });

  function edit(fn) {
    fn();
    changed();
  }

  function changed() {
    undoBtn.disabled = !mask.canUndo;
    redoBtn.disabled = !mask.canRedo;
    onEdit?.();
  }

  function selectTool(key) {
    carver.tool = key;
    const tool = TOOLS[key];
    for (const b of toolButtons) b.classList.toggle('active', b.dataset.tool === key);
    hint.textContent = tool.hint;
    sizeRow.hidden = !tool.size;
    shapeSection.hidden = key !== 'cutter';
    if (tool.size) {
      const [min, max] = tool.size;
      sizeInput.value = Math.sqrt((carver.size - min) / (max - min)); // finer control at small sizes
    }
  }

  function setSizeFromSlider() {
    const [min, max] = TOOLS[carver.tool].size;
    carver.size = min + (max - min) * Number(sizeInput.value) ** 2;
  }

  function selectShape(name) {
    carver.shape = name;
    for (const b of shapeButtons) b.classList.toggle('active', b.dataset.shape === name);
  }

  function setCandle(hex) {
    colors.candle = hex;
    candleInput.value = hex;
    stage.setCandleColor(hex);
    markSwatch(candleSwatches, hex);
    onEdit?.();
  }

  function setSkin(hex) {
    colors.skin = hex;
    stage.setSkinColor(hex);
    markSwatch(skinSwatches, hex);
    onEdit?.();
  }

  function setScene(id) {
    colors.scene = id;
    stage.setScene(id);
    for (const b of sceneButtons) b.classList.toggle('active', b.dataset.scene === id);
    onEdit?.();
  }

  function onKey(e) {
    if (e.target.closest?.('input, textarea, select')) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      edit(() => (e.shiftKey ? mask.redo() : mask.undo()));
    } else if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      edit(() => mask.redo());
    } else if (!mod && /^[1-6]$/.test(e.key)) {
      selectTool(Object.keys(TOOLS)[Number(e.key) - 1]);
    } else if (!mod && (e.key === '[' || e.key === ']') && TOOLS[carver.tool].size) {
      sizeInput.value = Math.min(1, Math.max(0, Number(sizeInput.value) + (e.key === ']' ? 0.05 : -0.05)));
      setSizeFromSlider();
    }
  }
  window.addEventListener('keydown', onKey);

  selectTool('saw');
  selectShape('triangle');
  markSwatch(candleSwatches, colors.candle);
  markSwatch(skinSwatches, colors.skin);
  for (const b of sceneButtons) b.classList.toggle('active', b.dataset.scene === colors.scene);
  changed();

  return {
    el,
    stage,
    mask,
    carver,
    colors,
    /** Loads a saved carving (an Image) and its colours. */
    load({ image = null, candleColor = DEFAULT_CANDLE, skinColor = DEFAULT_SKIN, scene = colors.scene } = {}) {
      mask.reset(image);
      setCandle(candleColor);
      setSkin(skinColor);
      setScene(scene);
      changed();
    },
    clear() {
      edit(() => mask.clear());
    },
    setEnabled(enabled) {
      carver.enabled = enabled;
      el.classList.toggle('locked', !enabled);
    },
    /** Everything the server needs to store or show this pumpkin. */
    payload() {
      return { mask: mask.toDataURL(), thumb: stage.snapshot(), candleColor: colors.candle, skinColor: colors.skin, scene: colors.scene };
    },
    destroy() {
      window.removeEventListener('keydown', onKey);
      carver.dispose();
      stage.dispose();
      mask.texture.dispose();
    },
  };
}

function swatchRow(list, onPick) {
  return list.map(([name, hex]) =>
    h('button.swatch', { title: name, 'aria-label': name, 'data-hex': hex, style: { '--swatch': hex }, onclick: () => onPick(hex) }),
  );
}

function markSwatch(buttons, hex) {
  for (const b of buttons) b.classList.toggle('active', b.dataset.hex === hex.toLowerCase());
}
