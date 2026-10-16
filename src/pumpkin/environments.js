import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { createPumpkinGeometry } from './geometry.js';
import { SHAPES } from './shapes.js';

// Scenes the pumpkin sits in. Everything is generated in code — painted canvas
// textures and simple geometry — so there are no image assets to download.
//
// Each scene has a surface the pumpkin rests on, a 360° backdrop painted onto
// the inside of a cylinder around it, a few 3D props, and its own lighting.

export const FLOOR_Y = -0.72; // where the bottom of the pumpkin rests
const WALL_RADIUS = 7.5;
const WALL_HEIGHT = 8;
const PANO_W = 4096;
const PANO_H = 700; // keeps the cylinder's aspect (2πr : height) close to the canvas's
const PX = PANO_H / WALL_HEIGHT; // backdrop pixels per world unit

/**
 * @returns {{ group: THREE.Group, lighting: object, dispose(): void }}
 */
export function buildEnvironment(id) {
  const scene = SCENE_BUILDERS[id] ?? SCENE_BUILDERS.studio;
  const env = new Environment();
  scene(env);
  return env;
}

class Environment {
  constructor() {
    this.group = new THREE.Group();
    this.disposables = [];
    this.lighting = {
      background: '#120c1c',
      hemi: ['#8a8cff', '#5a3a20', 1.1],
      key: ['#cfd6ff', 1.6, [-3, 4, 3]],
      fill: ['#ffd8b0', 0.7, [0.5, -0.5, 4]],
      fog: null, // [color, density]
      exposure: 1,
    };
    this.group.add(contactShadow(this));
  }

  track(...things) {
    this.disposables.push(...things);
    return things[0];
  }

