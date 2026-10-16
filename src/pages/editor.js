import { h, toast, copyText } from '../ui/dom.js';
import { createWorkbench } from '../ui/workbench.js';
import { loadImage } from '../pumpkin/mask.js';
import * as api from '../api.js';
import { navigate } from '../router.js';

/** Solo carving page. `/` continues the local draft; `/edit/:id` opens a saved pumpkin. */
export function editorPage(root, { id } = {}) {
  let currentId = null; // set when saving will overwrite an existing pumpkin we own
  let dirty = false;
  let draftTimer;

  const titleInput = h('input.title-input', { type: 'text', maxLength: 60, placeholder: 'Name your pumpkin', oninput: () => markDirty() });
  const saveBtn = h('button.primary', { onclick: () => save() }, 'Save & share');
  const newBtn = h('button.ghost', { onclick: () => startOver() }, 'New pumpkin');
  const shareBox = h('div.share-box', { hidden: true });

  const bench = createWorkbench({
    actions: [titleInput, saveBtn, shareBox, newBtn],
    onEdit: () => markDirty(),
  });
  root.append(bench.el);

  function markDirty() {
    dirty = true;
    shareBox.hidden = true;
    saveBtn.textContent = currentId ? 'Save changes' : 'Save & share';
    clearTimeout(draftTimer);
    draftTimer = setTimeout(storeDraft, 800);
  }

  function storeDraft() {
    api.saveDraft({
      mask: bench.mask.isBlank ? null : bench.mask.toDataURL(),
      candleColor: bench.colors.candle,
      skinColor: bench.colors.skin,
      scene: bench.colors.scene,
      title: titleInput.value,
      id: currentId,
      dirty,
    });
  }

  async function restore() {
    if (id) {
      const draft = api.loadDraft();
      if (draft?.dirty && draft.id !== id && !confirm('Replace the pumpkin you were carving?')) {
        return navigate('/', { replace: true });
      }
      const meta = await api.getPumpkin(id);
      bench.load({ image: await loadImage(api.maskUrl(meta)), candleColor: meta.candleColor, skinColor: meta.skinColor, scene: meta.scene });
      currentId = api.ownsPumpkin(id) ? id : null;
      titleInput.value = currentId ? meta.title : meta.title ? `${meta.title} (remix)`.slice(0, 60) : '';
      if (!currentId) toast("Remixing someone else's pumpkin — saving makes a new copy.");
      dirty = false;
      storeDraft();
    } else {
      const draft = api.loadDraft();
      if (!draft) return;
      const image = draft.mask ? await loadImage(draft.mask) : null;
      bench.load({ image, candleColor: draft.candleColor, skinColor: draft.skinColor, scene: draft.scene });
      currentId = draft.id && api.ownsPumpkin(draft.id) ? draft.id : null;
      titleInput.value = draft.title ?? '';
      dirty = !!draft.dirty;
    }
    saveBtn.textContent = currentId ? 'Save changes' : 'Save & share';
  }

  async function save() {
    if (bench.mask.isBlank && !confirm("You haven't carved anything yet. Save anyway?")) return;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';
    try {
      const meta = await api.savePumpkin({ ...bench.payload(), title: titleInput.value }, currentId);
      currentId = meta.id;
      dirty = false;
      storeDraft();
      showShare(meta.id);
      toast('Saved!');
    } catch (err) {
      toast(err.message, { error: true });
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save changes';
    }
  }

  function showShare(pumpkinId) {
    const url = api.shareUrl(pumpkinId);
    shareBox.replaceChildren(
      h('label', 'Share link'),
      h('input', { type: 'text', readOnly: true, value: url, onfocus: (e) => e.target.select() }),
      h('div.row',
        h('button', { onclick: () => copyText(url) }, 'Copy'),
        navigator.share && h('button', { onclick: () => navigator.share({ title: titleInput.value || 'My jack-o-lantern', url }).catch(() => {}) }, 'Share…'),
        h('a.button', { href: `/p/${pumpkinId}`, 'data-link': true }, 'View'),
      ),
    );
    shareBox.hidden = false;
  }

  function startOver() {
    if (dirty && !bench.mask.isBlank && !confirm('Start a new pumpkin? Unsaved carving will be lost.')) return;
    bench.load();
    clearTimeout(draftTimer);
    api.clearDraft();
    currentId = null;
    dirty = false;
    titleInput.value = '';
    shareBox.hidden = true;
    saveBtn.textContent = 'Save & share';
    if (id) navigate('/');
  }

  restore().catch((err) => toast(err.message, { error: true }));

  return () => {
    clearTimeout(draftTimer);
    if (dirty) storeDraft();
    bench.destroy();
  };
}
