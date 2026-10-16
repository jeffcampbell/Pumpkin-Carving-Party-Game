import * as THREE from 'three';
import { LEVEL } from './mask.js';

// Turns pointer input on the stage into carving. Dragging on the pumpkin carves;
// dragging off it (or with the Rotate tool, or a right/second button) orbits.

export const TOOLS = {
  saw: { label: 'Saw', hint: 'Drag to cut all the way through', level: LEVEL.cut, kind: 'stroke', size: [0.008, 0.06, 0.018] },
  drill: { label: 'Drill', hint: 'Tap to punch round holes', level: LEVEL.cut, kind: 'dot', size: [0.015, 0.12, 0.04] },
  cutter: { label: 'Cutters', hint: 'Tap to punch out a shape', level: LEVEL.cut, kind: 'stamp', size: [0.05, 0.45, 0.16] },
  etch: { label: 'Etcher', hint: 'Shave the skin so it glows softly', level: LEVEL.etch, kind: 'stroke', size: [0.01, 0.12, 0.035] },
  patch: { label: 'Patch', hint: 'Glue skin back over mistakes', level: LEVEL.skin, kind: 'stroke', size: [0.01, 0.15, 0.05] },
  rotate: { label: 'Rotate', hint: 'Drag to spin the pumpkin', kind: 'none' },
};

export class Carver {
  constructor(stage, mask, { onEdit } = {}) {
    this.stage = stage;
    this.mask = mask;
    this.onEdit = onEdit;
    this.enabled = true;
    this.tool = 'saw';
    this.shape = 'triangle';
    this.rotation = 0;
    this.sizes = Object.fromEntries(Object.entries(TOOLS).filter(([, t]) => t.size).map(([k, t]) => [k, t.size[2]]));
    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.pointerId = null;

    this.cursor = new THREE.Mesh(
      new THREE.RingGeometry(0.85, 1, 48),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.75, depthTest: false }),
    );
    this.cursor.renderOrder = 10;
    this.cursor.visible = false;
    stage.scene.add(this.cursor);

    // Capture phase on the container runs before OrbitControls' own listener on
    // the canvas, so we can switch orbiting off when a drag starts on the pumpkin.
    const el = stage.container;
    this.listeners = {
      pointerdown: (e) => this.down(e),
      pointermove: (e) => this.move(e),
      pointerup: (e) => this.up(e),
      pointercancel: (e) => this.up(e),
      pointerleave: () => (this.cursor.visible = false),
    };
    for (const [type, fn] of Object.entries(this.listeners)) el.addEventListener(type, fn, { capture: true });
  }

  get size() {
    return this.sizes[this.tool];
  }

  set size(value) {
    if (this.tool in this.sizes) this.sizes[this.tool] = value;
  }

  hit(e) {
    const rect = this.stage.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.stage.camera);
    return this.raycaster.intersectObject(this.stage.outerMesh, false)[0] ?? null;
  }

  down(e) {
    const tool = TOOLS[this.tool];
    if (!this.enabled || tool.kind === 'none' || e.button !== 0 || this.pointerId !== null) return;
    const hit = this.hit(e);
    if (!hit) return;

    this.stage.controls.enabled = false;
    const { x: u, y: v } = hit.uv;
    if (tool.kind === 'stamp') {
      this.mask.stamp(this.shape, this.size, this.rotation, u, v);
      this.pointerId = e.pointerId; // swallow the drag so it doesn't orbit
    } else {
      this.mask.beginStroke(tool.level, this.size, u, v);
      this.pointerId = e.pointerId;
      if (tool.kind === 'dot') this.mask.endStroke();
    }
    this.stage.container.setPointerCapture?.(e.pointerId);
  }

  move(e) {
    if (!this.enabled) return;
    const hit = e.pointerType === 'touch' && this.pointerId === null ? null : this.hit(e);
    this.updateCursor(hit);
    if (hit && this.pointerId === e.pointerId && TOOLS[this.tool].kind === 'stroke') {
      this.mask.extendStroke(hit.uv.x, hit.uv.y);
    }
  }

  up(e) {
    if (this.pointerId !== e.pointerId) return;
    this.pointerId = null;
    this.mask.endStroke();
    this.stage.controls.enabled = true;
    if (e.pointerType === 'touch') this.cursor.visible = false;
    this.onEdit?.();
  }

  updateCursor(hit) {
    const tool = TOOLS[this.tool];
    this.cursor.visible = !!hit && tool.kind !== 'none';
    if (!this.cursor.visible) return;
    const normal = hit.face.normal.clone().transformDirection(this.stage.outerMesh.matrixWorld);
    this.cursor.position.copy(hit.point).addScaledVector(normal, 0.01);
    this.cursor.lookAt(hit.point.clone().add(normal));
    this.cursor.scale.setScalar(this.size);
  }

  dispose() {
    for (const [type, fn] of Object.entries(this.listeners)) {
      this.stage.container.removeEventListener(type, fn, { capture: true });
    }
    this.cursor.geometry.dispose();
    this.cursor.material.dispose();
  }
}