  texture(canvas, { repeat = 1, colorSpace = THREE.SRGBColorSpace } = {}) {
    const t = this.track(new THREE.CanvasTexture(canvas));
    t.colorSpace = colorSpace;
    t.anisotropy = 4;
    if (repeat !== 1) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(repeat, repeat);
    }
    return t;
  }

  material(params) {
    return this.track(new THREE.MeshStandardMaterial(params));
  }

  mesh(geometry, material, { shadow = true } = {}) {
    this.track(geometry);
    const m = new THREE.Mesh(geometry, material);
    m.receiveShadow = shadow; // so the jack-o-lantern's light lands on it
    this.group.add(m);
    return m;
  }

  /** The painted 360° wall. `paint(ctx, W, H)` draws it; the middle of the canvas is behind the pumpkin. */
  backdrop(paint, { floorY = FLOOR_Y } = {}) {
    const canvas = makeCanvas(PANO_W, PANO_H);
    paint(canvas.getContext('2d'), PANO_W, PANO_H);
    const map = this.texture(canvas);
    // We look at it from inside the cylinder, so mirror it to read left-to-right.
    map.wrapS = THREE.RepeatWrapping;
    map.repeat.x = -1;
    const wall = this.mesh(
      new THREE.CylinderGeometry(WALL_RADIUS, WALL_RADIUS, WALL_HEIGHT, 96, 1, true),
      this.material({ map, side: THREE.BackSide, roughness: 1 }),
    );
    wall.position.y = floorY + WALL_HEIGHT / 2;
    return wall;
  }

  /** A round floor filling the backdrop cylinder. */
  floor(paint, { y = FLOOR_Y, repeat = 4, roughness = 0.9, size = 1024 } = {}) {
    const canvas = makeCanvas(size, size);
    paint(canvas.getContext('2d'), size, size);
    const floor = this.mesh(new THREE.CircleGeometry(WALL_RADIUS, 96), this.material({ map: this.texture(canvas, { repeat }), roughness }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = y;
    return floor;
  }

  /** A small flickering candle prop (no light of its own; just a glowing flame). */
  candle(x, z, height = 0.5, y = FLOOR_Y) {
    const wax = this.mesh(new THREE.CylinderGeometry(0.07, 0.075, height, 20), this.material({ color: '#efe4cf', roughness: 0.6 }));
    wax.position.set(x, y + height / 2, z);
    const flame = this.mesh(new THREE.SphereGeometry(0.028, 10, 8), this.track(new THREE.MeshBasicMaterial({ color: '#ffd27a' })), { shadow: false });
    flame.scale.set(1, 2.2, 1);
    flame.position.set(x, y + height + 0.06, z);
    const glow = new THREE.Sprite(this.track(new THREE.SpriteMaterial({ map: glowTexture(this), color: '#ffb347', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55 })));
    glow.scale.setScalar(0.5);
    glow.position.copy(flame.position);
    this.group.add(glow);
  }

  /** Uncarved pumpkins to keep ours company. */
  miniPumpkin(x, z, scale, color = '#e8701a', rotation = 0) {
    this.pumpkinGeometry ??= this.track(createPumpkinGeometry());
    const material = this.material({ color, roughness: 0.6 });
    const m = new THREE.Mesh(this.pumpkinGeometry, material);
    m.scale.setScalar(scale);
    m.position.set(x, FLOOR_Y + 0.72 * scale, z);
    m.rotation.y = rotation;
    m.receiveShadow = true;
    const stem = this.mesh(new THREE.CylinderGeometry(0.05 * scale, 0.09 * scale, 0.3 * scale, 7), this.material({ color: '#5b6b2a', roughness: 0.9 }));
    stem.position.set(x, FLOOR_Y + 0.72 * scale * 2 - 0.05 * scale, z);
    this.group.add(m);
  }

  dispose() {
    for (const d of this.disposables) d.dispose?.();
  }
}

// ---- scenes -----------------------------------------------------------------

const SCENE_BUILDERS = {
  studio(env) {
    env.floor((ctx, w, h) => {
      const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, '#2a1d38');
      g.addColorStop(1, '#120c1c');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }, { repeat: 1, roughness: 0.7 });
    env.backdrop((ctx, w, h) => {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#0d0915');
      g.addColorStop(0.6, '#24183a');
      g.addColorStop(1, '#1a1228');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      stars(ctx, w, h * 0.5, 260, rng(3), 0.35);
    });
  },

  kitchen(env) {
    Object.assign(env.lighting, {
      background: '#1b120c',
      hemi: ['#ffd2a6', '#3a2010', 0.45],
      key: ['#ffcf99', 0.9, [2, 5, 1]],
      fill: ['#ffc9a0', 0.6, [-1, 1.5, 5]],
      exposure: 1.05,
    });
    const roomFloor = FLOOR_Y - 1.5;

    // The table: a plank top on four legs, with the kitchen floor below.
    const top = env.texture(paintCanvas(1024, 1024, (ctx, w, h) => planks(ctx, w, h, { count: 6, base: [92, 52, 28], vertical: false, seed: 11 })));
    const wood = env.material({ map: top, roughness: 0.65 });
    const tableTop = env.mesh(new THREE.BoxGeometry(5.2, 0.14, 3.4), wood);
    tableTop.position.set(0, FLOOR_Y - 0.07, -0.3);
    const legMaterial = env.material({ color: '#4a2a14', roughness: 0.8 });
    for (const [x, z] of [[-2.4, -1.8], [2.4, -1.8], [-2.4, 1.2], [2.4, 1.2]]) {
      const leg = env.mesh(new THREE.BoxGeometry(0.16, 1.5, 0.16), legMaterial);
      leg.position.set(x, roomFloor + 0.75, z);
    }
    env.floor((ctx, w, h) => checkerTiles(ctx, w, h, ['#2b2421', '#3d3530']), { y: roomFloor, repeat: 6 });

    env.backdrop((ctx, w, h) => {
      const floorPx = h;
      const tableLine = h - 1.5 * PX;
      // Wallpaper above, wainscot panels below.
      wallpaper(ctx, w, h, '#3a2436', '#4a2e44', rng(4));
      const wain = tableLine + 0.6 * PX;
      ctx.fillStyle = '#2a1a14';
      ctx.fillRect(0, wain - 1.6 * PX, w, floorPx);
      ctx.fillStyle = '#3a2618';
      for (let x = 20; x < w; x += 180) ctx.fillRect(x, wain - 1.4 * PX, 150, 1.2 * PX);
      ctx.fillStyle = '#4a3020';
      ctx.fillRect(0, wain - 1.65 * PX, w, 12);

      // Window behind the pumpkin with a moonlit night outside.
      nightWindow(ctx, w / 2 - 1.6 * PX, tableLine - 4.7 * PX, 3.2 * PX, 2.6 * PX, rng(7));

      // Bunting strung across, alternating orange/purple/black flags with bats.
      bunting(ctx, w / 2 - 6.5 * PX, w / 2 + 6.5 * PX, tableLine - 5.4 * PX, 0.7 * PX, ['#ff7a1a', '#7a3cff', '#151015'], rng(9));
      bunting(ctx, w * 0.05, w * 0.32, tableLine - 5.2 * PX, 0.5 * PX, ['#ff7a1a', '#151015'], rng(10));
      bunting(ctx, w * 0.68, w * 0.95, tableLine - 5.2 * PX, 0.5 * PX, ['#7a3cff', '#ff7a1a'], rng(12));

      // A spooky portrait and a clock elsewhere in the room.
      portrait(ctx, w * 0.3, tableLine - 3.6 * PX, 1.1 * PX, 1.4 * PX);
      clock(ctx, w * 0.7, tableLine - 3 * PX, 0.55 * PX);
      cobweb(ctx, w / 2 + 1.6 * PX, tableLine - 4.7 * PX, 0.9 * PX, -1);
    }, { floorY: roomFloor });

    env.candle(-1.6, -1.1, 0.55);
    env.candle(-1.25, -1.35, 0.35);
    env.miniPumpkin(1.7, -0.9, 0.32, '#f08a2a', 1);
  },

  cottage(env) {
    Object.assign(env.lighting, {
      background: '#140f1c',
      hemi: ['#9a7cff', '#1f3a1a', 0.5],
      key: ['#b48cff', 0.9, [-4, 4, -2]],
      fill: ['#c9b0ff', 0.6, [-1, 1.5, 5]],
      fog: ['#140f1c', 0.03],
    });
    env.floor((ctx, w, h) => flagstones(ctx, w, h, rng(21)), { repeat: 3 });
    env.backdrop((ctx, w, h) => {
      stoneWall(ctx, w, h, rng(22));
      const floor = h;
      // Round window with the moon, shelves of potions either side.
      roundWindow(ctx, w / 2, floor - 3.2 * PX, 0.95 * PX, rng(23));
      shelf(ctx, w / 2 - 4.6 * PX, floor - 2.3 * PX, 2.6 * PX, rng(24));
      shelf(ctx, w / 2 + 2 * PX, floor - 2.8 * PX, 2.6 * PX, rng(25));
      shelf(ctx, w / 2 + 2 * PX, floor - 1.6 * PX, 2.6 * PX, rng(26));
      herbs(ctx, w / 2 - 2.2 * PX, w / 2 + 2.2 * PX, floor - 4.6 * PX, rng(27));
      broom(ctx, w / 2 - 5.6 * PX, floor);
      // Fireplace around the side.
      fireplace(ctx, w * 0.22, floor, 2.4 * PX);
      cobweb(ctx, w / 2 - 6 * PX, floor - 5.2 * PX, 1.1 * PX, 1);
    });

    // Bubbling cauldron with a green glow.
    const iron = env.material({ color: '#1d1b20', roughness: 0.5, metalness: 0.6 });
    const points = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      points.push(new THREE.Vector2(0.15 + Math.sin(t * Math.PI) * 0.45 + t * 0.05, t * 0.75));
    }
    const pot = env.mesh(new THREE.LatheGeometry(points, 32), iron);
    pot.material.side = THREE.DoubleSide;
    pot.scale.setScalar(0.75);
    pot.position.set(-2.3, FLOOR_Y + 0.04, -1.7);
    const brew = env.mesh(new THREE.CircleGeometry(0.32, 32), env.material({ color: '#2aff7a', emissive: '#2aff7a', emissiveIntensity: 1.4 }), { shadow: false });
    brew.rotation.x = -Math.PI / 2;
    brew.position.set(-2.3, FLOOR_Y + 0.55, -1.7);
    const glow = new THREE.PointLight('#3dff8a', 1.6, 4, 1.5);
    glow.position.set(-2.3, FLOOR_Y + 0.95, -1.7);
    env.group.add(glow);

    env.candle(1.5, -0.9, 0.45);
    env.candle(1.75, -1.2, 0.7);
    env.candle(1.3, -1.35, 0.3);
  },

  graveyard(env) {
    Object.assign(env.lighting, {
      background: '#0b1020',
      hemi: ['#5a6aa8', '#1a2418', 0.65],
      key: ['#bcd0ff', 2.0, [-4, 5, -3]],
      fill: ['#c8d4ff', 0.7, [1, 1.5, 5]],
      fog: ['#1b2238', 0.045],
    });
    env.floor((ctx, w, h) => grass(ctx, w, h, rng(31)), { repeat: 5 });
    env.backdrop((ctx, w, h) => {
      const r = rng(32);
      nightSky(ctx, w, h, ['#05070f', '#141c38', '#2a3358']);
      stars(ctx, w, h * 0.55, 500, r);
      moon(ctx, w / 2 + 1.8 * PX, h - 5.6 * PX, 0.75 * PX, '#f4f1d8');
      hills(ctx, w, h - 1.6 * PX, 0.5 * PX, '#141a2a', r);
      for (let i = 0; i < 9; i++) deadTree(ctx, r() * w, h - 1.2 * PX, (1.6 + r() * 1.4) * PX, '#0c0f18', r);
      hills(ctx, w, h - 0.9 * PX, 0.3 * PX, '#10141f', r);
      for (let x = 30; x < w; x += 90 + r() * 160) gravestone(ctx, x, h - 0.45 * PX - r() * 20, (0.35 + r() * 0.35) * PX, (0.5 + r() * 0.5) * PX, Math.floor(r() * 4), '#1c2130');
      ironFence(ctx, w, h - 0.15 * PX, 0.9 * PX, '#07080d');
      mist(ctx, w, h - 0.8 * PX, 0.9 * PX, 'rgba(150,170,220,0.18)');
      for (let i = 0; i < 14; i++) bat(ctx, w / 2 + (r() - 0.5) * w * 0.9, h - (4 + r() * 3) * PX, 18 + r() * 22, (r() - 0.5) * 0.6, '#05060b');
    });

    // A few headstones near the pumpkin.
    const stoneTexture = env.texture(paintCanvas(256, 256, (ctx, w, h) => noiseFill(ctx, w, h, [92, 96, 108], 26, rng(33))));
    const stone = env.material({ map: stoneTexture, roughness: 0.95 });
    for (const [x, z, s, rot, kind] of [[-1.9, -1.5, 1, 0.15, 0], [1.6, -2.1, 1.25, -0.2, 1], [2.7, -0.7, 0.8, -0.5, 0], [-3, -0.4, 0.9, 0.5, 2]]) {
      const shape = headstoneShape(kind);
      const g = new THREE.ExtrudeGeometry(shape, { depth: 0.16, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 2 });
      const m = env.mesh(g, stone);
      m.scale.setScalar(s);
      m.position.set(x, FLOOR_Y - 0.05, z);
      m.rotation.set(-0.05, rot, (rot > 0 ? 1 : -1) * 0.04);
    }
  },

  patch(env) {
    Object.assign(env.lighting, {
      background: '#1d1020',
      hemi: ['#ffb37a', '#2a1a08', 0.6],
      key: ['#ffb070', 1.5, [4, 3, -4]],
      fill: ['#ffd0a8', 0.7, [-1, 1.5, 5]],
      fog: ['#2a1a24', 0.035],
    });
    env.floor((ctx, w, h) => dirtAndStraw(ctx, w, h, rng(41)), { repeat: 4 });
    env.backdrop((ctx, w, h) => {
      const r = rng(42);
      nightSky(ctx, w, h, ['#120a1e', '#3a1c34', '#8a3d2a']);
      stars(ctx, w, h * 0.4, 260, r, 0.6);
      moon(ctx, w / 2 - 2.2 * PX, h - 3.4 * PX, 1.1 * PX, '#ffb15a');
      hills(ctx, w, h - 1.5 * PX, 0.4 * PX, '#2a1420', r);
      barn(ctx, w / 2 + 3.2 * PX, h - 1.35 * PX, 1.4 * PX);
      for (let x = 0; x < w; x += 26 + r() * 30) cornStalk(ctx, x, h - 0.7 * PX, (0.8 + r() * 0.5) * PX, '#2b1a12', r);
      scarecrow(ctx, w / 2 - 4.5 * PX, h - 0.6 * PX, 2 * PX);
      for (let x = 40; x < w; x += 70 + r() * 120) pumpkinSilhouette(ctx, x, h - r() * 0.3 * PX, (0.12 + r() * 0.15) * PX, '#5a2a10');
      for (let i = 0; i < 8; i++) bat(ctx, r() * w, h - (4 + r() * 2.5) * PX, 16 + r() * 18, (r() - 0.5) * 0.6, '#120812');
    });
    const strawTexture = env.texture(paintCanvas(256, 256, (ctx, w, h) => straw(ctx, w, h, rng(43))));
    const bale = env.mesh(new RoundedBoxGeometry(1.5, 0.75, 0.8, 4, 0.12), env.material({ map: strawTexture, roughness: 1 }));
    bale.position.set(-1.9, FLOOR_Y + 0.375, -1.6);
    bale.rotation.y = 0.35;
    env.miniPumpkin(1.4, -1.2, 0.45, '#e8701a', 0.4);
    env.miniPumpkin(2.1, -0.4, 0.3, '#d9d0b8', 1.3);
    env.miniPumpkin(-1.3, -0.9, 0.28, '#f08a2a', 2.2);
  },

  porch(env) {
    Object.assign(env.lighting, {
      background: '#0e0c18',
      hemi: ['#7f8cc4', '#2a1c10', 0.5],
      key: ['#ffd59a', 1.2, [1.5, 4, -1]],
      fill: ['#ffd8b0', 0.7, [-1, 1.5, 5]],
    });
    env.floor((ctx, w, h) => planks(ctx, w, h, { count: 8, base: [70, 56, 46], vertical: true, seed: 51 }), { repeat: 3 });
    env.backdrop((ctx, w, h) => {
      const r = rng(52);
      // House siding behind, the yard and night sky around the sides.
      nightSky(ctx, w, h, ['#05060e', '#151b34', '#262a4a']);
      stars(ctx, w, h * 0.5, 300, r);
      moon(ctx, w * 0.12, h - 5.2 * PX, 0.5 * PX, '#eae6d0');
      for (let i = 0; i < 6; i++) deadTree(ctx, w * (0.02 + r() * 0.25), h - 0.6 * PX, (1.8 + r()) * PX, '#090a12', r);
      const x0 = w * 0.32;
      const x1 = w * 0.68;
      siding(ctx, x0, x1, h, '#3a3448', '#2c2738');
      frontDoor(ctx, w / 2 + 0.6 * PX, h, 1.2 * PX, 2.6 * PX);
      litWindow(ctx, w / 2 - 2.6 * PX, h - 3 * PX, 1.4 * PX, 1.6 * PX);
      litWindow(ctx, w / 2 + 3.2 * PX, h - 3 * PX, 1.4 * PX, 1.6 * PX);
      porchLamp(ctx, w / 2 - 0.4 * PX, h - 2.9 * PX);
      railing(ctx, 0, x0, h, '#2a2232');
      railing(ctx, x1, w, h, '#2a2232');
      cobweb(ctx, x0 + 4, h - 5.5 * PX, 1.2 * PX, 1);
      cobweb(ctx, x1 - 4, h - 5.5 * PX, 1.2 * PX, -1);
      for (let i = 0; i < 6; i++) bat(ctx, w * (0.7 + r() * 0.25), h - (4 + r() * 2) * PX, 16 + r() * 16, (r() - 0.5) * 0.6, '#05060b');
    });
    env.miniPumpkin(-1.6, -1.0, 0.42, '#e8701a', 0.8);
    env.miniPumpkin(1.5, -1.3, 0.3, '#d9d0b8', 2.1);
    env.candle(1.9, -0.7, 0.4);
  },
};

