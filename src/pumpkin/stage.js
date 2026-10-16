import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LEVEL, ETCH_MAX, CUT_THRESHOLD, maskTexture } from './mask.js';
import { createPumpkinGeometry, createStemGeometry, topOfPumpkin, INNER_SCALE, RIBS } from './geometry.js';
import { buildEnvironment, FLOOR_Y } from './environments.js';
import { DEFAULT_SCENE } from '../../shared/scenes.js';

export const DEFAULT_CANDLE = '#ffb347';
export const DEFAULT_SKIN = '#ff7a1a';
const FLESH = '#e9a04a';
const HOME_CAMERA = new THREE.Vector3(0, 0.95, 5.6);
const HOME_TARGET = new THREE.Vector3(0, -0.05, 0);

/**
 * A Three.js scene with one pumpkin, a candle, a surrounding environment, and
 * orbit controls. `mask` is a CarveMask whose texture decides where the
 * pumpkin is cut. The candle casts shadows through the shell, so light only
 * escapes through the carving and projects it onto the surroundings.
 */
export class PumpkinStage {
  constructor(container, mask, { autoRotate = false, scene = DEFAULT_SCENE } = {}) {
    this.container = container;
    this.mask = mask;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // The light never moves, so shadows only need redrawing when the carving changes.
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.domElement.className = 'stage-canvas';
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 50);
    this.camera.position.copy(HOME_CAMERA);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.enablePan = false;
    this.controls.minDistance = 2.2;
    this.controls.maxDistance = 6.6; // stay inside the backdrop
    this.controls.maxPolarAngle = 1.62; // don't dip below the surface
    this.controls.target.copy(HOME_TARGET);
    this.controls.autoRotate = autoRotate;
    this.controls.autoRotateSpeed = 1.2;

    // Scene lighting; each environment sets colours and directions.
    this.hemi = new THREE.HemisphereLight();
    this.key = new THREE.DirectionalLight();
    this.fill = new THREE.DirectionalLight();
    this.scene.add(this.hemi, this.key, this.fill);

    this.pumpkin = new Pumpkin(mask.texture);
    this.scene.add(this.pumpkin.group);
    this.pieces = [];
    mask.onPieces = (pieces) => this.dropPieces(pieces);
    mask.onRewind = (pieces, done) => this.dropPieces(pieces, { rewind: true, onLanded: done });
    mask.onRewindEnd = () => this.clearRewinds();
    this.setScene(scene);

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();

    this.lastFrame = performance.now();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  get outerMesh() {
    return this.pumpkin.outer;
  }

  resize() {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Keep the whole pumpkin in view on tall, narrow (phone) screens.
    this.camera.fov = w / h < 0.8 ? 35 / Math.max(w / h / 0.8, 0.55) : 35;
    this.camera.updateProjectionMatrix();
  }

