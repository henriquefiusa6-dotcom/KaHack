import { mediaStore, importFiles, removeMedia, isSupported } from './media.js';
import {
  state, makeClip, addClip, clipById, savePoint, emitChange, removeClip,
} from './store.js';
import { FILTER_PRESETS } from './render.js';
import { on, emit } from './bus.js';
import { h, fmtDur, fmtBytes } from './util.js';

let rootEl, listEl, importInput, dropEl, countEl, progressEl;
let filterType = 'all';
let activeTab = 'media';

const TEXT_PRESETS = [
  {
    id: 'titulo', label: 'Título', sample: 'Título',
    text: { content: 'Seu título', size: 96, weight: 900, color: '#ffffff', bg: 'transparent', shadow: true, stroke: 0, y: 0.5, animIn: 'pop' },
  },
  {
    id: 'subtitulo', label: 'Subtítulo', sample: 'Subtítulo',
    text: { content: 'Um subtítulo explicativo', size: 48, weight: 600, color: '#f4f4f5', bg: 'transparent', shadow: true, y: 0.68, animIn: 'fadeUp' },
  },
  {
    id: 'legenda', label: 'Legenda', sample: 'Legenda',
    text: { content: 'Sua legenda aqui', size: 44, weight: 700, color: '#0b0b0f', bg: '#ffffff', bgPad: 0.4, radius: 14, shadow: false, y: 0.82, maxWidth: 0.8, animIn: 'fadeUp' },
  },
  {
    id: 'caixa', label: 'Caixa colorida', sample: 'Destaque',
    text: { content: 'DESTAQUE', size: 62, weight: 900, color: '#ffffff', bg: '#7c5cff', bgPad: 0.5, radius: 20, shadow: true, y: 0.5, animIn: 'zoomIn' },
  },
  {
    id: 'contorno', label: 'Contornado', sample: 'Contorno',
    text: { content: 'TEXTO VAZADO', size: 88, weight: 900, color: 'transparent', stroke: 3, strokeColor: '#ffffff', shadow: false, bg: 'transparent', y: 0.5, animIn: 'fade' },
  },
  {
    id: 'creditos', label: 'Créditos', sample: 'Créditos',
    text: { content: 'Criado por você\n@seuperfil', size: 40, weight: 500, color: '#d4d4d8', bg: 'transparent', shadow: true, y: 0.9, lineHeight: 1.4, animIn: 'fade' },
  },
  {
    id: 'lower', label: 'Lower third', sample: 'Nome',
    text: { content: 'Nome\nCargo ou função', size: 46, weight: 700, color: '#ffffff', bg: 'rgba(10,10,15,0.75)', bgPad: 0.45, radius: 12, shadow: false, x: 0.24, y: 0.8, maxWidth: 0.4, animIn: 'slideRight' },
  },
  {
    id: 'ticker', label: 'Chamada', sample: 'Chamada',
    text: { content: 'Inscreva-se no canal!', size: 40, weight: 800, color: '#111', bg: '#ffd60a', bgPad: 0.45, radius: 999, shadow: false, y: 0.1, animIn: 'fadeDown' },
  },
];

export function initAssets(container) {
  rootEl = container;
  rootEl.innerHTML = '';
  const rail = h('div', { class: 'rail' },
    railBtn('media', '▦', 'Mídia'),
    railBtn('text', 'T', 'Texto'),
    railBtn('effects', '✦', 'Efeitos'),
  );
  const body = h('div', { class: 'assets-body' });
  rootEl.append(rail, body);
  rootEl._body = body;
  renderTab();
  on('media', () => renderTab());
  on('selection', () => { if (activeTab === 'effects') renderTab(); });
}

function railBtn(tab, icon, label) {
  return h('button', {
    class: `rail-btn ${activeTab === tab ? 'active' : ''}`, dataset: { tab },
    onclick: () => { activeTab = tab; updateRail(); renderTab(); },
  }, h('span', { class: 'rail-icon' }, icon), h('span', { class: 'rail-label' }, label));
}