// ---- shared props -----------------------------------------------------------

function contactShadow(env) {
  const canvas = makeCanvas(128, 128);
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(0,0,0,0.75)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.35)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const m = new THREE.Mesh(
    env.track(new THREE.PlaneGeometry(2.6, 2.6)),
    env.track(new THREE.MeshBasicMaterial({ map: env.texture(canvas), transparent: true, depthWrite: false })),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = FLOOR_Y + 0.004;
  m.renderOrder = 1;
  return m;
}

let glowCanvas;
function glowTexture(env) {
  if (!glowCanvas) {
    glowCanvas = makeCanvas(64, 64);
    const ctx = glowCanvas.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  }
  return env.texture(glowCanvas);
}

function headstoneShape(kind) {
  const s = new THREE.Shape();
  if (kind === 1) {
    // Cross
    s.moveTo(-0.09, 0);
    s.lineTo(0.09, 0);
    s.lineTo(0.09, 0.62);
    s.lineTo(0.3, 0.62);
    s.lineTo(0.3, 0.8);
    s.lineTo(0.09, 0.8);
    s.lineTo(0.09, 1.05);
    s.lineTo(-0.09, 1.05);
    s.lineTo(-0.09, 0.8);
    s.lineTo(-0.3, 0.8);
    s.lineTo(-0.3, 0.62);
    s.lineTo(-0.09, 0.62);
  } else if (kind === 2) {
    // Slab with a pointed top
    s.moveTo(-0.3, 0);
    s.lineTo(0.3, 0);
    s.lineTo(0.3, 0.6);
    s.lineTo(0, 0.85);
    s.lineTo(-0.3, 0.6);
  } else {
    // Classic rounded top
    s.moveTo(-0.32, 0);
    s.lineTo(0.32, 0);
    s.lineTo(0.32, 0.55);
    s.absarc(0, 0.55, 0.32, 0, Math.PI, false);
  }
  return s;
}