  frame() {
    const now = performance.now();
    const dt = Math.min((now - this.lastFrame) / 1000, 0.05);
    this.lastFrame = now;
    this.pumpkin.update(now / 1000);
    this.pumpkin.stem.visible = this.mask.stemAttached;
    this.updatePieces(dt);
    if (this.mask.texture.version !== this.shadowVersion) {
      this.shadowVersion = this.mask.texture.version;
      this.renderer.shadowMap.needsUpdate = true;
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  setCandleColor(hex) {
    this.pumpkin.setCandleColor(hex);
  }

  setSkinColor(hex) {
    this.pumpkin.setSkinColor(hex);
  }

  /** Swaps the surroundings (see shared/scenes.js for the list). */
  setScene(id) {
    if (this.sceneId === id) return;
    this.sceneId = id;
    if (this.environment) {
      this.scene.remove(this.environment.group);
      this.environment.dispose();
    }
    this.environment = buildEnvironment(id);
    this.scene.add(this.environment.group);

    const { background, hemi, key, fill, fog, exposure } = this.environment.lighting;
    this.scene.background = new THREE.Color(background);
    this.hemi.color.set(hemi[0]);
    this.hemi.groundColor.set(hemi[1]);
    this.hemi.intensity = hemi[2];
    for (const [light, [color, intensity, pos]] of [[this.key, key], [this.fill, fill]]) {
      light.color.set(color);
      light.intensity = intensity;
      light.position.set(...pos);
    }
    this.scene.fog = fog ? new THREE.FogExp2(fog[0], fog[1]) : null;
    this.renderer.toneMappingExposure = exposure;
    this.renderer.shadowMap.needsUpdate = true;
  }

  resetView() {
    this.camera.position.copy(HOME_CAMERA);
    this.controls.target.copy(HOME_TARGET);
    this.controls.update();
  }

  /** Front-view JPEG snapshot used as a thumbnail. */
  snapshot(size = 512) {
    const saved = { pos: this.camera.position.clone(), target: this.controls.target.clone(), fov: this.camera.fov, aspect: this.camera.aspect };
    const canvas = this.renderer.domElement;
    this.camera.position.copy(HOME_CAMERA);
    this.camera.lookAt(HOME_TARGET);
    this.camera.fov = 35;
    this.camera.aspect = canvas.width / canvas.height;
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);

    // Crop the centre square of what was just drawn (must happen before the frame is presented).
    const side = Math.min(canvas.width, canvas.height);
    const out = document.createElement('canvas');
    out.width = out.height = size;
    out.getContext('2d').drawImage(canvas, (canvas.width - side) / 2, (canvas.height - side) / 2, side, side, 0, 0, size, size);

    this.camera.position.copy(saved.pos);
    this.controls.target.copy(saved.target);
    this.camera.fov = saved.fov;
    this.camera.aspect = saved.aspect;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(saved.target);
    return out.toDataURL('image/jpeg', 0.85);
  }

  /**
   * Shows pieces that were cut loose popping out and tumbling away, or, with
   * `rewind`, flying back into place along the same path (for undo). Each piece
   * is the whole pumpkin shell drawn with a mask that keeps only that piece.
   */
  dropPieces(pieces, { rewind = false, onLanded = null } = {}) {
    let inFlight = pieces.length;
    if (rewind && !inFlight) return onLanded?.();
    for (const { image, centroid, hasStem, tumble } of pieces) {
      // Undo while a piece is still falling: turn it around from where it is.
      const falling = this.pieces.find((p) => p.tumble === tumble && !p.rewind);
      const startAge = rewind ? Math.min(falling?.age ?? REWIND_FROM, REWIND_FROM) : 0;
      if (falling) this.removePiece(falling);

      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      canvas.getContext('2d').putImageData(image, 0, 0);
      const texture = maskTexture(canvas);
      const uniforms = { uMask: { value: texture }, uCandle: this.pumpkin.uniforms.uCandle, uGlow: { value: 0.8 } };
      const materials = [
        outerMaterial(uniforms, this.pumpkin.skinTexture, this.pumpkin.outerMaterial.color),
        innerMaterial(uniforms, this.pumpkin.skinTexture),
      ];

      // Pivot around the piece's centre so it tumbles about itself.
      const center = new THREE.Vector3(...centroid);
      const group = new THREE.Group();
      const outer = new THREE.Mesh(this.pumpkin.geometry, materials[0]);
      const inner = new THREE.Mesh(this.pumpkin.geometry, materials[1]);
      inner.scale.setScalar(INNER_SCALE);
      outer.position.copy(center).negate();
      inner.position.copy(center).negate();
      group.add(outer, inner);
      if (hasStem) {
        const stem = this.pumpkin.stem.clone();
        stem.visible = true;
        stem.position.sub(center);
        group.add(stem);
      }
      this.scene.add(group);

      const piece = {
        group,
        materials,
        texture,
        uniforms,
        tumble,
        center,
        // Pop outward (and a little up), then let gravity take it.
        launch: center.clone().setY(center.y * 0.5).normalize().multiplyScalar(0.8).add(new THREE.Vector3(0, 0.7, 0)),
        axis: new THREE.Vector3(...tumble.axis),
        age: startAge,
        rewind,
        rewindFrom: startAge,
        rewindTime: 0,
        fadeIn: rewind && !falling,
        onLanded: rewind ? () => --inFlight === 0 && onLanded?.() : null,
      };
      this.pieces.push(piece);
      this.posePiece(piece);
    }
  }

  /** A piece's pose is a pure function of its age, so the fall can be played backwards exactly. */
  posePiece(piece) {
    const t = piece.age;
    // Flies until it hits the surface, then slides and spins to a stop there.
    const { center, launch } = piece;
    const restY = FLOOR_Y + 0.06;
    piece.landAt ??= (launch.y + Math.sqrt(launch.y ** 2 + 2 * GRAVITY * Math.max(0, center.y - restY))) / GRAVITY;
    const flight = Math.min(t, piece.landAt);
    const slide = t > piece.landAt ? (1 - Math.exp(-4 * (t - piece.landAt))) / 4 : 0;
    const travel = flight + slide;
    piece.group.position.set(
      center.x + launch.x * travel,
      t < piece.landAt ? center.y + launch.y * t - 0.5 * GRAVITY * t * t : restY,
      center.z + launch.z * travel,
    );
    piece.group.quaternion.setFromAxisAngle(piece.axis, piece.tumble.rate * travel);
    // Out of the candle's reach, the piece's glow dies down.
    piece.uniforms.uGlow.value = Math.max(0.15, 0.8 - t);
    const fadeOut = Math.min(1, Math.max(0, (PIECE_LIFETIME - t) / 0.5));
    const fadeIn = piece.fadeIn ? Math.min(1, piece.rewindTime / 0.15) : 1;
    const opacity = Math.min(fadeOut, fadeIn);
    for (const m of piece.materials) {
      m.transparent = opacity < 1;
      m.opacity = opacity;
    }
  }

  updatePieces(dt) {
    for (const piece of [...this.pieces]) {
      if (piece.rewind) {
        // Fast at first, easing gently into place.
        piece.rewindTime += dt;
        const duration = 0.35 + 0.4 * (piece.rewindFrom / REWIND_FROM);
        const s = Math.min(1, piece.rewindTime / duration);
        piece.age = piece.rewindFrom * (1 - s) ** 3;
        this.posePiece(piece);
        if (s >= 1) {
          this.removePiece(piece);
          piece.onLanded();
        }
      } else {
        piece.age += dt;
        this.posePiece(piece);
        if (piece.age >= PIECE_LIFETIME) this.removePiece(piece);
      }
    }
  }

  /** Drops any pieces mid-rewind (the undo was completed some other way). */
  clearRewinds() {
    for (const piece of this.pieces.filter((p) => p.rewind)) this.removePiece(piece);
  }

  removePiece(piece) {
    this.scene.remove(piece.group);
    for (const m of piece.materials) m.dispose();
    piece.texture.dispose();
    this.pieces = this.pieces.filter((p) => p !== piece);
  }

  dispose() {
    for (const piece of [...this.pieces]) this.removePiece(piece);
    this.renderer.setAnimationLoop(null);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.pumpkin.dispose();
    this.environment.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

class Pumpkin {
  constructor(maskTexture) {
    this.group = new THREE.Group();
    this.uniforms = {
      uMask: { value: maskTexture },
      uCandle: { value: new THREE.Color(DEFAULT_CANDLE) },
      uGlow: { value: 1 },
    };

    const geometry = createPumpkinGeometry();
    this.geometry = geometry;
    this.skinTexture = skinTexture();

    this.outerMaterial = outerMaterial(this.uniforms, this.skinTexture, DEFAULT_SKIN);
    this.outer = new THREE.Mesh(geometry, this.outerMaterial);
    this.group.add(this.outer);

    this.innerMaterial = innerMaterial(this.uniforms, this.skinTexture);
    this.inner = new THREE.Mesh(geometry, this.innerMaterial);
    this.inner.scale.setScalar(INNER_SCALE);
    this.group.add(this.inner);

    // Both walls block the candle, except where the carving cuts through.
    this.shadowMaterial = carvedShadowMaterial(this.uniforms);
    for (const wall of [this.outer, this.inner]) {
      wall.castShadow = true;
      wall.customDistanceMaterial = this.shadowMaterial;
      wall.material.shadowSide = THREE.DoubleSide; // the light sees the walls from inside
    }

    const stem = (this.stem = new THREE.Mesh(createStemGeometry(), new THREE.MeshStandardMaterial({ color: '#5b6b2a', roughness: 0.85, flatShading: true })));
    stem.position.y = topOfPumpkin(geometry) - 0.03;
    stem.castShadow = true;
    this.group.add(stem);

    // Candle: a stub of wax, a flame, and the light that does the real work.
    const floor = -Y_FLOOR;
    const wax = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.085, 0.2, 20), new THREE.MeshStandardMaterial({ color: '#f3ead8', roughness: 0.6 }));
    wax.position.y = floor + 0.1;
    this.flameMaterial = new THREE.MeshBasicMaterial({ color: '#fff3c4' });
    this.flame = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 10), this.flameMaterial);
    this.flame.scale.set(1, 2.2, 1);
    this.flame.position.y = floor + 0.27;
    // Reaches all the way to the backdrop, so the carved face projects onto it.
    // A gentle falloff (instead of the physical inverse-square) keeps the inside
    // from blowing out while still throwing enough light onto the surroundings.
    this.light = new THREE.PointLight(DEFAULT_CANDLE, CANDLE_INTENSITY, 0, 0.6);
    this.light.position.y = floor + 0.45;
    this.light.castShadow = true;
    const small = window.innerWidth < 760;
    this.light.shadow.mapSize.set(small ? 512 : 1024, small ? 512 : 1024);
    this.light.shadow.camera.near = 0.02; // the walls are close to the flame
    this.light.shadow.camera.far = 20;
    this.light.shadow.bias = -0.003;
    this.light.shadow.radius = 3;
    this.group.add(wax, this.flame, this.light);
  }

  setCandleColor(hex) {
    this.uniforms.uCandle.value.set(hex);
    this.light.color.set(hex);
    this.flameMaterial.color.set(hex).lerp(new THREE.Color('#ffffff'), 0.55);
  }

  setSkinColor(hex) {
    this.outerMaterial.color.set(hex);
  }

  update(t) {
    // A few out-of-step sines make a believable flicker.
    const flicker = 0.85 + 0.08 * Math.sin(t * 7.3) + 0.05 * Math.sin(t * 13.1 + 1.3) + 0.03 * Math.sin(t * 23.7 + 0.4);
    this.uniforms.uGlow.value = flicker;
    this.light.intensity = CANDLE_INTENSITY * flicker;
    this.flame.scale.set(1, 2.2 + 0.25 * Math.sin(t * 9.1), 1);
  }

  dispose() {
    this.group.traverse((obj) => {
      obj.geometry?.dispose();
      obj.material?.dispose();
    });
    this.skinTexture.dispose();
    this.shadowMaterial.dispose();
  }
}

