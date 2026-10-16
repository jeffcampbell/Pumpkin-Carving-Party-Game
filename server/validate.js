// Shared validation for pumpkin payloads (used by the REST API and the game).

import { DEFAULT_SCENE, isScene } from '../shared/scenes.js';

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export const MAX_MASK_BYTES = 1_500_000;
export const MAX_THUMB_BYTES = 300_000;

export class ValidationError extends Error {}

export function color(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' || !HEX_COLOR.test(value)) {
    throw new ValidationError('Colors must look like #ff8800');
  }
  return value.toLowerCase();
}

export function scene(value) {
  if (value === undefined || value === null || value === '') return DEFAULT_SCENE;
  if (!isScene(value)) throw new ValidationError('Unknown scene');
  return value;
}

export function title(value) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new ValidationError('Title must be text');
  return value.replace(/\s+/g, ' ').trim().slice(0, 60);
}

const SIGNATURES = {
  png: { prefix: 'data:image/png;base64,', magic: [0x89, 0x50, 0x4e, 0x47] },
  jpeg: { prefix: 'data:image/jpeg;base64,', magic: [0xff, 0xd8, 0xff] },
};

/** Decodes a data: URL into a Buffer, checking type and size. */
export function imageDataUrl(value, kind, maxBytes, label) {
  const sig = SIGNATURES[kind];
  if (typeof value !== 'string' || !value.startsWith(sig.prefix)) {
    throw new ValidationError(`${label} must be a ${kind.toUpperCase()} data URL`);
  }
  // Base64 is 4/3 the size of the bytes; reject oversize input before decoding.
  if (value.length - sig.prefix.length > Math.ceil((maxBytes * 4) / 3) + 4) {
    throw new ValidationError(`${label} is too large`);
  }
  const buf = Buffer.from(value.slice(sig.prefix.length), 'base64');
  if (buf.length > maxBytes || !sig.magic.every((b, i) => buf[i] === b)) {
    throw new ValidationError(`${label} is not a valid ${kind.toUpperCase()}`);
  }
  return buf;
}

/** Validates the fields every saved or submitted pumpkin carries. */
export function pumpkinPayload(body) {
  if (!body || typeof body !== 'object') throw new ValidationError('Missing pumpkin');
  return {
    mask: imageDataUrl(body.mask, 'png', MAX_MASK_BYTES, 'Carving mask'),
    thumb: imageDataUrl(body.thumb, 'jpeg', MAX_THUMB_BYTES, 'Thumbnail'),
    candleColor: color(body.candleColor, '#ffb347'),
    skinColor: color(body.skinColor, '#ff7a1a'),
    scene: scene(body.scene),
  };
}