// ---- painting helpers --------------------------------------------------------

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function paintCanvas(w, h, paint) {
  const c = makeCanvas(w, h);
  paint(c.getContext('2d'), w, h);
  return c;
}

/** Small seeded random generator, so scenes look the same every time. */
function rng(seed) {
  let s = seed * 9301 + 49297;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const rgb = ([r, g, b], d = 0) => `rgb(${Math.max(0, r + d)},${Math.max(0, g + d)},${Math.max(0, b + d)})`;

function nightSky(ctx, w, h, [top, mid, bottom]) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, top);
  g.addColorStop(0.55, mid);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function stars(ctx, w, maxY, n, r, alpha = 0.8) {
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = `rgba(255,255,240,${alpha * (0.3 + r() * 0.7)})`;
    const s = r() < 0.08 ? 2.2 : 1.2;
    ctx.fillRect(r() * w, r() * maxY, s, s);
  }
}

function moon(ctx, x, y, radius, color) {
  const glow = ctx.createRadialGradient(x, y, radius * 0.8, x, y, radius * 4);
  glow.addColorStop(0, 'rgba(255,240,200,0.35)');
  glow.addColorStop(1, 'rgba(255,240,200,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(x - radius * 4, y - radius * 4, radius * 8, radius * 8);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  // A few soft craters.
  ctx.fillStyle = 'rgba(0,0,0,0.07)';
  for (const [dx, dy, s] of [[-0.3, -0.2, 0.22], [0.25, 0.1, 0.16], [-0.05, 0.4, 0.12], [0.35, -0.35, 0.1]]) {
    ctx.beginPath();
    ctx.arc(x + dx * radius, y + dy * radius, s * radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

function hills(ctx, w, baseY, amp, color, r) {
  const a = r() * 10;
  const b = r() * 10;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, ctx.canvas.height);
  for (let x = 0; x <= w; x += 16) {
    // Whole number of waves around so it wraps seamlessly.
    const t = (x / w) * Math.PI * 2;
    ctx.lineTo(x, baseY - amp * (0.6 * Math.sin(t * 3 + a) + 0.4 * Math.sin(t * 7 + b)));
  }
  ctx.lineTo(w, ctx.canvas.height);
  ctx.fill();
}

function deadTree(ctx, x, baseY, height, color, r) {
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  const branch = (x0, y0, len, angle, width, depth) => {
    const x1 = x0 + Math.cos(angle) * len;
    const y1 = y0 - Math.sin(angle) * len;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo((x0 + x1) / 2 + (r() - 0.5) * len * 0.3, (y0 + y1) / 2, x1, y1);
    ctx.stroke();
    if (depth <= 0) return;
    const n = 2 + (r() < 0.35 ? 1 : 0);
    for (let i = 0; i < n; i++) branch(x1, y1, len * (0.55 + r() * 0.2), angle + (r() - 0.5) * 1.3, width * 0.62, depth - 1);
  };
  branch(x, baseY, height * 0.45, Math.PI / 2 + (r() - 0.5) * 0.2, height * 0.07, 5);
}

function gravestone(ctx, x, baseY, w, h, kind, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  if (kind === 0) {
    ctx.moveTo(x - w / 2, baseY);
    ctx.lineTo(x - w / 2, baseY - h + w / 2);
    ctx.arc(x, baseY - h + w / 2, w / 2, Math.PI, 0);
    ctx.lineTo(x + w / 2, baseY);
  } else if (kind === 1) {
    const t = w * 0.22;
    ctx.rect(x - t / 2, baseY - h, t, h);
    ctx.rect(x - w / 2, baseY - h * 0.75, w, t);
  } else if (kind === 2) {
    ctx.moveTo(x - w / 2, baseY);
    ctx.lineTo(x - w / 2, baseY - h * 0.75);
    ctx.lineTo(x, baseY - h);
    ctx.lineTo(x + w / 2, baseY - h * 0.75);
    ctx.lineTo(x + w / 2, baseY);
  } else {
    ctx.moveTo(x - w * 0.3, baseY);
    ctx.lineTo(x - w * 0.18, baseY - h * 1.3);
    ctx.lineTo(x, baseY - h * 1.45);
    ctx.lineTo(x + w * 0.18, baseY - h * 1.3);
    ctx.lineTo(x + w * 0.3, baseY);
  }
  ctx.fill();
}

function ironFence(ctx, w, baseY, h, color) {
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(0, baseY - h * 0.85);
  ctx.lineTo(w, baseY - h * 0.85);
  ctx.moveTo(0, baseY - h * 0.2);
  ctx.lineTo(w, baseY - h * 0.2);
  ctx.stroke();
  for (let x = 0; x < w; x += 22) {
    ctx.fillRect(x - 1.5, baseY - h, 3, h);
    ctx.beginPath();
    ctx.moveTo(x - 5, baseY - h);
    ctx.lineTo(x, baseY - h - 12);
    ctx.lineTo(x + 5, baseY - h);
    ctx.fill();
  }
}

function mist(ctx, w, y, h, color) {
  const g = ctx.createLinearGradient(0, y - h, 0, y + h);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.5, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, y - h, w, h * 2);
}

const batPath = typeof Path2D !== 'undefined' ? new Path2D(SHAPES.bat.d) : null;
function bat(ctx, x, y, size, rot, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.scale(size, -size); // shape paths are y-up
  ctx.fillStyle = color;
  ctx.fill(batPath);
  ctx.restore();
}

function wallpaper(ctx, w, h, a, b, r) {
  ctx.fillStyle = a;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = b;
  for (let x = 0; x < w; x += 64) ctx.fillRect(x, 0, 24, h);
  // Little bat/diamond motif between stripes.
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  for (let y = 30; y < h; y += 70) {
    for (let x = 44 + ((y / 70) % 2) * 32; x < w; x += 64) {
      ctx.beginPath();
      ctx.moveTo(x, y - 8);
      ctx.lineTo(x + 6, y);
      ctx.lineTo(x, y + 8);
      ctx.lineTo(x - 6, y);
      ctx.fill();
    }
  }
}

function nightWindow(ctx, x, y, w, h, r) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, '#0a0e22');
  g.addColorStop(1, '#2a3060');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  ctx.translate(x, y);
  stars(ctx, w, h * 0.7, 60, r);
  ctx.translate(-x, -y);
  moon(ctx, x + w * 0.7, y + h * 0.3, h * 0.13, '#f4efd6');
  deadTree(ctx, x + w * 0.15, y + h * 1.05, h * 1.1, '#05060c', r);
  ctx.restore();
  // Frame and muntins.
  ctx.strokeStyle = '#1e140f';
  ctx.lineWidth = 16;
  ctx.strokeRect(x, y, w, h);
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(x + w / 2, y);
  ctx.lineTo(x + w / 2, y + h);
  ctx.moveTo(x, y + h / 2);
  ctx.lineTo(x + w, y + h / 2);
  ctx.stroke();
  ctx.fillStyle = '#2a1c14';
  ctx.fillRect(x - 24, y + h, w + 48, 18);
}

