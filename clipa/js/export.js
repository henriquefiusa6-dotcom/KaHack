import { state, projectDuration } from './store.js';
import { prepareAllElements, waitForReady } from './media.js';
import { getStreamAudioTrack, resumeAudio, suspendPreview } from './audio.js';
import { play, pause } from './transport.js';
import { renderFrame } from './render.js';
import { h, fmtTime, fmtBytes, downloadBlob, safeFilename, clamp } from './util.js';

let overlay, card, summaryEl, optionsEl, progressEl, resultEl, startBtn, cancelBtn;
let exporting = false;
let cancelRequested = false;
let lastBlob = null;
let lastUrl = null;
let resolveClose = null;

export function initExport() {
  summaryEl = h('div', { class: 'export-summary' });
  optionsEl = h('div', { class: 'export-options' });
  progressEl = h('div', { class: 'export-progress', style: { display: 'none' } });
  resultEl = h('div', { class: 'export-result', style: { display: 'none' } });

  startBtn = h('button', { class: 'btn primary', onclick: () => runExport() }, 'Exportar agora');
  cancelBtn = h('button', { class: 'btn ghost', onclick: () => closeModal() }, 'Fechar');

  card = h('div', { class: 'modal-card' },
    h('div', { class: 'modal-head' },
      h('h2', {}, 'Exportar vídeo'),
      h('button', { class: 'icon-btn', title: 'Fechar', onclick: () => closeModal() }, '×'),
    ),
    h('div', { class: 'modal-body' }, summaryEl, optionsEl, progressEl, resultEl),
    h('div', { class: 'modal-foot' }, cancelBtn, startBtn),
  );
  overlay = h('div', { class: 'modal-overlay', style: { display: 'none' }, onclick: (e) => { if (e.target === overlay) closeModal(); } }, card);
  document.body.append(overlay);
}

export function openExport() {
  lastBlob = null;
  resultEl.style.display = 'none';
  if (lastUrl) { URL.revokeObjectURL(lastUrl); lastUrl = null; }
  progressEl.style.display = 'none';
  optionsEl.style.display = '';
  summaryEl.style.display = '';
  startBtn.style.display = '';
  startBtn.disabled = false;
  startBtn.textContent = 'Exportar agora';
  cancelBtn.textContent = 'Fechar';
  overlay.style.display = 'flex';
  renderSummary();
  renderOptions();
}

function closeModal() {
  if (exporting) {
    cancelRequested = true;
    return;
  }
  overlay.style.display = 'none';
  if (resolveClose) { resolveClose(); resolveClose = null; }
  if (lastUrl) { URL.revokeObjectURL(lastUrl); lastUrl = null; }
}

function renderSummary() {
  const p = state.project;
  const dur = projectDuration();
  const clips = state.tracks.reduce((n, t) => n + t.clips.length, 0);
  summaryEl.innerHTML = '';
  summaryEl.append(
    h('div', { class: 'sum-row' }, h('span', {}, 'Duração'), h('strong', {}, fmtTime(dur))),
    h('div', { class: 'sum-row' }, h('span', {}, 'Formato'), h('strong', {}, `${p.width}×${p.height} · ${p.fps} fps`)),
    h('div', { class: 'sum-row' }, h('span', {}, 'Clipes'), h('strong', {}, String(clips))),
  );
  if (dur < 0.2) {
    summaryEl.append(h('p', { class: 'warn-box' }, 'Adicione pelo menos um clipe à linha do tempo para exportar.'));
  } else {
    summaryEl.append(h('p', { class: 'hint-box' },
      'A exportação acontece em tempo real (leva aproximadamente a duração do vídeo) e gera um arquivo WebM com áudio, direto no navegador — nada é enviado para servidores.'));
  }
}

export const QUALITY = {
  alta: { label: 'Alta', bitrate: 9_000_000 },
  media: { label: 'Média', bitrate: 5_000_000 },
  baixa: { label: 'Baixa', bitrate: 2_200_000 },
};

