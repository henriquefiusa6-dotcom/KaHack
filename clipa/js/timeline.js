import {
  state, clipById, clipDuration, clipEnd, projectDuration, setTime, select, savePoint,
  moveClipWithinTrack, splitClip, removeClip, duplicateClip, addTrack, removeTrack,
  sortClips, makeClip, addClip, emitChange,
} from './store.js';
import { mediaById, mediaStore } from './media.js';
import { on, emit } from './bus.js';
import { h, fmtTime, fmtDur, clamp, uid } from './util.js';

const HEAD_W = 146;
const RULER_H = 30;
const ROW_H = 62;
const MIN_LEN = 0.12;

let root, scrollEl, contentEl, rulerCanvas, rulerHead, rowsEl, playheadEl, timeLabel, snapInput, zoomInput;
const nodes = new Map();      // clipId -> element
const rowNodes = new Map();   // trackId -> row element
let drag = null;

const KIND = { text: 'text', audio: 'audio', video: 'visual', image: 'visual' };
const kindOfTrack = (track) => (track.type === 'audio' ? 'audio' : track.type === 'text' ? 'text' : 'visual');
const kindOfClip = (clip) => KIND[clip.type] || 'visual';

export function initTimeline(container) {
  root = container;
  root.innerHTML = '';
  root.append(buildToolbar(), buildBody());
  bindEvents();
  render();
}

function buildToolbar() {
  timeLabel = h('span', { class: 'tl-time' }, '00:00.0 / 00:00.0');
  snapInput = h('input', { type: 'checkbox', checked: state.snap, onchange: (e) => { state.snap = e.target.checked; } });
  zoomInput = h('input', {
    class: 'zoom-range', type: 'range', min: '18', max: '260', step: '1', value: String(state.zoom),
    oninput: (e) => { state.zoom = Number(e.target.value); render(); },
  });

  return h('div', { class: 'tl-toolbar' },
    h('div', { class: 'tl-tools' },
      h('button', { class: 'tl-btn', title: 'Dividir no cursor (S)', onclick: () => doSplit() }, '✂', h('span', {}, 'Dividir')),
      h('button', { class: 'tl-btn', title: 'Duplicar (Ctrl+D)', onclick: () => doDuplicate() }, '⧉', h('span', {}, 'Duplicar')),
      h('button', { class: 'tl-btn', title: 'Excluir (Delete)', onclick: () => doDelete() }, '🗑', h('span', {}, 'Excluir')),
      h('button', { class: 'tl-btn', title: 'Nova faixa de sobreposição', onclick: () => { addTrack('overlay'); } }, '＋', h('span', {}, 'Faixa')),
    ),
    h('div', { class: 'tl-right' },
      timeLabel,
      h('label', { class: 'tl-check', title: 'Encaixar nas bordas' }, snapInput, 'Ímã'),
      h('div', { class: 'tl-zoom' },
        h('button', { class: 'icon-btn', onclick: () => { state.zoom = clamp(state.zoom * 0.8, 18, 260); zoomInput.value = String(state.zoom); render(); } }, '−'),
        zoomInput,
        h('button', { class: 'icon-btn', onclick: () => { state.zoom = clamp(state.zoom * 1.25, 18, 260); zoomInput.value = String(state.zoom); render(); } }, '+'),
      ),
    ),
  );
}

function buildBody() {
  rulerCanvas = h('canvas', { class: 'ruler-canvas' });
  rulerHead = h('div', { class: 'ruler-head', style: { width: HEAD_W + 'px' } },
    h('span', {}, 'Faixas'),
    h('button', { class: 'mini-btn', title: 'Adicionar faixa', onclick: () => addTrack('overlay') }, '+'),
  );
  const rulerRow = h('div', { class: 'ruler-row', style: { height: RULER_H + 'px' } }, rulerHead, h('div', { class: 'ruler', style: { height: RULER_H + 'px' } }, rulerCanvas));
  rowsEl = h('div', { class: 'rows' });
  playheadEl = h('div', { class: 'playhead', style: { top: 0 } }, h('div', { class: 'playhead-cap' }));
  contentEl = h('div', { class: 'tl-content' }, rulerRow, rowsEl, playheadEl);
  scrollEl = h('div', { class: 'tl-scroll' }, contentEl);
  return h('div', { class: 'tl-body' }, scrollEl);
}