function bunting(ctx, x0, x1, y, sag, colors, r) {
  ctx.strokeStyle = '#1a1210';
  ctx.lineWidth = 2;
  const at = (t) => [x0 + (x1 - x0) * t, y + sag * 4 * t * (1 - t)];
  ctx.beginPath();
  for (let t = 0; t <= 1.001; t += 0.02) {
    const [px, py] = at(t);
    t === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
  }
  ctx.stroke();
  const n = Math.floor((x1 - x0) / 46);
  for (let i = 0; i < n; i++) {
    const [ax, ay] = at(i / n + 0.004);
    const [bx, by] = at((i + 0.8) / n);
    ctx.fillStyle = colors[i % colors.length];
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.lineTo((ax + bx) / 2, (ay + by) / 2 + 44);
    ctx.fill();
    if (i % 3 === 1) bat(ctx, (ax + bx) / 2, (ay + by) / 2 + 16, 9, 0, 'rgba(0,0,0,0.6)');
  }
}

function portrait(ctx, x, y, w, h) {
  ctx.fillStyle = '#3a2410';
  ctx.fillRect(x - w / 2 - 12, y - 12, w + 24, h + 24);
  ctx.fillStyle = '#c99a3a';
  ctx.fillRect(x - w / 2 - 6, y - 6, w + 12, h + 12);
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, '#2b2a3a');
  g.addColorStop(1, '#14121c');
  ctx.fillStyle = g;
  ctx.fillRect(x - w / 2, y, w, h);
  // A ghost with hollow eyes.
  ctx.fillStyle = 'rgba(230,230,250,0.85)';
  ctx.beginPath();
  ctx.arc(x, y + h * 0.42, w * 0.28, Math.PI, 0);
  ctx.lineTo(x + w * 0.28, y + h * 0.82);
  for (let i = 0; i < 4; i++) ctx.lineTo(x + w * 0.28 - (i + 0.5) * w * 0.14, y + h * (i % 2 ? 0.82 : 0.76));
  ctx.lineTo(x - w * 0.28, y + h * 0.82);
  ctx.fill();
  ctx.fillStyle = '#14121c';
  for (const dx of [-0.1, 0.1]) {
    ctx.beginPath();
    ctx.ellipse(x + dx * w, y + h * 0.42, w * 0.045, w * 0.07, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function clock(ctx, x, y, radius) {
  ctx.fillStyle = '#2a1a10';
  ctx.beginPath();
  ctx.arc(x, y, radius + 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#e8dcc0';
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#2a1a10';
  ctx.lineWidth = 4;
  ctx.beginPath();
  // Nearly midnight.
  ctx.moveTo(x, y);
  ctx.lineTo(x - radius * 0.08, y - radius * 0.55);
  ctx.moveTo(x, y);
  ctx.lineTo(x - radius * 0.2, y - radius * 0.8);
  ctx.stroke();
}

function cobweb(ctx, x, y, size, dir) {
  ctx.strokeStyle = 'rgba(220,220,235,0.35)';
  ctx.lineWidth = 1.2;
  const spokes = 6;
  for (let i = 0; i <= spokes; i++) {
    const a = (i / spokes) * (Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + dir * Math.cos(a) * size, y + Math.sin(a) * size);
    ctx.stroke();
  }
  for (let k = 1; k <= 5; k++) {
    const rr = (k / 5) * size;
    ctx.beginPath();
    for (let i = 0; i <= spokes; i++) {
      const a = (i / spokes) * (Math.PI / 2);
      const px = x + dir * Math.cos(a) * rr;
      const py = y + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py);
      else {
        const m = (i - 0.5) / spokes * (Math.PI / 2);
        ctx.quadraticCurveTo(x + dir * Math.cos(m) * rr * 0.85, y + Math.sin(m) * rr * 0.85, px, py);
      }
    }
    ctx.stroke();
  }
}

function planks(ctx, w, h, { count, base, vertical, seed }) {
  const r = rng(seed);
  const size = (vertical ? w : h) / count;
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = rgb(base, Math.round((r() - 0.5) * 24));
    if (vertical) ctx.fillRect(i * size, 0, size, h);
    else ctx.fillRect(0, i * size, w, size);
    // Grain
    for (let k = 0; k < 40; k++) {
      ctx.strokeStyle = `rgba(0,0,0,${0.05 + r() * 0.08})`;
      ctx.lineWidth = 1 + r() * 1.5;
      ctx.beginPath();
      const o = i * size + r() * size;
      if (vertical) {
        ctx.moveTo(o, 0);
        ctx.bezierCurveTo(o + (r() - 0.5) * 10, h * 0.3, o + (r() - 0.5) * 10, h * 0.7, o, h);
      } else {
        ctx.moveTo(0, o);
        ctx.bezierCurveTo(w * 0.3, o + (r() - 0.5) * 10, w * 0.7, o + (r() - 0.5) * 10, w, o);
      }
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    if (vertical) ctx.fillRect(i * size, 0, 3, h);
    else ctx.fillRect(0, i * size, w, 3);
  }
}

function checkerTiles(ctx, w, h, [a, b]) {
  const n = 8;
  const s = w / n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    ctx.fillStyle = (x + y) % 2 ? a : b;
    ctx.fillRect(x * s, y * s, s, s);
  }
}

function noiseFill(ctx, w, h, base, amount, r) {
  ctx.fillStyle = rgb(base);
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < w * h * 0.08; i++) {
    ctx.fillStyle = rgb(base, Math.round((r() - 0.5) * amount));
    ctx.fillRect(r() * w, r() * h, 2 + r() * 3, 2 + r() * 3);
  }
}

