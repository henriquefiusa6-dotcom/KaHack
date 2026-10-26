import {
  state, select, undo, redo, savePoint, emitChange, projectDuration, setTime,
  setProject, canUndo, canRedo,
} from './store.js';
import { initPreview, invalidatePreview } from './preview.js';
import { initTimeline, doSplit, doDelete, doDuplicate, scrollToPlayhead } from './timeline.js';
import { initPanel } from './panel.js';
import { initAssets, openImport, notify } from './assets.js';
import { initExport, openExport } from './export.js';
import { play, pause, toggle } from './transport.js';
import { resumeAudio, setPreviewVolume } from './audio.js';
import { prepareAllElements, disposeClipElement } from './media.js';
import { on, emit } from './bus.js';
import { h, fmtTime, fmtBytes } from './util.js';

const $ = (sel) => document.querySelector(sel);

function boot() {
  initAssets($('#assets'));
  initPreview($('#preview'));
  initTimeline($('#timeline'));
  initPanel($('#panel'));
  initExport();
  setupTopbar();
  setupShortcuts();
  setupToasts();
  setupDropZone();
  setupEmptyHint();
  setPreviewVolume(state.previewVolume);

  // pré-carrega elementos de mídia dos clipes existentes
  on('change', ({ reason }) => {
    if (reason === 'structure') prepareAllElements(state.tracks.flatMap((t) => t.clips));
    updateEmptyHint();
  });
  on('selection', updateEmptyHint);
  on('clip:removed', ({ id }) => disposeClipElement(id));
  updateEmptyHint();
  updateHistoryButtons();
  on('history', updateHistoryButtons);

  window.addEventListener('beforeunload', (e) => {
    const hasWork = state.tracks.some((t) => t.clips.length);
    if (!hasWork) return;
    e.preventDefault();
    e.returnValue = '';
  });

  // primeiro gesto do usuário destrava o áudio
  const unlock = () => { resumeAudio(); window.removeEventListener('pointerdown', unlock); };
  window.addEventListener('pointerdown', unlock);
}

function setupTopbar() {
  const nameInput = $('#projectName');
  nameInput.value = state.project.name;
  nameInput.addEventListener('change', () => setProject({ name: nameInput.value || 'Meu projeto' }));
  nameInput.addEventListener('focus', () => savePoint());
  on('change', ({ reason }) => {
    if (reason === 'project') nameInput.value = state.project.name;
  });

  $('#undoBtn').addEventListener('click', () => { undo(); updateHistoryButtons(); });
  $('#redoBtn').addEventListener('click', () => { redo(); updateHistoryButtons(); });
  $('#importBtn').addEventListener('click', () => openImport());
  $('#exportBtn').addEventListener('click', () => openExport());
  $('#helpBtn').addEventListener('click', () => openHelp());
}

function updateHistoryButtons() {
  $('#undoBtn').disabled = !canUndoNow();
  $('#redoBtn').disabled = !canRedoNow();
}

const canUndoNow = () => canUndo();
const canRedoNow = () => canRedo();

function setupShortcuts() {
  document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
    const mod = e.ctrlKey || e.metaKey;

    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
      updateHistoryButtons();
      return;
    }
    if (mod && e.key.toLowerCase() === 'y') {
      e.preventDefault();
      redo();
      updateHistoryButtons();
      return;
    }
    if (mod && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      doDuplicate();
      return;
    }
    if (mod && e.key.toLowerCase() === 'e') {
      e.preventDefault();
      openExport();
      return;
    }
    if (mod && e.key.toLowerCase() === 'o') {
      e.preventDefault();
      openImport();
      return;
    }
    if (typing) return;

    if (e.code === 'Space') {
      e.preventDefault();
      resumeAudio();
      toggle();
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      doDelete();
      return;
    }
    if (e.key.toLowerCase() === 's' && !mod) {
      e.preventDefault();
      doSplit();
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const step = (e.shiftKey ? 1 : 1 / state.project.fps) * (e.key === 'ArrowLeft' ? -1 : 1);
      pause();
      setTime(state.time + step);
      scrollToPlayhead();
      return;
    }
    if (e.key === 'Home') {
      e.preventDefault();
      select(null);
      setTime(0);
      return;
    }
    if (e.key === 'End') {
      e.preventDefault();
      setTime(projectDuration());
      return;
    }
    if (e.key === 'Escape') {
      select(null);
      return;
    }
    if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
      openHelp();
    }
  });
}

function setupToasts() {
  const container = $('#toasts');
  on('toast', ({ message, isError }) => {
    const el = h('div', { class: `toast ${isError ? 'error' : ''}` }, message);
    container.append(el);
    setTimeout(() => el.classList.add('in'), 20);
    setTimeout(() => {
      el.classList.remove('in');
      setTimeout(() => el.remove(), 300);
    }, 3200);
  });
}

