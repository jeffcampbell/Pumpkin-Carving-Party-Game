import * as THREE from 'three';
import { Y_SCALE, surfacePoint } from './geometry.js';
import { shapePath } from './shapes.js';
import { findIslands } from './islands.js';

// The carving lives in a grayscale texture wrapped around the pumpkin:
//   0              untouched skin
//   96 / 115 / 134 etched: each new etching pass shaves one step deeper, so it glows brighter;
//                  one more pass after the deepest breaks through to a hole
//   158 and up     cut all the way through
// Every edit is recorded as an op so undo/redo can rebuild the canvas by replay.

export const MASK_W = 2048;
export const MASK_H = 1024;
export const LEVEL = { skin: 0, etch: 96, cut: 255 };
export const ETCH_STEP = 19;
export const ETCH_MAX = 134; // deepest etch that still holds; the next pass breaks through

/** Mask value after one more etching pass over a pixel that was `before`. */
export function etchTarget(before) {
  if (before >= CUT_THRESHOLD) return before; // already a hole
  // Soft brush edges leave in-between values; count them as the nearest level so
  // a pixel only breaks through once it has really been shaved to the deepest step.
  const next = Math.round((before - LEVEL.etch) / ETCH_STEP) + 1;
  if (next <= 0) return LEVEL.etch; // first pass through the skin
  const target = LEVEL.etch + next * ETCH_STEP;
  return target > ETCH_MAX ? LEVEL.cut : target; // shaved too thin: break through
}
export const CUT_THRESHOLD = 158;

const TAU = Math.PI * 2;
const MAX_FALLING_PIECES = 6;
const MIN_FALLING_AREA = 250; // smaller loose bits just vanish (in area-weighted pixels)

// Pixels per world unit, so a brush of radius r looks round on the pumpkin
// rather than stretched near the top and bottom.
const pxPerUnitY = MASK_H / (Math.PI * Y_SCALE);
const pxPerUnitX = (v) => MASK_W / (TAU * Math.max(Math.sin(Math.PI * v), 0.06));

function makeCanvas() {
  const canvas = document.createElement('canvas');
  canvas.width = MASK_W;
  canvas.height = MASK_H;
  // We read pixels back often (etching, loose-piece detection), so keep it CPU-side.
  return { canvas, ctx: canvas.getContext('2d', { willReadFrequently: true }) };
}

export class CarveMask {
  constructor() {
    ({ canvas: this.canvas, ctx: this.ctx } = makeCanvas());
    this.texture = maskTexture(this.canvas);
    // An etch stroke is drawn here first, then applied, so overlapping dabs within
    // one stroke don't keep deepening it; only a fresh pass goes deeper.
    this.cover = makeCanvas().ctx;
    this.etchBase = null;
    this.base = null; // image the ops are applied on top of (a loaded pumpkin)
    this.ops = [];
    this.redoStack = [];
    this.active = null;
    this.stemAttached = true;
    // Hooks for the stage: pieces falling off, and undo flying them back home.
    this.onPieces = null; // (pieces) => void
    this.onRewind = null; // (pieces, done) => void; must call done() when they've landed
    this.onRewindEnd = null; // () => void; a rewind was finished early
    this.rewinding = false;
    this.redraw();
  }

  /** Starts over, optionally from a previously saved mask image. */
  reset(baseImage = null) {
    this.finishRewind();
    this.base = baseImage;
    this.ops = [];
    this.redoStack = [];
    this.active = null;
    this.redraw();
  }

  get canUndo() {
    return this.ops.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }

  get isBlank() {
    return !this.base && this.ops.every((op) => op.t === 'clear');
  }

  // ---- editing ------------------------------------------------------------

  beginStroke(level, radius, u, v) {
    const op = { t: 'stroke', level, r: radius, pts: [[u, v]] };
    this.push(op);
    this.active = op;
    if (level === LEVEL.etch) {
      const { data } = this.ctx.getImageData(0, 0, MASK_W, MASK_H);
      this.etchBase = { data, x: 0, y: 0, w: MASK_W };
      clearCanvas(this.cover);
    }
    this.strokeDab(op, u, v);
    this.touch();
  }

  extendStroke(u, v) {
    const op = this.active;
    if (!op) return;
    const [pu, pv] = op.pts[op.pts.length - 1];
    op.pts.push([u, v]);
    if (op.level === LEVEL.etch) this.applyEtch(this.segment(this.cover, LEVEL.cut, op.r, pu, pv, u, v));
    else this.segment(this.ctx, op.level, op.r, pu, pv, u, v);
    this.touch();
  }