function grass(ctx, w, h, r) {
  noiseFill(ctx, w, h, [34, 46, 30], 22, r);
  for (let i = 0; i < 9000; i++) {
    const x = r() * w;
    const y = r() * h;
    ctx.strokeStyle = r() < 0.5 ? 'rgba(70,90,50,0.6)' : 'rgba(15,22,14,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (r() - 0.5) * 6, y - 4 - r() * 8);
    ctx.stroke();
  }
}

function dirtAndStraw(ctx, w, h, r) {
  noiseFill(ctx, w, h, [70, 48, 30], 28, r);
  for (let i = 0; i < 1600; i++) {
    const x = r() * w;
    const y = r() * h;
    const a = r() * Math.PI;
    const l = 8 + r() * 18;
    ctx.strokeStyle = `rgba(${200 + r() * 40},${160 + r() * 40},80,${0.3 + r() * 0.4})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }
}

function straw(ctx, w, h, r) {
  ctx.fillStyle = '#7a5a22';
  ctx.fillRect(0, 0, w, h);
  for (let i = 0; i < 1400; i++) {
    const x = r() * w;
    const y = r() * h;
    const light = r();
    ctx.strokeStyle = `rgba(${110 + light * 120},${80 + light * 90},${25 + light * 30},0.85)`;
    ctx.lineWidth = 1 + r() * 1.5;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (r() - 0.5) * 34, y + (r() - 0.5) * 8);
    ctx.stroke();
  }
  // Two bands of twine.
  ctx.fillStyle = 'rgba(60,40,20,0.85)';
  ctx.fillRect(w * 0.28, 0, 6, h);
  ctx.fillRect(w * 0.68, 0, 6, h);
}

function flagstones(ctx, w, h, r) {
  ctx.fillStyle = '#15121a';
  ctx.fillRect(0, 0, w, h);
  const cell = w / 6;
  for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) {
    const shade = 50 + Math.round(r() * 22);
    ctx.fillStyle = `rgb(${shade},${shade - 4},${shade + 6})`;
    roundRect(ctx, x * cell + 6 + r() * 6, y * cell + 6 + r() * 6, cell - 16 - r() * 8, cell - 16 - r() * 8, 18);
    ctx.fill();
  }
}

function stoneWall(ctx, w, h, r) {
  ctx.fillStyle = '#1a1620';
  ctx.fillRect(0, 0, w, h);
  let y = 0;
  while (y < h) {
    const rowH = 34 + r() * 22;
    let x = -r() * 60;
    while (x < w) {
      const sw = 50 + r() * 70;
      const shade = 46 + Math.round(r() * 26);
      ctx.fillStyle = `rgb(${shade},${shade - 6},${shade + 4})`;
      roundRect(ctx, x + 3, y + 3, sw - 6, rowH - 6, 10);
      ctx.fill();
      x += sw;
    }
    y += rowH;
  }
  // Darker toward the top of the room.
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(0,0,0,0.7)');
  g.addColorStop(0.5, 'rgba(0,0,0,0.15)');
  g.addColorStop(1, 'rgba(0,0,0,0.3)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

function roundRect(ctx, x, y, w, h, radius) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
}

function roundWindow(ctx, x, y, radius, r) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.clip();
  const g = ctx.createLinearGradient(0, y - radius, 0, y + radius);
  g.addColorStop(0, '#0d0b26');
  g.addColorStop(1, '#3b2a6a');
  ctx.fillStyle = g;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  moon(ctx, x + radius * 0.3, y - radius * 0.25, radius * 0.28, '#f1ead2');
  bat(ctx, x - radius * 0.35, y + radius * 0.1, 14, 0.2, '#08060f');
  ctx.restore();
  ctx.strokeStyle = '#2a1c14';
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.moveTo(x - radius, y);
  ctx.lineTo(x + radius, y);
  ctx.moveTo(x, y - radius);
  ctx.lineTo(x, y + radius);
  ctx.stroke();
}

function shelf(ctx, x, y, w, r) {
  ctx.fillStyle = '#3a2416';
  ctx.fillRect(x, y, w, 14);
  ctx.fillStyle = '#2a1a10';
  ctx.fillRect(x + 10, y + 14, 10, 26);
  ctx.fillRect(x + w - 20, y + 14, 10, 26);
  const colors = ['#2aff7a', '#b06bff', '#ff5a1f', '#6bd5ff', '#ffd25a'];
  let px = x + 14;
  while (px < x + w - 30) {
    const bw = 18 + r() * 22;
    const bh = 30 + r() * 50;
    const color = colors[Math.floor(r() * colors.length)];
    // Bottle: body, neck, cork, and a soft glow.
    const glow = ctx.createRadialGradient(px + bw / 2, y - bh * 0.4, 2, px + bw / 2, y - bh * 0.4, bw * 1.6);
    glow.addColorStop(0, color + '55');
    glow.addColorStop(1, color + '00');
    ctx.fillStyle = glow;
    ctx.fillRect(px - bw, y - bh * 1.4, bw * 3, bh * 1.4);
    ctx.fillStyle = color + 'cc';
    roundRect(ctx, px, y - bh * 0.7, bw, bh * 0.7, 6);
    ctx.fill();
    ctx.fillRect(px + bw * 0.35, y - bh, bw * 0.3, bh * 0.32);
    ctx.fillStyle = '#7a5a3a';
    ctx.fillRect(px + bw * 0.32, y - bh - 6, bw * 0.36, 8);
    px += bw + 8 + r() * 14;
  }
}

function herbs(ctx, x0, x1, y, r) {
  ctx.strokeStyle = '#2a1a10';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(x0, y);
  ctx.lineTo(x1, y);
  ctx.stroke();
  for (let x = x0 + 30; x < x1; x += 70 + r() * 40) {
    ctx.strokeStyle = '#3a4a22';
    ctx.lineWidth = 2;
    for (let k = 0; k < 9; k++) {
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + (r() - 0.5) * 30, y + 30, x + (r() - 0.5) * 34, y + 50 + r() * 30);
      ctx.stroke();
    }
  }
}

function broom(ctx, x, floorY) {
  ctx.strokeStyle = '#4a2e18';
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.moveTo(x - 30, floorY - 3.1 * PX);
  ctx.lineTo(x + 20, floorY - 0.6 * PX);
  ctx.stroke();
  ctx.fillStyle = '#a07a3a';
  ctx.beginPath();
  ctx.moveTo(x + 10, floorY - 0.7 * PX);
  ctx.lineTo(x + 34, floorY - 0.7 * PX);
  ctx.lineTo(x + 70, floorY);
  ctx.lineTo(x - 20, floorY);
  ctx.fill();
}

function fireplace(ctx, x, floorY, width) {
  const h = width * 0.85;
  ctx.fillStyle = '#2a2026';
  ctx.fillRect(x - width / 2 - 30, floorY - h - 40, width + 60, h + 40);
  ctx.fillStyle = '#0a0608';
  ctx.beginPath();
  ctx.moveTo(x - width / 2, floorY);
  ctx.lineTo(x - width / 2, floorY - h * 0.6);
  ctx.quadraticCurveTo(x, floorY - h * 1.05, x + width / 2, floorY - h * 0.6);
  ctx.lineTo(x + width / 2, floorY);
  ctx.fill();
  const g = ctx.createRadialGradient(x, floorY - 20, 10, x, floorY - 30, width * 0.5);
  g.addColorStop(0, 'rgba(255,190,90,0.95)');
  g.addColorStop(0.4, 'rgba(255,90,20,0.6)');
  g.addColorStop(1, 'rgba(255,60,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x - width / 2, floorY - h, width, h);
}

function cornStalk(ctx, x, baseY, h, color, r) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x, baseY);
  ctx.quadraticCurveTo(x + (r() - 0.5) * 10, baseY - h / 2, x + (r() - 0.5) * 16, baseY - h);
  ctx.stroke();
  ctx.fillStyle = color;
  for (let k = 0; k < 5; k++) {
    const y = baseY - h * (0.2 + k * 0.16);
    const dir = k % 2 ? 1 : -1;
    const len = 26 + r() * 16;
    const droop = 8 + r() * 14;
    // A long, drooping leaf: out and up along the top edge, back along a lower curve.
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + dir * len * 0.5, y - 12, x + dir * len, y + droop);
    ctx.quadraticCurveTo(x + dir * len * 0.45, y - 2, x, y + 6);
    ctx.fill();
  }
  // Tassel.
  ctx.lineWidth = 1.5;
  for (let k = -2; k <= 2; k++) {
    ctx.beginPath();
    ctx.moveTo(x, baseY - h);
    ctx.lineTo(x + k * 4, baseY - h - 10 - r() * 6);
    ctx.stroke();
  }
}

function scarecrow(ctx, x, baseY, h) {
  ctx.fillStyle = '#140a0e';
  ctx.fillRect(x - 4, baseY - h, 8, h);
  ctx.fillRect(x - h * 0.32, baseY - h * 0.72, h * 0.64, 7);
  ctx.beginPath();
  ctx.arc(x, baseY - h * 0.86, h * 0.09, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath(); // hat
  ctx.moveTo(x - h * 0.16, baseY - h * 0.9);
  ctx.lineTo(x + h * 0.16, baseY - h * 0.9);
  ctx.lineTo(x + h * 0.04, baseY - h * 1.08);
  ctx.lineTo(x - h * 0.06, baseY - h * 1.05);
  ctx.fill();
  ctx.beginPath(); // ragged coat
  ctx.moveTo(x - h * 0.2, baseY - h * 0.72);
  ctx.lineTo(x + h * 0.2, baseY - h * 0.72);
  ctx.lineTo(x + h * 0.16, baseY - h * 0.35);
  for (let i = 0; i < 5; i++) ctx.lineTo(x + h * (0.12 - i * 0.07), baseY - h * (i % 2 ? 0.38 : 0.32));
  ctx.lineTo(x - h * 0.18, baseY - h * 0.35);
  ctx.fill();
}

function barn(ctx, x, baseY, size) {
  ctx.fillStyle = '#1c0f18';
  ctx.beginPath();
  ctx.moveTo(x - size, baseY);
  ctx.lineTo(x - size, baseY - size * 0.8);
  ctx.lineTo(x - size * 0.6, baseY - size * 1.25);
  ctx.lineTo(x + size * 0.6, baseY - size * 1.25);
  ctx.lineTo(x + size, baseY - size * 0.8);
  ctx.lineTo(x + size, baseY);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,190,90,0.8)';
  ctx.fillRect(x - size * 0.12, baseY - size * 1.0, size * 0.24, size * 0.18);
}

function pumpkinSilhouette(ctx, x, baseY, radius, color) {
  ctx.fillStyle = color;
  for (const dx of [-0.45, 0, 0.45]) {
    ctx.beginPath();
    ctx.ellipse(x + dx * radius, baseY - radius * 0.75, radius * 0.6, radius * 0.75, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#2a3010';
  ctx.fillRect(x - 2, baseY - radius * 1.7, 4, radius * 0.3);
}

function siding(ctx, x0, x1, h, a, b) {
  for (let y = 0; y < h; y += 26) {
    ctx.fillStyle = (y / 26) % 2 ? a : b;
    ctx.fillRect(x0, y, x1 - x0, 26);
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(x0, y + 23, x1 - x0, 3);
  }
  ctx.fillStyle = '#1c1824';
  ctx.fillRect(x0 - 14, 0, 14, h);
  ctx.fillRect(x1, 0, 14, h);
}

function frontDoor(ctx, x, floorY, w, h) {
  ctx.fillStyle = '#1c1210';
  ctx.fillRect(x - w / 2 - 16, floorY - h - 16, w + 32, h + 16);
  ctx.fillStyle = '#4a1e1a';
  ctx.fillRect(x - w / 2, floorY - h, w, h);
  ctx.strokeStyle = 'rgba(0,0,0,0.4)';
  ctx.lineWidth = 4;
  for (const [px, py, pw, ph] of [[0.1, 0.06, 0.35, 0.4], [0.55, 0.06, 0.35, 0.4], [0.1, 0.52, 0.35, 0.42], [0.55, 0.52, 0.35, 0.42]]) {
    ctx.strokeRect(x - w / 2 + px * w, floorY - h + py * h, pw * w, ph * h);
  }
  // Wreath of little pumpkins and a knocker.
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    pumpkinSilhouette(ctx, x + Math.cos(a) * w * 0.22, floorY - h * 0.72 + Math.sin(a) * w * 0.22 + 8, 8, i % 2 ? '#d86a1a' : '#a8501a');
  }
  ctx.fillStyle = '#c9a24a';
  ctx.beginPath();
  ctx.arc(x + w * 0.35, floorY - h * 0.45, 6, 0, Math.PI * 2);
  ctx.fill();
}

function litWindow(ctx, x, y, w, h) {
  const g = ctx.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, '#ffcf7a');
  g.addColorStop(1, '#e88a2a');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  // Curtains and a lurking silhouette.
  ctx.fillStyle = 'rgba(80,20,40,0.85)';
  ctx.fillRect(x, y, w * 0.22, h);
  ctx.fillRect(x + w * 0.78, y, w * 0.22, h);
  ctx.fillStyle = 'rgba(40,10,20,0.75)';
  ctx.beginPath();
  ctx.arc(x + w * 0.5, y + h * 0.45, w * 0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(x + w * 0.38, y + h * 0.55, w * 0.24, h * 0.45);
  ctx.strokeStyle = '#1c1210';
  ctx.lineWidth = 10;
  ctx.strokeRect(x, y, w, h);
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(x + w / 2, y);
  ctx.lineTo(x + w / 2, y + h * 0.4);
  ctx.stroke();
}

function porchLamp(ctx, x, y) {
  const g = ctx.createRadialGradient(x, y, 4, x, y, 140);
  g.addColorStop(0, 'rgba(255,210,140,0.7)');
  g.addColorStop(1, 'rgba(255,210,140,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x - 140, y - 140, 280, 280);
  ctx.fillStyle = '#111';
  ctx.fillRect(x - 12, y - 20, 24, 40);
  ctx.fillStyle = '#ffe2a8';
  ctx.fillRect(x - 8, y - 14, 16, 28);
}

function railing(ctx, x0, x1, floorY, color) {
  ctx.fillStyle = color;
  const top = floorY - 1.1 * PX;
  ctx.fillRect(x0, top, x1 - x0, 12);
  ctx.fillRect(x0, floorY - 0.15 * PX, x1 - x0, 10);
  for (let x = x0 + 10; x < x1; x += 34) ctx.fillRect(x, top, 10, 1.1 * PX);
}