function setupDropZone() {
  const overlayDrag = h('div', { class: 'global-drop', style: { display: 'none' } },
    h('div', { class: 'global-drop-card' }, h('div', { class: 'dz-icon' }, '⬆'), h('p', {}, 'Solte para importar arquivos')),
  );
  document.body.append(overlayDrag);
  let depth = 0;

  window.addEventListener('dragenter', (e) => {
    if (![...e.dataTransfer.types].includes('Files')) return;
    depth++;
    overlayDrag.style.display = 'flex';
  });
  window.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (!depth) overlayDrag.style.display = 'none';
  });
  window.addEventListener('dragover', (e) => {
    if ([...e.dataTransfer.types].includes('Files')) e.preventDefault();
  });
  window.addEventListener('drop', async (e) => {
    if (![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    depth = 0;
    overlayDrag.style.display = 'none';
    if (e.defaultPrevented) return;
    if (e.target.closest('.dropzone')) return;
    const files = e.dataTransfer.files;
    if (!files || !files.length) return;
    const { importFiles } = await import('./media.js');
    const { makeClip, addClip } = await import('./store.js');
    const created = await importFiles(files, () => {});
    const ok = created.filter((c) => !c.error);
    const errs = created.filter((c) => c.error);
    if (ok.length) {
      for (const media of ok) {
        const trackId = media.type === 'audio' ? 'audio' : 'main';
        const track = state.tracks.find((t) => t.id === trackId) || state.tracks[0];
        if (!track) continue;
        const clip = makeClip(media, media.type);
        clip.name = media.name;
        addClip(track.id, clip, projectDuration());
      }
      notify(`${ok.length} mídia(s) importada(s) e adicionada(s) à linha do tempo.`);
      emit('media');
      emitChange('structure');
    }
    if (errs.length) notify(`Não foi possível importar: ${errs.map((x) => x.name).join(', ')}.`, true);
  });
}

function setupEmptyHint() {
  const wrap = document.querySelector('.preview-wrap');
  if (!wrap) return;
  const hint = h('div', { class: 'empty-hint' },
    h('div', { class: 'hint-logo' }, '◆'),
    h('h2', {}, 'Comece seu vídeo'),
    h('p', {}, 'Importe vídeos, fotos e músicas — ou arraste arquivos para qualquer lugar da janela.'),
    h('button', { class: 'btn primary', onclick: () => openImport() }, 'Importar mídia'),
  );
  wrap.append(hint);
  wrap._hint = hint;
}

function updateEmptyHint() {
  const wrap = document.querySelector('.preview-wrap');
  const hint = wrap?._hint;
  if (!hint) return;
  const empty = !state.tracks.some((t) => t.clips.length);
  hint.style.display = empty ? 'flex' : 'none';
}

function openHelp() {
  const rows = [
    ['Espaço', 'Reproduzir ou pausar'],
    ['S', 'Dividir o clipe no cursor'],
    ['Ctrl + D', 'Duplicar clipe selecionado'],
    ['Delete', 'Excluir clipe selecionado'],
    ['Ctrl + Z', 'Desfazer'],
    ['Ctrl + Shift + Z', 'Refazer'],
    ['← →', 'Andar um quadro'],
    ['Shift + ← →', 'Andar um segundo'],
    ['Ctrl + Scroll', 'Zoom na linha do tempo'],
    ['Ctrl + O', 'Importar mídia'],
    ['Ctrl + E', 'Exportar vídeo'],
    ['Esc', 'Cancelar seleção'],
  ];
  const overlay = h('div', { class: 'modal-overlay', onclick: (e) => { if (e.target === overlay) overlay.remove(); } },
    h('div', { class: 'modal-card help-card' },
      h('div', { class: 'modal-head' },
        h('h2', {}, 'Como usar o Clipa'),
        h('button', { class: 'icon-btn', onclick: () => overlay.remove() }, '×'),
      ),
      h('div', { class: 'modal-body' },
        h('ol', { class: 'help-steps' },
          h('li', {}, h('strong', {}, 'Importe seu material'), ' na aba Mídia ou arraste arquivos para a janela.'),
          h('li', {}, h('strong', {}, 'Arraste para a linha do tempo'), ' — clipes de vídeo e imagem vão para a faixa principal, áudios para a faixa de áudio.'),
          h('li', {}, h('strong', {}, 'Ajuste'), ' corte, velocidade, filtros, animações e textos no painel à direita.'),
          h('li', {}, h('strong', {}, 'Exporte'), ' clicando em Exportar. A gravação roda no seu navegador, em tempo real.'),
        ),
        h('div', { class: 'shortcuts' }, rows.map(([k, v]) => h('div', { class: 'shortcut' }, h('kbd', {}, k), h('span', {}, v)))),
        h('p', { class: 'hint-box' }, 'Dica: selecione um clipe e use os controles sobre o vídeo para mover e redimensionar; tudo fica salvo enquanto a aba estiver aberta.'),
      ),
    ),
  );
  document.body.append(overlay);
}

boot();