/* ------------------------------- renderização ------------------------------ */

function render() {
  if (!contentEl) return;
  renderRuler();
  renderRows();
  layoutPlayhead();
  updateTimeLabel();
}

function contentWidth() {
  const dur = Math.max(projectDuration() + 6, 30);
  return Math.max(640, HEAD_W + dur * state.zoom);
}

function niceStep() {
  const steps = [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  const minPx = 76;
  return steps.find((s) => s * state.zoom >= minPx) || 600;
}

function renderRuler() {
  const width = contentWidth() - HEAD_W;
  const key = `${Math.round(width)}:${state.zoom}`;
  if (key === rulerKey && rulerCanvas.width) {
    contentEl.style.width = contentWidth() + 'px';
    return;
  }
  rulerKey = key;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  rulerCanvas.style.width = width + 'px';
  rulerCanvas.style.height = RULER_H + 'px';
  rulerCanvas.width = Math.floor(width * dpr);
  rulerCanvas.height = Math.floor(RULER_H * dpr);
  const ctx = rulerCanvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, RULER_H);
  ctx.fillStyle = '#12151b';
  ctx.fillRect(0, 0, width, RULER_H);

  const step = niceStep();
  const sub = step / 5;
  ctx.font = '11px system-ui, sans-serif';
  ctx.textBaseline = 'middle';

  const startT = 0;
  const endT = width / state.zoom;
  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.beginPath();
  for (let t = startT; t <= endT; t += sub) {
    const x = Math.round(t * state.zoom) + 0.5;
    ctx.moveTo(x, RULER_H - 6);
    ctx.lineTo(x, RULER_H);
  }
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255,255,255,0.22)';
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath();
  for (let t = startT; t <= endT; t += step) {
    const x = Math.round(t * state.zoom) + 0.5;
    ctx.moveTo(x, RULER_H - 12);
    ctx.lineTo(x, RULER_H);
    ctx.fillText(fmtTime(t, false) + (t > 0 ? '' : ''), x + 4, 11);
  }
  ctx.stroke();
  contentEl.style.width = contentWidth() + 'px';
}

function renderRows() {
  const seenTracks = new Set();
  state.tracks.forEach((track, index) => {
    seenTracks.add(track.id);
    let row = rowNodes.get(track.id);
    if (!row) {
      row = buildRow(track);
      rowNodes.set(track.id, row);
    }
    row.trackEl = track;
    row.head.querySelector('.trk-name').textContent = track.name;
    row.head.querySelector('.trk-icon').textContent = track.icon || '▣';
    row.head.querySelector('.btn-hide').classList.toggle('active', !track.hidden);
    row.head.querySelector('.btn-mute').classList.toggle('active', !track.muted);
    row.head.querySelector('.btn-remove').style.visibility = track.type === 'overlay' ? 'visible' : 'hidden';
    row.lane.dataset.trackId = track.id;
    if (rowsEl.children[index] !== row.el) rowsEl.insertBefore(row.el, rowsEl.children[index] || null);
  });

  for (const [id, row] of rowNodes) {
    if (seenTracks.has(id)) continue;
    row.el.remove();
    rowNodes.delete(id);
  }

  // clipes
  const seenClips = new Set();
  for (const track of state.tracks) {
    const row = rowNodes.get(track.id);
    for (const clip of track.clips) {
      seenClips.add(clip.id);
      let node = nodes.get(clip.id);
      if (!node) {
        node = buildClipNode(clip, track);
        nodes.set(clip.id, node);
      }
      updateClipNode(node, clip, track);
      if (node.parentElement !== row.lane) row.lane.append(node);
    }
  }
  for (const [id, node] of nodes) {
    if (seenClips.has(id)) continue;
    node.remove();
    nodes.delete(id);
  }
}

