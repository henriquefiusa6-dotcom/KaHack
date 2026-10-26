import { state, clipById, clipAtTime, clipDuration, clipEnd, setTime, select, projectDuration, savePoint, emitChange } from './store.js';
import { renderFrame, computeLayout, animValues } from './render.js';
import { mediaById } from './media.js';
import { on } from './bus.js';
import { h, fmtTime, clamp } from './util.js';
import { play, pause, toggle } from './transport.js';
import { setPreviewVolume, resumeAudio } from './audio.js';

let canvas, ctx, stage, frameBox, selBox, timeEl, playBtn, volumeEl;
let dirty = true;
let lastLayout = null;
let selDrag = null;

export function initPreview(container) {
  container.innerHTML = '';
  canvas = h('canvas', { class: 'preview-canvas' });
  ctx = canvas.getContext('2d');
  frameBox = h('div', { class: 'frame-border' });
  selBox = h('div', { class: 'sel-box', style: { display: 'none' } },
    h('div', { class: 'sel-handle br' }),
    h('div', { class: 'sel-tag' }),
  );
  stage = h('div', { class: 'stage' }, canvas, frameBox, selBox);

  playBtn = h('button', { class: 'play-btn', title: 'Reproduzir (espaço)', onclick: () => { resumeAudio(); toggle(); } }, '▶');
  timeEl = h('span', { class: 'pv-time' }, '00:00.0 / 00:00.0');
  volumeEl = h('input', {
    class: 'pv-volume', type: 'range', min: '0', max: '100', value: '100', title: 'Volume da prévia',
    oninput: (e) => { setPreviewVolume(Number(e.target.value) / 100); },
  });

  const bar = h('div', { class: 'preview-bar' },
    h('div', { class: 'pv-left' },
      h('button', { class: 'icon-btn', title: 'Início', onclick: () => setTime(0) }, '⏮'),
      h('button', { class: 'icon-btn', title: 'Quadro anterior', onclick: () => setTime(state.time - 1 / state.project.fps) }, '◀'),
      playBtn,
      h('button', { class: 'icon-btn', title: 'Próximo quadro', onclick: () => setTime(state.time + 1 / state.project.fps) }, '▶'),
      h('button', { class: 'icon-btn', title: 'Fim', onclick: () => setTime(projectDuration()) }, '⏭'),
    ),
    timeEl,
    h('div', { class: 'pv-right' },
      h('span', { class: 'pv-vol-icon' }, '🔊'),
      volumeEl,
      h('button', {
        class: 'icon-btn', title: 'Tela cheia',
        onclick: () => { if (document.fullscreenElement) document.exitFullscreen(); else stage.requestFullscreen?.(); },
      }, '⛶'),
    ),
  );

  container.append(h('div', { class: 'preview-wrap' }, stage, bar));

  stage.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.sel-box')) return;
    select(null);
  });

  bindSelBox();

  const ro = new ResizeObserver(() => { resize(); dirty = true; });
  ro.observe(stage);
  resize();
  requestAnimationFrame(loop);

  on('change', () => { dirty = true; updateSelectionBox(); });
  on('time', () => { dirty = true; updateSelectionBox(); updateTime(); });
  on('selection', () => { updateSelectionBox(); });
  on('playing', ({ playing }) => {
    playBtn.textContent = playing ? '❚❚' : '▶';
    playBtn.classList.toggle('is-playing', playing);
  });
}

function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(160, Math.floor(stage.clientWidth || stage.getBoundingClientRect().width));
  const hh = Math.max(90, Math.floor(stage.clientHeight || stage.getBoundingClientRect().height));
  canvas.style.width = w + 'px';
  canvas.style.height = hh + 'px';
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(hh * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  canvas._css = { w, h: hh, dpr };
  dirty = true;
  updateSelectionBox();
}

function loop() {
  if (dirty || state.playing) {
    dirty = false;
    draw();
  }
  requestAnimationFrame(loop);
}

function draw() {
  const { w, h: hh, dpr = 1 } = canvas._css || { w: 0, h: 0 };
  if (!w || !hh) return;
  const { layout } = renderFrame(ctx, w, hh, state.time, { dpr, outside: '#07090d' });
  lastLayout = layout;
  frameBox.style.left = layout.x + 'px';
  frameBox.style.top = layout.y + 'px';
  frameBox.style.width = layout.w + 'px';
  frameBox.style.height = layout.h + 'px';
}

function updateTime() {
  if (!timeEl) return;
  timeEl.textContent = `${fmtTime(state.time)} / ${fmtTime(projectDuration())}`;
}

/* --------------------------- caixa de seleção ---------------------------- */

function selectedClipInfo() {
  if (!state.selectedId) return null;
  const found = clipById(state.selectedId);
  if (!found) return null;
  const { clip, track } = found;
  if (track.hidden) return null;
  if (state.time < clip.start - 0.001 || state.time >= clipEnd(clip)) return null;
  return { clip, track };
}

