import { clamp, uid } from './util.js';
import { emit } from './bus.js';

export const state = {
  project: {
    name: 'Meu projeto',
    width: 1920,
    height: 1080,
    fps: 30,
    bg: '#000000',
  },
  // Ordem de exibição na linha do tempo (de cima para baixo).
  // A renderização acontece na ordem inversa (de baixo para cima).
  tracks: [],
  time: 0,
  playing: false,
  zoom: 64,          // pixels por segundo
  snap: true,
  selectedId: null,
  previewVolume: 1,
};

export const TRACK_TEMPLATE = [
  { id: 'text', type: 'text', name: 'Texto', icon: 'T' },
  { id: 'overlay', type: 'overlay', name: 'Sobreposição', icon: '▣' },
  { id: 'main', type: 'main', name: 'Vídeo principal', icon: '▶' },
  { id: 'audio', type: 'audio', name: 'Áudio', icon: '♫' },
];

export function resetTracks() {
  state.tracks = TRACK_TEMPLATE.map((t) => ({ ...t, clips: [], hidden: false, muted: false }));
  state.selectedId = null;
  state.time = 0;
}

if (!state.tracks.length) resetTracks();

const HISTORY_LIMIT = 80;
const undoStack = [];
const redoStack = [];

function snapshot() {
  return JSON.stringify({ project: state.project, tracks: state.tracks });
}

function restore(json) {
  const data = JSON.parse(json);
  state.project = data.project;
  state.tracks = data.tracks;
  if (state.selectedId && !clipById(state.selectedId)) state.selectedId = null;
  emitChange('project');
}

export function savePoint() {
  const snap = snapshot();
  if (undoStack[undoStack.length - 1] === snap) return;
  undoStack.push(snap);
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
  redoStack.length = 0;
  emit('history');
}

export function undo() {
  if (!undoStack.length) return false;
  const current = snapshot();
  redoStack.push(current);
  restore(undoStack.pop());
  emit('history');
  return true;
}

export function redo() {
  if (!redoStack.length) return false;
  undoStack.push(snapshot());
  restore(redoStack.pop());
  emit('history');
  return true;
}

export const canUndo = () => undoStack.length > 0;
export const canRedo = () => redoStack.length > 0;

export function emitChange(reason = 'view') {
  emit('change', { reason });
}

/* ------------------------------- consultas ------------------------------- */

export function trackById(id) {
  return state.tracks.find((t) => t.id === id) || null;
}

export function clipById(id) {
  for (const track of state.tracks) {
    const clip = track.clips.find((c) => c.id === id);
    if (clip) return { clip, track };
  }
  return null;
}

export function getClip(id) {
  return clipById(id)?.clip || null;
}

export const clipDuration = (clip) => Math.max(0.05, clip.length / (clip.speed || 1));
export const clipEnd = (clip) => clip.start + clipDuration(clip);

/** Converte tempo da linha do tempo em tempo da mídia original. */
export function mediaTimeAt(clip, t) {
  return clip.inPoint + Math.max(0, t - clip.start) * (clip.speed || 1);
}

export function clipAtTime(track, t) {
  return track.clips.find((c) => t >= c.start && t < clipEnd(c)) || null;
}

export function projectDuration() {
  let max = 0;
  for (const track of state.tracks) {
    for (const clip of track.clips) max = Math.max(max, clipEnd(clip));
  }
  return max;
}

/* ------------------------------- criação -------------------------------- */

export function makeClip(media, type) {
  const clip = {
    id: uid('clip'),
    type,
    name: media?.name || 'Texto',
    mediaId: media?.id || null,
    start: 0,
    inPoint: 0,
    length: 4,
    speed: 1,
    transform: { x: 0, y: 0, scale: 1, rotate: 0, opacity: 1 },
    fit: 'cover',
    filter: 'none',
    adjust: { brightness: 1, contrast: 1, saturation: 1, hue: 0, blur: 0, vignette: 0 },
    animIn: 'none',
    animOut: 'none',
    animDur: 0.6,
    volume: 1,
    text: null,
  };

  if (type === 'video') {
    clip.length = media?.duration || 4;
  } else if (type === 'image') {
    clip.length = 4;
    clip.fit = 'cover';
    clip.animIn = 'zoomIn';
    clip.animDur = 0.8;
  } else if (type === 'audio') {
    clip.length = media?.duration || 4;
    clip.animIn = 'none';
    clip.animOut = 'none';
  } else if (type === 'text') {
    clip.length = 4;
    clip.animIn = 'fadeUp';
    clip.animDur = 0.5;
    clip.text = {
      content: 'Seu texto aqui',
      size: 82,
      weight: 800,
      family: '"Inter", "Segoe UI", system-ui, sans-serif',
      color: '#ffffff',
      bg: 'transparent',
      bgPad: 0.35,
      radius: 18,
      stroke: 0,
      strokeColor: '#000000',
      shadow: true,
      align: 'center',
      lineHeight: 1.2,
      letterSpacing: 0,
      x: 0.5,
      y: 0.5,
      maxWidth: 0.86,
    };
  }
  return clip;
}