function updateRail() {
  rootEl.querySelectorAll('.rail-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === activeTab));
}

function renderTab() {
  const body = rootEl._body;
  if (!body) return;
  body.innerHTML = '';
  if (activeTab === 'media') body.append(...buildMediaTab());
  else if (activeTab === 'text') body.append(...buildTextTab());
  else body.append(...buildEffectsTab());
}

/* --------------------------------- mídia ---------------------------------- */

function buildMediaTab() {
  importInput = h('input', {
    type: 'file', multiple: true, accept: 'video/*,audio/*,image/*', style: { display: 'none' },
    onchange: (e) => { handleFiles(e.target.files); e.target.value = ''; },
  });

  const importBtn = h('button', {
    class: 'btn primary full', onclick: () => importInput.click(),
  }, '＋ Importar mídia');

  dropEl = h('div', {
    class: 'dropzone',
    ondragover: (e) => { e.preventDefault(); dropEl.classList.add('over'); },
    ondragleave: () => dropEl.classList.remove('over'),
    ondrop: (e) => { e.preventDefault(); dropEl.classList.remove('over'); handleFiles(e.dataTransfer.files); },
  }, dropElContent());

  progressEl = h('div', { class: 'import-progress', style: { display: 'none' } },
    h('div', { class: 'bar' }, h('div', { class: 'fill' })),
    h('span', { class: 'txt' }, ''),
  );

  countEl = h('span', { class: 'muted' }, `${mediaStore.size} item(ns)`);

  const filterBar = h('div', { class: 'seg' },
    [['all', 'Tudo'], ['video', 'Vídeos'], ['image', 'Imagens'], ['audio', 'Áudios']].map(([k, label]) => h('button', {
      class: `seg-btn ${filterType === k ? 'active' : ''}`,
      onclick: (e) => {
        filterType = k;
        filterBar.querySelectorAll('.seg-btn').forEach((b) => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        renderList();
      },
    }, label)),
  );

  listEl = h('div', { class: 'media-grid' });

  const wrap = h('div', { class: 'assets-inner' },
    h('div', { class: 'assets-head' },
      h('h3', {}, 'Biblioteca'),
      countEl,
    ),
    importBtn,
    importInput,
    dropEl,
    progressEl,
    filterBar,
    listEl,
  );
  setTimeout(renderList, 0);
  return [wrap];
}

function dropElContent() {
  return [
    h('div', { class: 'dz-icon' }, '⬆'),
    h('div', { class: 'dz-title' }, 'Arraste arquivos aqui'),
    h('div', { class: 'dz-sub' }, 'MP4, WebM, MOV, MP3, WAV, JPG, PNG, GIF'),
  ];
}

async function handleFiles(fileList) {
  if (!fileList || !fileList.length) return;
  const files = [...fileList];
  const supported = files.filter(isSupported);
  if (!supported.length) {
    notify('Nenhum arquivo suportado selecionado.');
    return;
  }
  progressEl.style.display = 'flex';
  const created = await importFiles(supported, (i, total, name) => {
    progressEl.querySelector('.fill').style.width = `${Math.round((i / total) * 100)}%`;
    progressEl.querySelector('.txt').textContent = `Importando ${i + 1}/${total}: ${name}`;
  });
  progressEl.querySelector('.fill').style.width = '100%';
  progressEl.querySelector('.txt').textContent = 'Concluído';
  setTimeout(() => { progressEl.style.display = 'none'; progressEl.querySelector('.fill').style.width = '0%'; }, 900);

  const errors = created.filter((c) => c.error);
  const okCount = created.length - errors.length;
  if (okCount) notify(`${okCount} mídia(s) importada(s).`);
  if (errors.length) notify(`Falha ao importar: ${errors.map((e) => e.name).join(', ')}`, true);

  if (okCount) {
    const first = created.find((c) => !c.error);
    if (first) addMediaToTimeline(first, false);
  }
  emit('media');
  emitChange('structure');
  renderTab();
}

function addMediaToTimeline(media, withAlert = true) {
  const trackId = media.type === 'audio' ? 'audio' : 'main';
  const track = state.tracks.find((t) => t.id === trackId) || state.tracks[0];
  if (!track) return;
  const clip = makeClip(media, media.type);
  clip.name = media.name;
  const created = addClip(track.id, clip, state.time);
  if (created && withAlert) notify(`"${media.name}" adicionado à linha do tempo.`);
}

function renderList() {
  if (!listEl) return;
  listEl.innerHTML = '';
  countEl.textContent = `${mediaStore.size} item(ns)`;
  const items = [...mediaStore.values()].filter((m) => filterType === 'all' || m.type === filterType);
  if (!items.length) {
    listEl.append(h('div', { class: 'empty-state' },
      h('div', { class: 'empty-icon' }, '🎬'),
      h('p', {}, mediaStore.size ? 'Nenhuma mídia desse tipo.' : 'Sua biblioteca está vazia.'),
      h('small', {}, 'Importe arquivos do computador para começar.'),
    ));
    return;
  }
  for (const media of items) listEl.append(mediaCard(media));
}

function mediaCard(media) {
  const isAudio = media.type === 'audio';
  const thumb = media.thumb
    ? h('img', { src: media.thumb, alt: media.name, loading: 'lazy' })
    : h('div', { class: `thumb-fallback ${isAudio ? 'audio' : ''}` }, isAudio ? '♫' : '🎬');
  const badge = { video: 'Vídeo', image: 'Imagem', audio: 'Áudio' }[media.type] || '';

  const card = h('div', {
    class: 'media-card', draggable: 'true', title: `${media.name} — clique para adicionar`,
    ondragstart: (e) => {
      e.dataTransfer.setData('text/plain', media.id);
      e.dataTransfer.effectAllowed = 'copy';
      card.classList.add('dragging');
    },
    ondragend: () => card.classList.remove('dragging'),
    onclick: () => { addMediaToTimeline(media); },
  },
    h('div', { class: 'media-thumb' }, thumb,
      h('span', { class: `type-badge ${media.type}` }, badge),
      media.duration ? h('span', { class: 'dur-badge' }, fmtDur(media.duration)) : null,
    ),
    h('div', { class: 'media-meta' },
      h('span', { class: 'media-name' }, media.name),
      h('span', { class: 'media-sub' }, `${fmtBytes(media.size)}${media.width ? ` · ${media.width}×${media.height}` : ''}`),
    ),
    h('button', {
      class: 'media-del', title: 'Remover da biblioteca',
      onclick: (e) => {
        e.stopPropagation();
        const usedClips = state.tracks.flatMap((t) => t.clips.filter((c) => c.mediaId === media.id));
        if (usedClips.length && !confirm(`Essa mídia aparece em ${usedClips.length} clipe(s). Remover a mídia e os clipes?`)) return;
        if (usedClips.length) {
          savePoint();
          for (const clip of usedClips) removeClip(clip.id);
        }
        removeMedia(media.id);
        emit('media');
        emitChange('structure');
        renderTab();
        notify(`"${media.name}" removido da biblioteca.`);
      },
    }, '×'),
  );
  return card;
}

/* ---------------------------------- texto --------------------------------- */

function buildTextTab() {
  const grid = h('div', { class: 'preset-grid' }, TEXT_PRESETS.map((preset) => h('button', {
    class: 'preset-card', onclick: () => addTextPreset(preset),
  },
    h('span', { class: 'preset-preview', style: { fontWeight: preset.text.weight, color: preset.text.color === 'transparent' ? 'transparent' : preset.text.color, WebkitTextStroke: preset.text.stroke ? `${preset.text.stroke}px ${preset.text.strokeColor}` : '0', background: preset.text.bg !== 'transparent' ? preset.text.bg : 'transparent', borderRadius: (preset.text.radius || 0) + 'px' } }, preset.sample),
    h('span', { class: 'preset-label' }, preset.label),
  )));
  return [h('div', { class: 'assets-inner' },
    h('div', { class: 'assets-head' }, h('h3', {}, 'Texto'), h('span', { class: 'muted' }, `${TEXT_PRESETS.length} modelos`)),
    h('p', { class: 'assets-hint' }, 'Clique em um modelo para inserir no ponto atual da linha do tempo.'),
    grid,
  )];
}

function addTextPreset(preset) {
  const track = state.tracks.find((t) => t.type === 'text');
  if (!track) return;
  savePoint();
  const clip = makeClip({ name: preset.label }, 'text');
  clip.name = preset.label;
  Object.assign(clip.text, preset.text);
  clip.text.animIn = preset.text.animIn || 'fadeUp';
  clip.start = state.time;
  const created = addClip(track.id, clip, state.time);
  if (created) {
    notify(`Texto "${preset.label}" inserido. Edite no painel à direita.`);
    emitChange('structure');
  }
}

/* --------------------------------- efeitos -------------------------------- */

function buildEffectsTab() {
  const selected = state.selectedId ? clipById(state.selectedId)?.clip : null;
  const grid = h('div', { class: 'fx-grid' }, Object.entries(FILTER_PRESETS).map(([key, preset]) => h('button', {
    class: `fx-card ${selected?.filter === key ? 'active' : ''}`,
    onclick: () => {
      if (!selected) { notify('Selecione um clipe de vídeo ou imagem primeiro.'); return; }
      savePoint();
      selected.filter = key;
      emitChange('prop');
      renderTab();
    },
  },
    h('span', { class: 'fx-swatch', style: { filter: preset.css || 'none' } }),
    h('span', { class: 'fx-label' }, preset.label),
  )));

  return [h('div', { class: 'assets-inner' },
    h('div', { class: 'assets-head' }, h('h3', {}, 'Efeitos e filtros'),
      h('span', { class: 'muted' }, selected ? selected.name : 'nenhum clipe selecionado')),
    h('p', { class: 'assets-hint' }, 'Aplique um filtro de cor ao clipe selecionado. Ajustes finos ficam no painel à direita.'),
    grid,
  )];
}

/* --------------------------------- avisos --------------------------------- */

export function openImport() {
  activeTab = 'media';
  updateRail();
  renderTab();
  setTimeout(() => importInput?.click(), 60);
}

export function notify(message, isError = false) {
  emit('toast', { message, isError });
}