  endStroke() {
    const op = this.active;
    this.active = null;
    this.etchBase = null;
    // Etching only changes what's attached if it broke through somewhere.
    if (op && (op.level !== LEVEL.etch || op.brokeThrough)) this.settle(op);
  }

  stamp(shape, radius, rotation, u, v) {
    const op = { t: 'stamp', shape, r: radius, rot: rotation, u, v };
    this.push(op);
    this.drawStamp(op);
    this.settle(op);
    this.touch();
  }

  clear() {
    if (this.isBlank) return;
    this.push({ t: 'clear' });
    this.redraw();
  }

  undo() {
    this.finishRewind();
    const op = this.ops.at(-1);
    if (!op) return;
    if (op.drop && this.onRewind) return this.rewind(op);
    this.redoStack.push(this.ops.pop());
    this.redraw();
  }

  redo() {
    this.finishRewind();
    if (!this.redoStack.length) return;
    const op = this.redoStack.pop();
    this.ops.push(op);
    this.redraw({ animateDropOf: op }); // pieces fall again, along the same path
  }

  /**
   * Undoing a cut that dropped pieces: the pieces fly back along their fall path
   * while the hole stays open, and only once they've landed does the cut close.
   */
  rewind(op) {
    // Rebuild the moment just before the pieces fell, to find out what they were.
    this.redraw({ holdDropOf: op });
    const image = this.ctx.getImageData(0, 0, MASK_W, MASK_H);
    const found = findIslands(image.data, MASK_W, MASK_H, CUT_THRESHOLD);
    const pieces = this.extractPieces(image.data, found, op);
    // Show the hole again while they're in flight.
    removeLoose(image.data, found);
    this.ctx.putImageData(image, 0, 0);
    this.touch();

    this.redoStack.push(this.ops.pop());
    this.rewinding = true;
    const id = (this.rewindId = (this.rewindId ?? 0) + 1);
    this.onRewind(pieces, () => id === this.rewindId && this.finishRewind({ landed: true }));
  }

  /** Completes an in-flight rewind; called when the pieces land, or early if anything else happens. */
  finishRewind({ landed = false } = {}) {
    if (!this.rewinding) return;
    this.rewinding = false;
    if (!landed) this.onRewindEnd?.();
    this.redraw();
  }

  push(op) {
    this.finishRewind();
    this.ops.push(op);
    this.redoStack = [];
  }

  // ---- drawing ------------------------------------------------------------

  /**
   * Rebuilds the mask by replaying every op. Pieces that fell before stay gone
   * silently, except `animateDropOf` (redo shows its fall again) and
   * `holdDropOf` (left attached, so undo can see what fell).
   */
  redraw({ animateDropOf = null, holdDropOf = null } = {}) {
    clearCanvas(this.ctx);
    if (this.base) this.ctx.drawImage(this.base, 0, 0, MASK_W, MASK_H);
    for (const op of this.ops) {
      if (op.t === 'clear') clearCanvas(this.ctx);
      else if (op.t === 'stamp') this.drawStamp(op);
      else if (op.level === LEVEL.etch) this.replayEtch(op);
      else this.drawStroke(this.ctx, op.level, op);
      if (op.drop && op !== holdDropOf) this.settle(op, { animate: op === animateDropOf });
    }
    this.touch();
  }

  strokeDab(op, u, v) {
    if (op.level === LEVEL.etch) this.applyEtch(this.dab(this.cover, LEVEL.cut, op.r, u, v));
    else this.dab(this.ctx, op.level, op.r, u, v);
  }

  drawStroke(ctx, level, op) {
    const [first, ...rest] = op.pts;
    let box = this.dab(ctx, level, op.r, first[0], first[1]);
    let prev = first;
    for (const p of rest) {
      box = union(box, this.segment(ctx, level, op.r, prev[0], prev[1], p[0], p[1]));
      prev = p;
    }
    return box;
  }

  replayEtch(op) {
    clearCanvas(this.cover);
    const box = clampBox(this.drawStroke(this.cover, LEVEL.cut, op));
    if (!box) return;
    // The mask hasn't been touched by this stroke yet, so it is its own "before" image.
    const { data } = this.ctx.getImageData(box.x, box.y, box.w, box.h);
    this.etchBase = { data, x: box.x, y: box.y, w: box.w };
    this.applyEtch(box);
    this.etchBase = null;
  }

