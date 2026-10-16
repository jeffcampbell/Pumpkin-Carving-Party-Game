import { h, toast, copyText } from '../ui/dom.js';
import { CarveMask, loadImage } from '../pumpkin/mask.js';
import { PumpkinStage } from '../pumpkin/stage.js';
import * as api from '../api.js';

/** Read-only page a share link opens: a slowly turning pumpkin plus remix/carve links. */
export function viewerPage(root, { id }) {
  const mask = new CarveMask();
  const stageEl = h('div.stage');
  const title = h('h1.viewer-title', '…');
  const actions = h('div.viewer-actions');
  root.append(h('div.viewer', h('div.stage-wrap', stageEl), h('div.viewer-info', title, actions)));
  const stage = new PumpkinStage(stageEl, mask, { autoRotate: true });

  (async () => {
    try {
      const meta = await api.getPumpkin(id);
      mask.reset(await loadImage(api.maskUrl(meta)));
      stage.setCandleColor(meta.candleColor);
      stage.setSkinColor(meta.skinColor);
      stage.setScene(meta.scene);
      title.textContent = meta.title || 'A jack-o-lantern';
      document.title = `${title.textContent} · Pumpkin Patch`;
      const mine = api.ownsPumpkin(id);
      actions.replaceChildren(
        h('button', { onclick: () => copyText(api.shareUrl(id)) }, 'Copy link'),
        h('a.button', { href: `/edit/${id}`, 'data-link': true }, mine ? 'Edit' : 'Remix'),
        h('a.button.primary', { href: '/', 'data-link': true }, 'Carve your own'),
      );
    } catch (err) {
      title.textContent = 'This pumpkin has gone missing.';
      actions.replaceChildren(h('a.button.primary', { href: '/', 'data-link': true }, 'Carve one'));
      toast(err.message, { error: true });
    }
  })();

  return () => {
    document.title = 'Pumpkin Patch';
    stage.dispose();
    mask.texture.dispose();
  };
}
