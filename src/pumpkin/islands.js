// Finds pieces of skin that are no longer attached to the rest of the pumpkin.
//
// The mask wraps around a sphere, so connectivity wraps left/right at the u seam,
// and every pixel in the top row is the same point (the top pole), as is every
// pixel in the bottom row. Neighbours are 4-connected: two solid pixels touching
// only at a corner are separate, so a clean saw line always splits the skin.

/**
 * @param {Uint8ClampedArray} data  RGBA pixels of the mask (only the red channel is read)
 * @param {number} cutThreshold     values at or above this are holes
 * @returns {{ labels: Int32Array, groupOf: Int32Array, groups: Map<number, {area:number, pixels:number, top:boolean}>, main: number }}
 *   labels: per-pixel component label (0 = hole); groupOf: label -> group id;
 *   groups: area is weighted by real surface area; main: the group that stays attached.
 */
export function findIslands(data, width, height, cutThreshold) {
  const n = width * height;
  const labels = new Int32Array(n);
  const queue = new Int32Array(n);
  const rowWeight = new Float64Array(height);
  for (let y = 0; y < height; y++) rowWeight[y] = Math.sin((Math.PI * (y + 0.5)) / height);

  const comps = [null];
  for (let start = 0; start < n; start++) {
    if (labels[start] || data[start * 4] >= cutThreshold) continue;
    const label = comps.length;
    let head = 0;
    let tail = 0;
    let area = 0;
    let pixels = 0;
    let top = false;
    let bottom = false;
    labels[start] = label;
    queue[tail++] = start;
    while (head < tail) {
      const i = queue[head++];
      const y = (i / width) | 0;
      const x = i - y * width;
      area += rowWeight[y];
      pixels++;
      if (y === 0) top = true;
      if (y === height - 1) bottom = true;

      let j = x === 0 ? i + width - 1 : i - 1;
      if (!labels[j] && data[j * 4] < cutThreshold) (labels[j] = label), (queue[tail++] = j);
      j = x === width - 1 ? i - width + 1 : i + 1;
      if (!labels[j] && data[j * 4] < cutThreshold) (labels[j] = label), (queue[tail++] = j);
      if (y > 0) {
        j = i - width;
        if (!labels[j] && data[j * 4] < cutThreshold) (labels[j] = label), (queue[tail++] = j);
      }
      if (y < height - 1) {
        j = i + width;
        if (!labels[j] && data[j * 4] < cutThreshold) (labels[j] = label), (queue[tail++] = j);
      }
    }
    comps.push({ area, pixels, top, bottom });
  }

  // Components that touch the same pole are joined through it (union-find).
  const parent = Int32Array.from(comps, (_, i) => i);
  const find = (a) => {
    while (parent[a] !== a) a = parent[a] = parent[parent[a]];
    return a;
  };
  let firstTop = 0;
  let firstBottom = 0;
  for (let label = 1; label < comps.length; label++) {
    if (comps[label].top) firstTop ? (parent[find(label)] = find(firstTop)) : (firstTop = label);
    if (comps[label].bottom) firstBottom ? (parent[find(label)] = find(firstBottom)) : (firstBottom = label);
  }
  const groupOf = new Int32Array(comps.length);
  for (let label = 1; label < comps.length; label++) groupOf[label] = find(label);

  const groups = new Map();
  for (let label = 1; label < comps.length; label++) {
    const c = comps[label];
    const g = groupOf[label];
    const group = groups.get(g) ?? { area: 0, pixels: 0, top: false };
    group.area += c.area;
    group.pixels += c.pixels;
    group.top ||= c.top;
    groups.set(g, group);
  }

  let main = 0;
  let best = -1;
  for (const [g, group] of groups) if (group.area > best) (best = group.area), (main = g);
  return { labels, groupOf, groups, main };
}
