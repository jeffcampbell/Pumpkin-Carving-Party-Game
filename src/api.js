// REST client for saved pumpkins, plus the browser-side records that make
// "save" work without accounts.

async function request(method, url, body, headers = {}) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'content-type': 'application/json', ...headers } : headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const getPumpkin = (id) => request('GET', `/api/pumpkins/${encodeURIComponent(id)}`);

export const maskUrl = (meta) => `/api/pumpkins/${meta.id}/mask.png?v=${new Date(meta.updatedAt).getTime()}`;
export const thumbUrl = (meta) => `/api/pumpkins/${meta.id}/thumb.jpg?v=${new Date(meta.updatedAt).getTime()}`;
export const shareUrl = (id) => `${location.origin}/p/${id}`;

/** Creates a pumpkin, or overwrites it when this browser holds its edit token. */
export async function savePumpkin(pumpkin, id) {
  const token = id && myPumpkins().find((p) => p.id === id)?.editToken;
  const meta = token
    ? await request('PUT', `/api/pumpkins/${encodeURIComponent(id)}`, pumpkin, { 'x-edit-token': token })
    : await request('POST', '/api/pumpkins', pumpkin);
  rememberPumpkin({ ...meta, editToken: meta.editToken ?? token });
  return meta;
}

// ---- local records --------------------------------------------------------

const MINE_KEY = 'pumpkin:mine';
const DRAFT_KEY = 'pumpkin:draft';

function readJson(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false; // private mode or storage full; saving to the server still works
  }
}

export const myPumpkins = () => readJson(MINE_KEY, []);
export const ownsPumpkin = (id) => myPumpkins().some((p) => p.id === id);

function rememberPumpkin({ id, title, updatedAt, editToken }) {
  const rest = myPumpkins().filter((p) => p.id !== id);
  writeJson(MINE_KEY, [{ id, title, updatedAt, editToken }, ...rest].slice(0, 100));
}

export function forgetPumpkin(id) {
  writeJson(MINE_KEY, myPumpkins().filter((p) => p.id !== id));
}

/** The in-progress pumpkin on the carving page survives reloads. */
export const loadDraft = () => readJson(DRAFT_KEY, null);
export const saveDraft = (draft) => writeJson(DRAFT_KEY, draft);
export const clearDraft = () => localStorage.removeItem(DRAFT_KEY);