function buildRow(track) {
  const name = h('span', { class: 'trk-name' }, track.name);
  const icon = h('span', { class: 'trk-icon' }, track.icon || '▣');
  const btnHide = h('button', {
    class: 'mini-btn btn-hide active', title: 'Mostrar/ocultar faixa',
    onclick: (e) => { e.stopPropagation(); track.hidden = !track.hidden; emitChange('view'); },
  }, '👁');
  const btnMute = h('button', {
    class: 'mini-btn btn-mute active', title: 'Silenciar faixa',
    onclick: (e) => { e.stopPropagation(); track.muted = !track.muted; emitChange('view'); },
  }, '🔊');
  const btnRemove = h('button', {
    class: 'mini-btn btn-remove', title: 'Remover faixa', style: { visibility: 'hidden' },
    onclick: (e) => { e.stopPropagation(); removeTrack(track.id); },
  }, '×');
  const head = h('div', { class: 'trk-head', style: { width: HEAD_W + 'px', height: ROW_H + 'px' } },
    h('div', { class: 'trk-title' }, icon, name),
    h('div', { class: 'trk-btns' }, btnHide, btnMute, btnRemove),
  );
  const lane = h('div', { class: 'lane', style: { height: ROW_H + 'px' }, dataset: { trackId: track.id } });
  const el = h('div', { class: 'trk', dataset: { trackId: track.id } }, head, lane);
  return { el, head, lane };
}

function waveUrlFor(media) {
  if (!media) return null;
  if (media.waveUrl) return media.waveUrl;
  const peaks = media.peaks;
  const W = 1200;
  const H = 120;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = 'rgba(120, 235, 214, 0.85)';
  const list = peaks && peaks.length ? peaks : new Array(200).fill(0.25);
  const bw = W / list.length;
  for (let i = 0; i < list.length; i++) {
    const amp = Math.max(0.04, list[i]) * (H * 0.45);
    const x = i * bw;
    ctx.fillRect(x, H / 2 - amp, Math.max(1, bw - 0.6), amp * 2);
  }
  media.waveUrl = c.toDataURL('image/png');
  return media.waveUrl;
}

function buildClipNode(clip, track) {
  const label = h('div', { class: 'clip-label' });
  const body = h('div', { class: 'clip-body' });
  const node = h('div', {
    class: `clip clip--${clip.type}`,
    dataset: { id: clip.id },
  },
    body,
    label,
    h('div', { class: 'clip-handle l', dataset: { side: 'l' } }),
    h('div', { class: 'clip-handle r', dataset: { side: 'r' } }),
  );
  node._body = body;
  node._label = label;
  node._kind = null;
  return node;
}

function updateClipNode(node, clip, track) {
  const dur = clipDuration(clip);
  node.style.left = clip.start * state.zoom + 'px';
  node.style.width = Math.max(8, dur * state.zoom) + 'px';
  node.classList.toggle('is-selected', state.selectedId === clip.id);
  node.classList.toggle('is-text', clip.type === 'text');
  node.classList.toggle('is-audio', clip.type === 'audio');
  node.classList.toggle('is-image', clip.type === 'image');
  node.style.setProperty('--clip-h', ROW_H - 10 + 'px');

  const media = clip.mediaId ? mediaById(clip.mediaId) : null;
  if (clip.type === 'audio') {
    const wave = media ? waveUrlFor(media) : null;
    node._body.style.backgroundImage = wave ? `url("${wave}")` : 'none';
  } else if (clip.type === 'video' && media?.thumb) {
    node._body.style.backgroundImage = `url("${media.thumb}")`;
    node._body.style.backgroundSize = `auto 100%`;
    node._body.style.backgroundRepeat = 'repeat-x';
  } else if (clip.type === 'image' && media) {
    node._body.style.backgroundImage = `url("${media.url}")`;
    node._body.style.backgroundSize = 'cover';
    node._body.style.backgroundRepeat = 'no-repeat';
  } else {
    node._body.style.backgroundImage = 'none';
  }

  const speed = clip.speed && clip.speed !== 1 ? ` · ${clip.speed}×` : '';
  node._label.textContent = `${clip.name}${speed}`;
  node.title = `${clip.name}\n${fmtDur(dur)}`;
}

