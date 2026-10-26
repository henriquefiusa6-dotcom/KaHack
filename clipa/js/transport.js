import { state, setTime, projectDuration, clipAtTime, clipEnd, mediaTimeAt, clipDuration } from './store.js';
import { getClipElement, mediaById } from './media.js';
import { resumeAudio, setElementVolume } from './audio.js';
import { emit, on } from './bus.js';

let raf = 0;
const anchor = { wall: 0, time: 0 };

function mediaElements() {
  const list = [];
  for (const track of state.tracks) {
    for (const clip of track.clips) {
      if (clip.type === 'text' || !clip.mediaId) continue;
      const el = getClipElement(clip);
      if (el) list.push({ clip, track, el });
    }
  }
  return list;
}

function targetRate(clip) {
  const speed = clip?.speed || 1;
  return Math.min(4, Math.max(0.0625, speed));
}

function safePlay(el) {
  const p = el.play();
  if (p && typeof p.catch === 'function') p.catch(() => {});
}

function applyVolume(clip, track, el) {
  const v = track.muted ? 0 : Math.max(0, Math.min(2, clip.volume ?? 1));
  if (Math.abs((el.dataset.lastVol ?? 1) - v) > 0.001) {
    setElementVolume(el, v);
    el.dataset.lastVol = v;
  }
}

export function syncAll(immediate = false) {
  const t = state.time;
  for (const { clip, track, el } of mediaElements()) {
    const active = t >= clip.start - 0.001 && t < clipEnd(clip) - 0.0005;
    applyVolume(clip, track, el);
    const rate = targetRate(clip);
    if (Math.abs(el.playbackRate - rate) > 0.001) {
      try { el.playbackRate = rate; } catch {}
    }
    const desired = active ? mediaTimeAt(clip, t) : clip.inPoint;
    if (active && state.playing) {
      const drift = Math.abs(el.currentTime - desired);
      if (immediate || el.paused || drift > 0.2) {
        try { el.currentTime = Math.max(0, desired); } catch {}
        if (el.paused) safePlay(el);
      }
      if (el.paused) safePlay(el);
    } else {
      if (!el.paused) {
        try { el.pause(); } catch {}
      }
      if (active || immediate) {
        const d = Math.max(0, desired);
        if (Math.abs(el.currentTime - d) > 0.03 || immediate) {
          try { el.currentTime = d; } catch {}
        }
      }
    }
  }
}

/** Reposiciona os elementos sem tocar (usado ao arrastar a agulha). */
export function seekPreview() {
  if (state.playing) return;
  const t = state.time;
  for (const { clip, el } of mediaElements()) {
    const active = t >= clip.start - 0.001 && t < clipEnd(clip);
    const desired = active ? mediaTimeAt(clip, t) : clip.inPoint;
    const d = Math.max(0, Math.min(desired, (el.duration || desired) - 0.02));
    if (Math.abs(el.currentTime - d) > 0.04) {
      try { el.currentTime = d; } catch {}
    }
    if (!el.paused) { try { el.pause(); } catch {} }
  }
}

function tick() {
  if (!state.playing) return;
  const elapsed = (performance.now() - anchor.wall) / 1000;
  const t = anchor.time + elapsed;
  const dur = projectDuration();
  if (t >= dur) {
    setTime(dur);
    pause();
    return;
  }
  setTime(t);
  syncAll(false);
  raf = requestAnimationFrame(tick);
}

export function play() {
  if (state.playing) return;
  const dur = projectDuration();
  if (dur <= 0.05) return;
  if (state.time >= dur - 0.03) setTime(0);
  resumeAudio();
  state.playing = true;
  anchor.wall = performance.now();
  anchor.time = state.time;
  syncAll(true);
  emit('playing', { playing: true });
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(tick);
}

export function pause() {
  if (!state.playing) return;
  state.playing = false;
  cancelAnimationFrame(raf);
  for (const { el } of mediaElements()) {
    try { el.pause(); } catch {}
  }
  syncAll(true);
  emit('playing', { playing: false });
}

export function toggle() {
  if (state.playing) pause();
  else play();
}

export function stop() {
  pause();
  setTime(0);
}

on('time', () => { if (!state.playing) seekPreview(); });

export function isPlaying() {
  return state.playing;
}

export function currentSpeed() {
  return 1;
}
