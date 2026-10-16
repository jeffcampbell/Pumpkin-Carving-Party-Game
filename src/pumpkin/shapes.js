// Cookie-cutter shapes for the cutter tool, as SVG paths in a y-up unit box
// (roughly -1..1). The same path drives both the carving (via Path2D) and the
// toolbar icon (flipped for SVG's y-down).

function star(points, outer, inner) {
  const pts = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 ? inner : outer;
    const a = Math.PI / 2 + (i * Math.PI) / points;
    pts.push(`${(r * Math.cos(a)).toFixed(3)} ${(r * Math.sin(a)).toFixed(3)}`);
  }
  return `M${pts.join('L')}Z`;
}

function polygon(points) {
  return `M${points.map(([x, y]) => `${x} ${y}`).join('L')}Z`;
}

const batRight = [[0.15, 0.45], [0.2, 0.2], [0.55, 0.45], [1, 0.55], [0.85, 0.1], [0.7, 0.2], [0.55, -0.1], [0.4, 0.05], [0.2, -0.3]];

export const SHAPES = {
  triangle: { label: 'Triangle', d: 'M0 1L0.95 -0.7L-0.95 -0.7Z' },
  circle: { label: 'Circle', d: 'M1 0A1 1 0 1 1 -1 0A1 1 0 1 1 1 0Z' },
  diamond: { label: 'Diamond', d: 'M0 1L0.65 0L0 -1L-0.65 0Z' },
  eye: { label: 'Eye', d: 'M-1 0Q0 1.1 1 0Q0 -1.1 -1 0Z' },
  grin: {
    label: 'Toothy grin',
    d: 'M-1 0.35L-0.5 0.12L-0.4 -0.2L-0.28 0.08L0.28 0.08L0.4 -0.2L0.5 0.12L1 0.35Q0 -1.4 -1 0.35Z',
  },
  star: { label: 'Star', d: star(5, 1, 0.42) },
  crescent: { label: 'Moon', d: 'M0.83 0.85A1 1 0 1 1 0.83 -0.85A0.85 0.85 0 1 0 0.83 0.85Z' },
  heart: {
    label: 'Heart',
    d: 'M0 -1C-0.6 -0.45 -1.1 0.05 -1 0.45C-0.9 1 -0.2 1.05 0 0.55C0.2 1.05 0.9 1 1 0.45C1.1 0.05 0.6 -0.45 0 -1Z',
  },
  bat: {
    label: 'Bat',
    d: polygon([
      [-0.15, 0.45], [-0.08, 0.25], [0.08, 0.25], ...batRight, [0, -0.45],
      ...batRight.map(([x, y]) => [-x, y]).reverse(),
    ]),
  },
};

const pathCache = new Map();
export function shapePath(name) {
  if (!pathCache.has(name)) pathCache.set(name, new Path2D(SHAPES[name].d));
  return pathCache.get(name);
}

export function shapeIcon(name) {
  return `<svg viewBox="-1.15 -1.15 2.3 2.3" aria-hidden="true"><path transform="scale(1,-1)" d="${SHAPES[name].d}"/></svg>`;
}