  /** Deepens every pixel the current etch stroke covers by one step relative to before the stroke. */
  applyEtch(rawBox) {
    const box = clampBox(rawBox);
    if (!box || !this.etchBase) return;
    const cover = this.cover.getImageData(box.x, box.y, box.w, box.h).data;
    const out = this.ctx.createImageData(box.w, box.h);
    const base = this.etchBase;
    for (let y = 0; y < box.h; y++) {
      for (let x = 0; x < box.w; x++) {
        const k = (y * box.w + x) * 4;
        const before = base.data[((box.y + y - base.y) * base.w + (box.x + x - base.x)) * 4];
        const c = cover[k] / 255; // brush coverage, soft at the anti-aliased edge
        let value = before;
        if (c > 0 && before < CUT_THRESHOLD) {
          const target = etchTarget(before);
          value = before + (target - before) * c;
          if (value >= CUT_THRESHOLD && this.active) this.active.brokeThrough = true;
        }
        out.data[k] = out.data[k + 1] = out.data[k + 2] = value;
        out.data[k + 3] = 255;
      }
    }
    this.ctx.putImageData(out, box.x, box.y);
  }

  setPaint(ctx, level) {
    // "lighten" keeps the deeper of two cuts, so nothing fills in a hole;
    // patching (level 0) has to paint over everything.
    ctx.globalCompositeOperation = level === LEVEL.skin ? 'source-over' : 'lighten';
    ctx.fillStyle = `rgb(${level},${level},${level})`;
  }

  /** Draws one brush dab and returns the pixel box it touched. */
  dab(ctx, level, radius, u, v) {
    this.setPaint(ctx, level);
    const cx = u * MASK_W;
    const cy = (1 - v) * MASK_H;
    const rx = Math.min(radius * pxPerUnitX(v), MASK_W / 2);
    const ry = radius * pxPerUnitY;
    const offsets = wrapOffsets(cx, rx);
    for (const offset of offsets) {
      ctx.beginPath();
      ctx.ellipse(cx + offset, cy, rx, ry, 0, 0, TAU);
      ctx.fill();
    }
    const wraps = offsets.length > 1;
    return { x0: wraps ? 0 : cx - rx - 2, x1: wraps ? MASK_W : cx + rx + 2, y0: cy - ry - 2, y1: cy + ry + 2 };
  }