export const RES_OPTIONS = [
  { id: 'orig', label: 'Original', factor: 1 },
  { id: '1080', label: '1080p', maxSide: 1920 },
  { id: '720', label: '720p', maxSide: 1280 },
  { id: '480', label: '480p', maxSide: 854 },
];

let chosen = { res: 'orig', quality: 'alta', fps: 30 };

function renderOptions() {
  optionsEl.innerHTML = '';
  const p = state.project;
  chosen.fps = p.fps;

  const resGroup = h('div', { class: 'opt-group' },
    h('span', { class: 'opt-label' }, 'Resolução'),
    h('div', { class: 'opt-row' }, RES_OPTIONS.map((opt) => h('button', {
      class: `opt-btn ${chosen.res === opt.id ? 'active' : ''}`,
      onclick: (e) => {
        chosen.res = opt.id;
        resGroup.querySelectorAll('.opt-btn').forEach((b) => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
      },
    }, opt.label))),
  );

  const qGroup = h('div', { class: 'opt-group' },
    h('span', { class: 'opt-label' }, 'Qualidade'),
    h('div', { class: 'opt-row' }, Object.entries(QUALITY).map(([key, q]) => h('button', {
      class: `opt-btn ${chosen.quality === key ? 'active' : ''}`,
      onclick: (e) => {
        chosen.quality = key;
        qGroup.querySelectorAll('.opt-btn').forEach((b) => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
      },
    }, q.label))),
  );

  const mime = pickMime();
  const ext = mime.includes('mp4') ? 'MP4' : 'WebM';
  const note = h('p', { class: 'hint-box' }, `Formato do arquivo: ${ext}. O navegador grava localmente enquanto o vídeo é reproduzido.`);

  optionsEl.append(resGroup, qGroup, note);
  if (!mime) {
    optionsEl.append(h('p', { class: 'warn-box' }, 'Seu navegador não suporta gravação de vídeo (MediaRecorder). Use Chrome, Edge ou Firefox atualizado.'));
    startBtn.disabled = true;
  }
}

function pickMime() {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp8',
    'video/webm',
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4',
  ];
  return candidates.find((m) => {
    try { return MediaRecorder.isTypeSupported(m); } catch { return false; }
  }) || '';
}

function computeDims() {
  const p = state.project;
  const opt = RES_OPTIONS.find((o) => o.id === chosen.res) || RES_OPTIONS[0];
  let w = p.width;
  let hh = p.height;
  if (opt.maxSide) {
    const k = Math.min(1, opt.maxSide / Math.max(w, hh));
    w = Math.round(w * k);
    hh = Math.round(hh * k);
  }
  w = Math.max(2, w - (w % 2));
  hh = Math.max(2, hh - (hh % 2));
  return { w, h: hh };
}

function nextFrame() {
  return new Promise((r) => requestAnimationFrame(() => r()));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function runExport() {
  const dur = projectDuration();
  if (dur < 0.2) return;

  exporting = true;
  cancelRequested = false;
  lastBlob = null;
  optionsEl.style.display = 'none';
  summaryEl.style.display = 'none';
  resultEl.style.display = 'none';
  progressEl.style.display = '';
  startBtn.style.display = 'none';
  cancelBtn.textContent = 'Cancelar';

  const { w, h: hh } = computeDims();
  const fps = chosen.fps || state.project.fps;
  progressEl.innerHTML = '';
  const fill = h('div', { class: 'fill' });
  const pct = h('span', { class: 'pct' }, '0%');
  const status = h('span', { class: 'status' }, 'Preparando…');
  const detail = h('span', { class: 'detail' }, `${w}×${hh} · ${fps} fps`);
  progressEl.append(
    h('div', { class: 'progress-head' }, h('strong', {}, 'Renderizando'), pct),
    h('div', { class: 'progress-bar' }, fill),
    h('div', { class: 'progress-meta' }, status, detail),
  );

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = hh;
  const ctx = canvas.getContext('2d', { alpha: false });
  renderFrame(ctx, w, hh, 0);

  const allClips = state.tracks.flatMap((t) => t.clips);
  prepareAllElements(allClips);

  const stream = canvas.captureStream(fps);
  const audioTrack = getStreamAudioTrack();
  if (audioTrack) stream.addTrack(audioTrack);

  const mime = pickMime();
  const bitrate = QUALITY[chosen.quality]?.bitrate || 5_000_000;
  let recorder;
  try {
    recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrate });
  } catch (err) {
    showError('Não foi possível iniciar a gravação: ' + err.message);
    return;
  }

  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const stopPromise = new Promise((resolve) => { recorder.onstop = resolve; });

  resumeAudio();
  suspendPreview(true);
  state.time = 0;
  await waitForReady(allClips, 6000);
  renderFrame(ctx, w, hh, 0);
  await nextFrame();

  recorder.start(150);
  const startedAt = performance.now();
  play();

  let frames = 0;
  while (!cancelRequested) {
    renderFrame(ctx, w, hh, state.time);
    frames++;
    const p = clamp(state.time / dur, 0, 1);
    fill.style.width = `${(p * 100).toFixed(1)}%`;
    pct.textContent = `${Math.round(p * 100)}%`;
    const elapsed = (performance.now() - startedAt) / 1000;
    status.textContent = `${fmtTime(state.time)} de ${fmtTime(dur)} · faltam ${Math.max(0, Math.round(dur - state.time))}s`;
    if (state.time >= dur - 0.01) break;
    await nextFrame();
  }

  const cancelled = cancelRequested;
  pause();
  await sleep(220);
  try { recorder.stop(); } catch {}
  await stopPromise;
  stream.getTracks().forEach((t) => { if (t.kind === 'video') t.stop(); });
  suspendPreview(false);
  exporting = false;
  cancelRequested = false;

  if (cancelled) {
    showCancelled();
    return;
  }

  const blob = new Blob(chunks, { type: mime || 'video/webm' });
  if (!blob.size) {
    showError('A gravação saiu vazia. Tente novamente com outra resolução.');
    return;
  }
  lastBlob = blob;
  fill.style.width = '100%';
  pct.textContent = '100%';
  status.textContent = 'Concluído';
  const filename = `${safeFilename(state.project.name)}.${mime.includes('mp4') ? 'mp4' : 'webm'}`;
  showResult(blob, filename);
  downloadBlob(blob, filename);
}