/** Shadow-pass material for the walls: holes where the mask says the skin is cut. */
function carvedShadowMaterial(uniforms) {
  const material = new THREE.MeshDistanceMaterial();
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uMask = uniforms.uMask;
    // The renderer assigns the wall's own skin map here, which gives us vMapUv.
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `uniform sampler2D uMask;\nvoid main() {`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        if (texture2D(uMask, vMapUv).r > ${(CUT_THRESHOLD / 255).toFixed(4)}) discard;`);
  };
  return material;
}

/** Outer skin: holes where the mask is white, glowing shaved flesh where it's grey. */
function outerMaterial(uniforms, map, color) {
  const material = new THREE.MeshStandardMaterial({ map, color, roughness: 0.55 });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `${MASK_UNIFORMS}\n${ETCH_HELPERS}\nvoid main() {`)
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        float carve = texture2D(uMask, vMapUv).r;
        if (carve > CUT) discard;
        float etched = smoothstep(0.12, 0.3, carve);
        float etchDepth = etchDepthAt(carve); // 0 = first pass, 1 = shaved as thin as it goes
        // Shaved flesh reflects little outside light; its look comes from the candle behind it.
        float fibre = 0.2 * vnoise(vMapUv * vec2(1100.0, 30.0)) + 0.5 * vnoise(vMapUv * vec2(90.0, 45.0)) + 0.3 * vnoise(vMapUv * vec2(260.0, 130.0));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.3, 0.13, 0.04) * (0.8 + 0.4 * fibre), etched);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
        // Treat the etch as a height map so shaved areas sit below the skin with bevelled walls.
        {
          vec2 dUx = dFdx(vMapUv), dUy = dFdy(vMapUv);
          float h0 = etchHeight(vMapUv);
          vec2 dH = vec2(etchHeight(vMapUv + dUx) - h0, etchHeight(vMapUv + dUy) - h0) * -2.5;
          vec3 sx = dFdx(-vViewPosition), sy = dFdy(-vViewPosition);
          vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
          float det = dot(sx, r1) * faceDirection;
          normal = normalize(abs(det) * normal - sign(det) * (dH.x * r1 + dH.y * r2));
        }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          // Light passing through the thinned wall: brightest face-on, uneven along the fibres,
          // tinted a little by the flesh it travels through, and bleeding softly into nearby skin.
          float facing = abs(dot(normalize(vNormal), normalize(vViewPosition)));
          float halo = etchHalo(vMapUv);
          vec3 throughFlesh = mix(uCandle, uCandle * vec3(1.0, 0.6, 0.3), 0.45);
          // The wall is thickest at the bevelled edge, so the middle of a shaved patch glows most.
          float depth = mix(0.55, 1.0, halo);
          float transmit = etched * depth * mix(0.6, 1.3, etchDepth) * (0.4 + 0.6 * fibre) * (0.35 + 0.65 * facing);
          float bleed = max(halo - etched, 0.0);
          vec3 hotCore = mix(uCandle, vec3(1.0, 0.95, 0.8), 0.3) * pow(transmit, 3.0) * 0.3 * etchDepth;
          totalEmissiveRadiance += uGlow * (throughFlesh * (transmit * 0.85 + bleed * 0.3) + hotCore);
        }`,
      );
  };
  return material;
}