  segment(ctx, level, radius, u0, v0, u1, v1) {
    // Take the short way around the seam at u = 0/1.
    let du = u1 - u0;
    if (du > 0.5) du -= 1;
    if (du < -0.5) du += 1;
    const dv = v1 - v0;
    const s = Math.sin(Math.PI * (v0 + v1) * 0.5);
    const dist = Math.hypot(du * TAU * s, dv * Math.PI * Y_SCALE);
    const steps = Math.max(1, Math.ceil(dist / (radius * 0.3)));
    let box = null;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      box = union(box, this.dab(ctx, level, radius, (((u0 + du * t) % 1) + 1) % 1, v0 + dv * t));
    }
    return box;
  }

  drawStamp({ shape, r, rot, u, v }) {
    const { ctx } = this;
    const path = shapePath(shape);
    const kx = pxPerUnitX(v) * r;
    const ky = pxPerUnitY * r;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const cx = u * MASK_W;
    const cy = (1 - v) * MASK_H;
    ctx.save();
    this.setPaint(ctx, LEVEL.cut);
    for (const offset of wrapOffsets(cx, kx * 1.2)) {
      // Rotate in the y-up shape space, then scale to pixels (flipping y for the canvas).
      ctx.setTransform(kx * cos, -ky * sin, -kx * sin, -ky * cos, cx + offset, cy);
      ctx.fill(path);
    }
    ctx.restore();
  }

  // ---- loose pieces -------------------------------------------------------

  /**
   * Cuts away any skin no longer connected to the main body of the pumpkin.
   * Marks the op so replays (undo/redo) do the same, and reports the bigger
   * pieces so the stage can show them falling.
   */
  settle(op, { animate = true } = {}) {
    const image = this.ctx.getImageData(0, 0, MASK_W, MASK_H);
    const found = findIslands(image.data, MASK_W, MASK_H, CUT_THRESHOLD);
    if (found.groups.size <= 1) return;
    op.drop = true;
    const pieces = animate ? this.extractPieces(image.data, found, op) : [];
    removeLoose(image.data, found);
    this.ctx.putImageData(image, 0, 0);
    this.touch();
    if (pieces.length) this.onPieces?.(pieces);
  }

  /**
   * Builds a mask image and centre point for each of the bigger loose pieces.
   * Each piece's tumble is chosen once and stored on the op, so redo falls the
   * same way and undo can rewind exactly that path.
   */
  extractPieces(d, { labels, groupOf, groups, main }, op) {
    const falling = new Map();
    [...groups]
      .filter(([g, info]) => g !== main && info.area >= MIN_FALLING_AREA)
      .sort((a, b) => b[1].area - a[1].area)
      .slice(0, MAX_FALLING_PIECES)
      .forEach(([g, info], i) => {
        op.tumble ??= [];
        op.tumble[i] ??= randomTumble();
        falling.set(g, { pixels: new Uint8ClampedArray(d.length).fill(255), sum: [0, 0, 0], n: 0, hasStem: info.top, tumble: op.tumble[i] });
      });
    if (!falling.size) return [];

    const p = [0, 0, 0];
    for (let y = 0, i = 0; y < MASK_H; y++) {
      for (let x = 0; x < MASK_W; x++, i++) {
        const piece = labels[i] && falling.get(groupOf[labels[i]]);
        if (!piece) continue;
        // The piece keeps its own carving; everything else in its mask is "cut".
        const k = i * 4;
        piece.pixels[k] = piece.pixels[k + 1] = piece.pixels[k + 2] = d[k];
        if (x % 3 === 0 && y % 3 === 0) {
          surfacePoint((x + 0.5) / MASK_W, 1 - (y + 0.5) / MASK_H, p);
          piece.sum[0] += p[0];
          piece.sum[1] += p[1];
          piece.sum[2] += p[2];
          piece.n++;
        }
      }
    }
    return [...falling.values()]
      .filter((piece) => piece.n > 0)
      .map((piece) => ({
        image: new ImageData(piece.pixels, MASK_W, MASK_H),
        centroid: piece.sum.map((s) => s / piece.n),
        hasStem: piece.hasStem,
        tumble: piece.tumble,
      }));
  }

  touch() {
    this.texture.needsUpdate = true;
    // The stem stays only while the skin at the top pole is still there.
    const row = this.ctx.getImageData(0, 0, MASK_W, 1).data;
    let attached = false;
    for (let k = 0; k < row.length && !attached; k += 4) attached = row[k] < CUT_THRESHOLD;
    this.stemAttached = attached;
  }

  // ---- export -------------------------------------------------------------

  toDataURL() {
    this.finishRewind(); // never save the in-between "hole still open" frame
    return this.canvas.toDataURL('image/png');
  }
}

/** A texture for a mask-sized canvas or image, set up the way the skin shader expects. */
export function maskTexture(source) {
  const texture = source instanceof HTMLCanvasElement ? new THREE.CanvasTexture(source) : new THREE.Texture(source);
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = THREE.RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

/** Turns every pixel that isn't part of the main body into a hole. */
function removeLoose(d, { labels, groupOf, main }) {
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] && groupOf[labels[i]] !== main) d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255;
  }
}

function randomTumble() {
  const axis = [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5];
  const len = Math.hypot(...axis) || 1;
  return { axis: axis.map((a) => a / len), rate: 1.5 + Math.random() * 2.5 };
}

function clearCanvas(ctx) {
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, MASK_W, MASK_H);
}

function union(a, b) {
  if (!a) return b;
  if (!b) return a;
  return { x0: Math.min(a.x0, b.x0), x1: Math.max(a.x1, b.x1), y0: Math.min(a.y0, b.y0), y1: Math.max(a.y1, b.y1) };
}

function clampBox(box) {
  if (!box) return null;
  const x = Math.max(0, Math.floor(box.x0));
  const y = Math.max(0, Math.floor(box.y0));
  const w = Math.min(MASK_W, Math.ceil(box.x1)) - x;
  const h = Math.min(MASK_H, Math.ceil(box.y1)) - y;
  return w > 0 && h > 0 ? { x, y, w, h } : null;
}

/** Shapes near the seam also need drawing one texture-width over so they wrap around. */
function wrapOffsets(cx, halfWidth) {
  const offsets = [0];
  if (cx - halfWidth < 0) offsets.push(MASK_W);
  if (cx + halfWidth > MASK_W) offsets.push(-MASK_W);
  return offsets;
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load the carving'));
    img.src = src;
  });
}