function measureText(clip) {
  const cfg = clip.text;
  if (!cfg) return null;
  const fw = state.project.width;
  const fh = state.project.height;
  const c = document.createElement('canvas').getContext('2d');
  c.font = `${cfg.weight || 700} ${cfg.size}px ${cfg.family || 'sans-serif'}`;
  const maxWidth = Math.max(80, (cfg.maxWidth || 0.86) * fw);
  const lines = [];
  for (const para of String(cfg.content || '').split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { lines.push(''); continue; }
    let line = words[0];
    for (let i = 1; i < words.length; i++) {
      const test = line + ' ' + words[i];
      if (c.measureText(test).width <= maxWidth) line = test;
      else { lines.push(line); line = words[i]; }
    }
    lines.push(line);
  }
  const width = Math.max(40, ...lines.map((l) => c.measureText(l).width));
  const height = lines.length * cfg.size * (cfg.lineHeight || 1.2);
  const pad = cfg.bg !== 'transparent' ? cfg.size * (cfg.bgPad ?? 0.35) : 0;
  return {
    w: width + pad * 2,
    h: height + pad * 1.1,
    cx: (cfg.x ?? 0.5) * fw,
    cy: (cfg.y ?? 0.5) * fh,
  };
}

function mediaBox(clip, media) {
  const fw = state.project.width;
  const fh = state.project.height;
  const vw = media.type === 'image' ? media.width : media.width;
  const vh = media.type === 'image' ? media.height : media.height;
  if (!vw || !vh) return { w: fw * 0.6, h: fh * 0.6, cx: fw / 2, cy: fh / 2 };
  let w;
  let h2;
  if (clip.fit === 'contain' || clip.fit === 'original') {
    const k = Math.min(fw / vw, fh / vh);
    w = vw * k;
    h2 = vh * k;
  } else if (clip.fit === 'fill') {
    w = fw;
    h2 = fh;
  } else {
    w = fw;
    h2 = fh;
  }
  const tr = clip.transform || {};
  return { w, h: h2, cx: fw / 2 + (tr.x || 0), cy: fh / 2 + (tr.y || 0) };
}

function updateSelectionBox() {
  if (!selBox) return;
  const info = selectedClipInfo();
  if (!info || !lastLayout) {
    selBox.style.display = 'none';
    return;
  }
  const { clip } = info;
  const media = clip.mediaId ? mediaById(clip.mediaId) : null;
  let box;
  if (clip.type === 'text') box = measureText(clip);
  else if (media) box = mediaBox(clip, media);
  else {
    selBox.style.display = 'none';
    return;
  }
  const scale = lastLayout.scale;
  const tr = clip.transform || {};
  const zoom = tr.scale || 1;
  const screenW = box.w * scale * zoom;
  const screenH = box.h * scale * zoom;
  const screenX = lastLayout.x + box.cx * scale;
  const screenY = lastLayout.y + box.cy * scale;
  selBox.style.display = 'block';
  selBox.style.left = screenX + 'px';
  selBox.style.top = screenY + 'px';
  selBox.style.width = Math.max(24, screenW) + 'px';
  selBox.style.height = Math.max(24, screenH) + 'px';
  selBox.style.transform = `translate(-50%, -50%) rotate(${tr.rotate || 0}deg)`;
  selBox.querySelector('.sel-tag').textContent = clip.type === 'text' ? 'Texto' : clip.name;
}

function bindSelBox() {
  selBox.addEventListener('pointerdown', (e) => {
    if (!state.selectedId) return;
    const found = clipById(state.selectedId);
    if (!found) return;
    const handle = e.target.closest('.sel-handle');
    const { clip } = found;
    const tr = clip.transform || (clip.transform = { x: 0, y: 0, scale: 1, rotate: 0, opacity: 1 });
    savePoint();
    selDrag = {
      mode: handle ? 'scale' : 'move',
      startX: e.clientX,
      startY: e.clientY,
      ox: tr.x || 0,
      oy: tr.y || 0,
      oscale: tr.scale || 1,
      clip,
      scale: lastLayout?.scale || 1,
    };
    e.preventDefault();
    e.stopPropagation();
    selBox.setPointerCapture(e.pointerId);
  });

  selBox.addEventListener('pointermove', (e) => {
    if (!selDrag) return;
    const s = selDrag.scale || 1;
    const dx = (e.clientX - selDrag.startX) / s;
    const dy = (e.clientY - selDrag.startY) / s;
    const tr = selDrag.clip.transform;
    if (selDrag.mode === 'move') {
      if (selDrag.clip.type === 'text') {
        const fw = state.project.width;
        const fh = state.project.height;
        tr.x = selDrag.ox + dx;
        tr.y = selDrag.oy + dy;
        selDrag.clip.text.x = clamp((fw / 2 + tr.x) / fw, 0, 1);
        selDrag.clip.text.y = clamp((fh / 2 + tr.y) / fh, 0, 1);
        tr.x = 0;
        tr.y = 0;
      } else {
        tr.x = selDrag.ox + dx;
        tr.y = selDrag.oy + dy;
      }
    } else {
      const delta = Math.max(dx, dy);
      tr.scale = clamp(selDrag.oscale * (1 + delta / 240), 0.05, 8);
    }
    updateSelectionBox();
    dirty = true;
    emitChange('prop');
  });

  const end = () => {
    if (selDrag) {
      selDrag = null;
      emitChange('structure');
    }
  };
  selBox.addEventListener('pointerup', end);
  selBox.addEventListener('pointercancel', end);
}

export function invalidatePreview() {
  dirty = true;
}