/** Inner wall: its outside faces show as the cut edge, its inside faces are the lit interior. */
function innerMaterial(uniforms, map) {
  const material = new THREE.MeshStandardMaterial({ map, color: FLESH, roughness: 0.9, side: THREE.DoubleSide });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `${MASK_UNIFORMS}\nvoid main() {`)
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        if (texture2D(uMask, vMapUv).r > CUT) discard;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance += uCandle * uGlow * (gl_FrontFacing ? 0.18 : 0.5);`,
      );
  };
  return material;
}

const PIECE_LIFETIME = 3.2; // seconds a fallen piece stays on screen
const REWIND_FROM = 1.1; // undo starts a piece from this far along its fall
const GRAVITY = 4.5;
const CANDLE_INTENSITY = 13;
const Y_FLOOR = 0.62; // roughly where the inside bottom of the pumpkin is

const MASK_UNIFORMS = `const float CUT = ${(CUT_THRESHOLD / 255).toFixed(4)};
uniform sampler2D uMask;
uniform vec3 uCandle;
uniform float uGlow;`;

// Sampling helpers for the etching effect. Offsets are in mask texels (2048x1024).
const ETCH_HELPERS = `
const vec2 MASK_TEXEL = vec2(1.0 / 2048.0, 1.0 / 1024.0);
// Etch passes are stored as mask levels ${LEVEL.etch}..${ETCH_MAX} (of 255); cuts are at or above ${CUT_THRESHOLD}.
float etchDepthAt(float m) { return clamp((m - ${(LEVEL.etch / 255).toFixed(4)}) / ${((ETCH_MAX - LEVEL.etch) / 255).toFixed(4)}, 0.0, 1.0); }
// Height below the skin: each deeper pass steps down further, so it gets its own bevel.
float etchAt(vec2 uv) {
  float m = texture2D(uMask, uv).r;
  return smoothstep(0.12, 0.3, m) * (0.5 + 0.5 * etchDepthAt(m));
}
// Slightly blurred so the bevel reads as a sloped wall rather than a one-pixel step.
float etchHeight(vec2 uv) {
  vec2 t = MASK_TEXEL * 2.0;
  return (2.0 * etchAt(uv) + etchAt(uv + vec2(t.x, 0.0)) + etchAt(uv - vec2(t.x, 0.0))
    + etchAt(uv + vec2(0.0, t.y)) + etchAt(uv - vec2(0.0, t.y))) / 6.0;
}
// Wide, soft sample used for light bleeding through the skin around an etch.
float etchHalo(vec2 uv) {
  float sum = 0.0;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.785398;
    sum += etchAt(uv + vec2(cos(a), sin(a)) * MASK_TEXEL * 9.0);
  }
  return sum / 8.0;
}
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}`;

/** A greyscale skin pattern (darker grooves, faint streaks); the material colour tints it. */
function skinTexture() {
  const w = 1024;
  const h = 512;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);

  const band = w / RIBS;
  for (let k = 0; k < RIBS; k++) {
    const x = (k + 0.5) * band;
    const g = ctx.createLinearGradient(x - band * 0.35, 0, x + band * 0.35, 0);
    g.addColorStop(0, 'rgba(60,20,0,0)');
    g.addColorStop(0.5, 'rgba(60,20,0,0.38)');
    g.addColorStop(1, 'rgba(60,20,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - band * 0.35, 0, band * 0.7, h);
  }

  // Thin vertical streaks along each lobe.
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 260; i++) {
    const x = rand() * w;
    ctx.strokeStyle = `rgba(${rand() > 0.5 ? '255,255,220' : '80,30,0'},${0.05 + rand() * 0.08})`;
    ctx.beginPath();
    ctx.moveTo(x, h * 0.08);
    ctx.bezierCurveTo(x + (rand() - 0.5) * 12, h * 0.4, x + (rand() - 0.5) * 12, h * 0.6, x, h * 0.92);
    ctx.stroke();
  }

  // Darker toward the stem and the base.
  const v = ctx.createLinearGradient(0, 0, 0, h);
  v.addColorStop(0, 'rgba(50,30,0,0.45)');
  v.addColorStop(0.15, 'rgba(50,30,0,0)');
  v.addColorStop(0.85, 'rgba(50,30,0,0)');
  v.addColorStop(1, 'rgba(50,30,0,0.2)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}