function showResult(blob, filename) {
  progressEl.style.display = 'none';
  resultEl.style.display = '';
  resultEl.innerHTML = '';
  if (lastUrl) URL.revokeObjectURL(lastUrl);
  lastUrl = URL.createObjectURL(blob);
  resultEl.append(
    h('div', { class: 'result-ok' }, '✔ Vídeo exportado'),
    h('p', { class: 'hint-box' }, `Arquivo: ${filename} · ${fmtBytes(blob.size)}. O download deve ter começado automaticamente.`),
    h('video', { src: lastUrl, controls: true, class: 'result-video' }),
    h('div', { class: 'result-actions' },
      h('button', { class: 'btn primary', onclick: () => downloadBlob(blob, filename) }, 'Baixar novamente'),
      h('button', { class: 'btn ghost', onclick: () => openExport() }, 'Exportar de novo'),
    ),
  );
  cancelBtn.textContent = 'Fechar';
  startBtn.style.display = '';
  startBtn.textContent = 'Exportar novamente';
  startBtn.disabled = false;
}

function showError(message) {
  exporting = false;
  suspendPreview(false);
  progressEl.style.display = 'none';
  optionsEl.style.display = '';
  summaryEl.style.display = '';
  startBtn.style.display = '';
  startBtn.disabled = false;
  cancelBtn.textContent = 'Fechar';
  resultEl.style.display = '';
  resultEl.innerHTML = '';
  resultEl.append(h('p', { class: 'warn-box' }, message));
}

function showCancelled() {
  progressEl.style.display = 'none';
  optionsEl.style.display = '';
  summaryEl.style.display = '';
  startBtn.style.display = '';
  startBtn.disabled = false;
  startBtn.textContent = 'Exportar agora';
  cancelBtn.textContent = 'Fechar';
}
