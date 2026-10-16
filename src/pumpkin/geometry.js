import * as THREE from 'three';

// The pumpkin is a UV sphere pushed into a ribbed, squashed shape. Keeping the
// sphere's UVs means the carving mask maps cleanly: u wraps around the pumpkin,
// v runs bottom (0) to top (1). The front of the pumpkin (facing +z) is u = 0.25.
export const RIBS = 10;
export const Y_SCALE = 0.8;
export const INNER_SCALE = 0.93; // inner wall, gives cut edges some thickness

export function createPumpkinGeometry() {
  const geo = new THREE.SphereGeometry(1, 160, 100);
  const pos = geo.attributes.position;
  const uv = geo.attributes.uv;

  const p = [0, 0, 0];
  for (let i = 0; i < pos.count; i++) {
    surfacePoint(uv.getX(i), uv.getY(i), p);
    pos.setXYZ(i, p[0], p[1], p[2]);
  }

  geo.computeVertexNormals();
  smoothSeamNormals(geo);
  return geo;
}

/** The point on the outer skin at texture coordinate (u, v), written into `out`. */
export function surfacePoint(u, v, out = [0, 0, 0]) {
  const theta = u * Math.PI * 2;
  const polar = (1 - v) * Math.PI;
  const s = Math.sin(polar);

  // Lobes bulge out, grooves pinch in; the grooves fade toward the poles.
  const lobe = Math.pow(Math.abs(Math.cos((theta * RIBS) / 2)), 0.5);
  const r = 1 - 0.075 * (1 - lobe) * Math.pow(s, 0.6);

  // Squash, then sink a dimple at the top (where the stem sits) and bottom.
  const top = Math.exp(-((polar / 0.4) ** 2));
  const bottom = Math.exp(-(((Math.PI - polar) / 0.4) ** 2));

  // Same parameterisation as THREE.SphereGeometry.
  out[0] = -Math.cos(theta) * s * r;
  out[1] = Math.cos(polar) * Y_SCALE - 0.18 * top + 0.08 * bottom;
  out[2] = Math.sin(theta) * s * r;
  return out;
}

/** SphereGeometry duplicates vertices along its seam and poles; average their normals so no crease shows. */
function smoothSeamNormals(geo) {
  const pos = geo.attributes.position;
  const normal = geo.attributes.normal;
  const groups = new Map();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
    const list = groups.get(key);
    if (list) list.push(i);
    else groups.set(key, [i]);
  }
  const n = new THREE.Vector3();
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    n.set(0, 0, 0);
    for (const i of list) n.x += normal.getX(i), n.y += normal.getY(i), n.z += normal.getZ(i);
    n.normalize();
    for (const i of list) normal.setXYZ(i, n.x, n.y, n.z);
  }
}

export function topOfPumpkin(geo) {
  return geo.attributes.position.getY(0); // SphereGeometry's first vertex is the top pole
}

export function createStemGeometry() {
  const geo = new THREE.CylinderGeometry(0.055, 0.1, 0.36, 9, 6);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) + 0.18) / 0.36; // 0 at base, 1 at tip
    const twist = t * 0.9;
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setXYZ(
      i,
      x * Math.cos(twist) - z * Math.sin(twist) + 0.09 * t * t, // lean over a little
      pos.getY(i),
      x * Math.sin(twist) + z * Math.cos(twist),
    );
  }
  geo.translate(0, 0.18, 0);
  geo.computeVertexNormals();
  return geo;
}