function layoutPlayhead() {
  const x = HEAD_W + state.time * state.zoom;
  playheadEl.style.transform = `translateX(${x}px)`;
  const rowsH = rowsEl ? (rowsEl.offsetHeight || rowsEl.children.length * ROW_H) : 0;
  playheadEl.style.height = RULER_H + rowsH + 'px';
}

function updateTimeLabel() {
  if (!timeLabel) return;
  const dur = projectDuration();
  timeLabel.textContent = `${fmtTime(state.time)} / ${fmtTime(dur)}`;
}

/* -------------------------------- interação -------------------------------- */

function timeFromClientX(clientX) {
  const rect = contentEl.getBoundingClientRect();
  return Math.max(0, (clientX - rect.left - HEAD_W) / state.zoom);
}

function snapPoints(excludeId) {
  const pts = [0, state.time];
  for (const track of state.tracks) {
    for (const c of track.clips) {
      if (c.id === excludeId) continue;
      pts.push(c.start, clipEnd(c));
    }
  }
  return pts;
}

function snapTime(value, points) {
  if (!state.snap) return value;
  const thr = 8 / state.zoom;
  let best = value;
  let dist = thr;
  for (const p of points) {
    const d = Math.abs(p - value);
    if (d < dist) { dist = d; best = p; }
  }
  return best;
}

function bindEvents() {
  scrollEl.addEventListener('pointerdown', onPointerDown);
  scrollEl.addEventListener('click', (e) => {
    if (drag && drag.moved) return;
    if (e.target.closest('.clip') || e.target.closest('.trk-head')) return;
    if (e.target.closest('.lane') || e.target.closest('.ruler') || e.target.closest('.ruler-canvas')) {
      select(null);
    }
  });
  scrollEl.addEventListener('wheel', onWheel, { passive: false });
  scrollEl.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes('text/plain')) return;
    const lane = e.target.closest('.lane');
    if (!lane) return;
    e.preventDefault();
    lane.classList.add('drop-target');
  });
  scrollEl.addEventListener('dragleave', (e) => {
    e.target.closest('.lane')?.classList.remove('drop-target');
  });
  scrollEl.addEventListener('drop', (e) => {
    const lane = e.target.closest('.lane');
    if (!lane) return;
    lane.classList.remove('drop-target');
    const mediaId = e.dataTransfer.getData('text/plain');
    const media = mediaStore.get(mediaId);
    if (!media) return;
    e.preventDefault();
    const track = state.tracks.find((t) => t.id === lane.dataset.trackId);
    if (!track) return;
    if (kindOfTrack(track) !== KIND[media.type]) {
      flashLane(lane);
      return;
    }
    const clip = makeClip(media, media.type);
    addClip(track.id, clip, snapTime(timeFromClientX(e.clientX), snapPoints()));
  });
}

function flashLane(lane) {
  lane.classList.add('lane-error');
  setTimeout(() => lane.classList.remove('lane-error'), 400);
}

function onWheel(e) {
  if (e.ctrlKey || e.metaKey) {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    state.zoom = clamp(state.zoom * factor, 18, 260);
    zoomInput.value = String(state.zoom);
    render();
  }
}