export function addClip(trackId, clip, atTime = null) {
  const track = trackById(trackId);
  if (!track) return null;
  savePoint();
  if (atTime !== null) clip.start = Math.max(0, atTime);
  confirmNoOverlap(track, clip);
  track.clips.push(clip);
  sortClips(track);
  select(clip.id);
  emitChange('structure');
  return clip;
}

/** Coloca o clipe no primeiro espaço livre a partir de `desired`. */
export function findFreeStart(track, clip, desired) {
  const dur = clipDuration(clip);
  let start = Math.max(0, desired);
  const others = track.clips.filter((c) => c.id !== clip.id).sort((a, b) => a.start - b.start);
  let guard = 0;
  while (guard++ < 200) {
    const hit = others.find((c) => start < clipEnd(c) - 1e-4 && start + dur > c.start + 1e-4);
    if (!hit) break;
    start = clipEnd(hit);
  }
  return start;
}

function confirmNoOverlap(track, clip) {
  clip.start = findFreeStart(track, clip, clip.start);
}

export function sortClips(track) {
  track.clips.sort((a, b) => a.start - b.start);
}

export function removeClip(id) {
  for (const track of state.tracks) {
    const i = track.clips.findIndex((c) => c.id === id);
    if (i >= 0) {
      savePoint();
      track.clips.splice(i, 1);
      if (state.selectedId === id) state.selectedId = null;
      emit('clip:removed', { id });
      emitChange('structure');
      return true;
    }
  }
  return false;
}

export function duplicateClip(id) {
  const found = clipById(id);
  if (!found) return;
  const { clip, track } = found;
  savePoint();
  const copy = JSON.parse(JSON.stringify(clip));
  copy.id = uid('clip');
  copy.start = clipEnd(clip);
  copy.start = findFreeStart(track, copy, copy.start);
  track.clips.push(copy);
  sortClips(track);
  select(copy.id);
  emitChange('structure');
  return copy;
}

export function splitClip(id, time) {
  const found = clipById(id);
  if (!found) return false;
  const { clip, track } = found;
  const dur = clipDuration(clip);
  if (time <= clip.start + 0.08 || time >= clipEnd(clip) - 0.08) return false;
  savePoint();
  const offset = time - clip.start;
  const right = JSON.parse(JSON.stringify(clip));
  right.id = uid('clip');
  right.start = time;
  right.inPoint = clip.inPoint + offset * (clip.speed || 1);
  right.length = clip.length - offset * (clip.speed || 1);
  clip.length = offset * (clip.speed || 1);
  if (right.text) right.animIn = 'none';
  clip.animOut = 'none';
  track.clips.push(right);
  sortClips(track);
  select(right.id);
  emitChange('structure');
  return true;
}

export function addTrack(type = 'overlay') {
  savePoint();
  const count = state.tracks.filter((t) => t.type === 'overlay').length;
  const track = {
    id: uid('track'),
    type,
    name: type === 'overlay' ? `Sobreposição ${count + 1}` : 'Nova faixa',
    icon: '▣',
    clips: [],
    hidden: false,
    muted: false,
  };
  const mainIndex = state.tracks.findIndex((t) => t.type === 'main');
  state.tracks.splice(mainIndex < 0 ? 0 : mainIndex, 0, track);
  emitChange('structure');
  return track;
}

export function removeTrack(id) {
  const index = state.tracks.findIndex((t) => t.id === id);
  if (index < 0) return;
  const track = state.tracks[index];
  if (track.type === 'main' || track.type === 'audio' || track.type === 'text') return;
  savePoint();
  state.tracks.splice(index, 1);
  for (const c of track.clips) if (c.id === state.selectedId) state.selectedId = null;
  emitChange('structure');
}

export function select(id) {
  if (state.selectedId === id) return;
  state.selectedId = id;
  emit('selection', { id });
  emitChange('selection');
}

export function setTime(t) {
  state.time = clamp(t, 0, Math.max(0.001, projectDuration()));
  emit('time', { time: state.time });
}

/** Move um clipe garantindo que ele não sobreponha os vizinhos da faixa. */
export function moveClipWithinTrack(clip, track, targetStart, draggingRight) {
  let start = Math.max(0, targetStart);
  const dur = clipDuration(clip);
  for (const other of track.clips) {
    if (other.id === clip.id) continue;
    const oStart = other.start;
    const oEnd = clipEnd(other);
    const overlaps = start < oEnd - 1e-4 && start + dur > oStart + 1e-4;
    if (!overlaps) continue;
    if (draggingRight) start = oEnd;
    else start = Math.max(0, oStart - dur);
  }
  clip.start = Math.max(0, start);
  return clip.start;
}

export function setProject(patch) {
  savePoint();
  Object.assign(state.project, patch);
  emitChange('project');
}

export function resetProject() {
  savePoint();
  state.project = { name: 'Meu projeto', width: 1920, height: 1080, fps: 30, bg: '#000000' };
  resetTracks();
  state.time = 0;
  emitChange('project');
}