function onPointerDown(e) {
  if (e.button !== 0) return;
  const handle = e.target.closest('.clip-handle');
  const clipEl = e.target.closest('.clip');
  const inLane = e.target.closest('.lane') || e.target.closest('.ruler') || e.target.closest('.ruler-canvas');
  if (!inLane && !clipEl) return;

  if (handle && clipEl) {
    const found = clipById(clipEl.dataset.id);
    if (!found) return;
    select(found.clip.id);
    savePoint();
    drag = {
      mode: 'trim', side: handle.dataset.side, clip: found.clip, track: found.track, node: clipEl,
      startX: e.clientX, origStart: found.clip.start, origIn: found.clip.inPoint,
      origLength: found.clip.length, origDur: clipDuration(found.clip),
      mediaDuration: found.clip.mediaId ? (mediaById(found.clip.mediaId)?.duration || 0) : 0,
      moved: false,
    };
    e.preventDefault();
    attachDragListeners();
    return;
  }

  if (clipEl) {
    const found = clipById(clipEl.dataset.id);
    if (!found) return;
    select(found.clip.id);
    savePoint();
    drag = {
      mode: 'move', clip: found.clip, track: found.track, fromTrack: found.track,
      startX: e.clientX, starts: [found.clip.start], node: clipEl,
      origStart: found.clip.start, moved: false,
    };
    e.preventDefault();
    attachDragListeners();
    return;
  }

  // régua / fundo da faixa: mover a agulha
  const t = snapTime(timeFromClientX(e.clientX), snapPoints());
  setTime(t);
  drag = { mode: 'scrub', points: snapPoints(), moved: false, startX: e.clientX, startTime: state.time };
  attachDragListeners();
}

function attachDragListeners() {
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp, { once: true });
}

function onPointerMove(e) {
  if (!drag) return;
  if (Math.abs(e.clientX - drag.startX) > 2) drag.moved = true;

  if (drag.mode === 'scrub') {
    const t = snapTime(timeFromClientX(e.clientX), drag.points);
    setTime(t);
    return;
  }

  if (drag.mode === 'move') {
    const dx = (e.clientX - drag.startX) / state.zoom;
    let start = drag.origStart + dx;
    const dur = clipDuration(drag.clip);
    if (state.snap) {
      const points = snapPoints(drag.clip.id);
      const snappedStart = snapTime(start, points);
      const snappedEnd = snapTime(start + dur, points) - dur;
      start = Math.abs(snappedStart - start) <= Math.abs(snappedEnd - start) ? snappedStart : snappedEnd;
    }
    start = Math.max(0, start);

    // troca de faixa
    const under = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(e.clientX, e.clientY) : null;
    const laneUnder = under ? under.closest('.lane') : null;
    if (laneUnder) {
      const targetTrack = state.tracks.find((t) => t.id === laneUnder.dataset.trackId);
      if (targetTrack && targetTrack.id !== drag.track.id) {
        const ok = kindOfTrack(targetTrack) === kindOfTrack(drag.fromTrack) && !targetTrack.hidden;
        if (ok) {
          drag.track = targetTrack;
          laneUnder.append(drag.node);
        }
      }
    }

    moveClipWithinTrack(drag.clip, drag.track, start, dx >= 0);
    drag.node.style.left = drag.clip.start * state.zoom + 'px';
    updateTimeLabel();
    return;
  }

  if (drag.mode === 'trim') {
    const clip = drag.clip;
    const dx = (e.clientX - drag.startX) / state.zoom;
    const speed = clip.speed || 1;
    const others = drag.track.clips.filter((c) => c.id !== clip.id);
    const prev = others.filter((c) => clipEnd(c) <= drag.origStart + 0.001)
      .sort((a, b) => clipEnd(b) - clipEnd(a))[0];
    const next = others.filter((c) => c.start >= drag.origStart + drag.origDur - 0.001)
      .sort((a, b) => a.start - b.start)[0];

    if (drag.side === 'l') {
      let delta = dx;
      const minDelta = Math.max(-Math.min(drag.origStart, drag.origIn / speed), prev ? clipEnd(prev) - drag.origStart : 0);
      const maxDelta = drag.origDur - MIN_LEN;
      delta = clamp(delta, minDelta, maxDelta);
      let newStart = drag.origStart + delta;
      if (state.snap) {
        const snapped = snapTime(newStart, snapPoints(clip.id));
        const snappedDelta = snapped - drag.origStart;
        if (Math.abs(snappedDelta - delta) < 0.2 && snappedDelta <= maxDelta) newStart = snapped;
      }
      const finalDelta = newStart - drag.origStart;
      clip.start = newStart;
      clip.inPoint = drag.origIn + finalDelta * speed;
      clip.length = drag.origLength - finalDelta * speed;
    } else {
      const maxTimeline = drag.mediaDuration ? (drag.mediaDuration - clip.inPoint) / speed : 3600;
      const maxByNext = next ? Math.max(MIN_LEN, next.start - clip.start) : 3600;
      let newDur = clamp(drag.origDur + dx, MIN_LEN, Math.min(maxTimeline, maxByNext, 3600));
      if (state.snap) {
        const end = snapTime(clip.start + newDur, snapPoints(clip.id));
        const snappedDur = end - clip.start;
        if (snappedDur > MIN_LEN && Math.abs(snappedDur - newDur) < 0.2) newDur = snappedDur;
      }
      clip.length = newDur * speed;
    }
    drag.node.style.left = clip.start * state.zoom + 'px';
    drag.node.style.width = Math.max(8, clipDuration(clip) * state.zoom) + 'px';
    updateTimeLabel();
    return;
  }
}

function onPointerUp() {
  window.removeEventListener('pointermove', onPointerMove);
  if (!drag) return;
  const finished = drag;
  drag = null;
  if (!finished.moved) {
    if (finished.mode === 'scrub') emitChange('selection');
    return;
  }
  if (finished.mode === 'move' && finished.track.id !== finished.fromTrack.id) {
    const from = finished.fromTrack;
    const idx = from.clips.findIndex((c) => c.id === finished.clip.id);
    if (idx >= 0) from.clips.splice(idx, 1);
    finished.clip.start = Math.max(0, finished.clip.start);
    finished.track.clips.push(finished.clip);
    finished.track.clips.sort((a, b) => a.start - b.start);
    from.clips.sort((a, b) => a.start - b.start);
  }
  emitChange('structure');
}

/* -------------------------------- comandos -------------------------------- */

export function doSplit() {
  const id = state.selectedId || clipAtPlayheadId();
  if (!id) return false;
  const ok = splitClip(id, state.time);
  if (!ok) {
    const found = clipById(id);
    if (found) splitClip(id, found.clip.start + clipDuration(found.clip) / 2);
  }
  return true;
}

function clipAtPlayheadId() {
  for (const track of state.tracks) {
    if (track.hidden) continue;
    for (const c of track.clips) {
      if (state.time >= c.start && state.time < clipEnd(c)) return c.id;
    }
  }
  return null;
}

export function doDelete() {
  if (!state.selectedId) return false;
  return removeClip(state.selectedId);
}

export function doDuplicate() {
  if (!state.selectedId) return false;
  return !!duplicateClip(state.selectedId);
}

/* -------------------------------- eventos --------------------------------- */

let rulerKey = '';
on('change', ({ reason } = {}) => {
  if (reason === 'prop') {
    updateTimeLabel();
    return;
  }
  render();
});
on('time', () => {
  layoutPlayhead();
  updateTimeLabel();
  followPlayhead();
});

function followPlayhead() {
  if (!state.playing) return;
  const x = HEAD_W + state.time * state.zoom;
  const viewLeft = scrollEl.scrollLeft;
  const viewRight = viewLeft + scrollEl.clientWidth - 40;
  if (x > viewRight) scrollEl.scrollLeft = x - scrollEl.clientWidth * 0.6;
}

export function scrollToPlayhead() {
  const x = HEAD_W + state.time * state.zoom;
  if (x < scrollEl.scrollLeft || x > scrollEl.scrollLeft + scrollEl.clientWidth - 60) {
    scrollEl.scrollLeft = Math.max(0, x - scrollEl.clientWidth * 0.35);
  }
}
