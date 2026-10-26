// Roteamento de áudio: todos os elementos de mídia passam por um AudioContext
// para que (1) o volume seja controlado por clipe e (2) a exportação consiga
// capturar uma faixa de áudio sincronizada.

let ctx = null;
let bus = null;         // soma de todos os clipes
let previewGain = null; // volume da prévia (não afeta a exportação)
let streamDest = null;  // destino usado pelo MediaRecorder

const gains = new WeakMap();
const connected = new WeakSet();

export function getAudioContext() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    ctx = new AC();
    bus = ctx.createGain();
    bus.gain.value = 1;
    previewGain = ctx.createGain();
    previewGain.gain.value = 1;
    streamDest = ctx.createMediaStreamDestination();
    bus.connect(previewGain);
    previewGain.connect(ctx.destination);
    bus.connect(streamDest);
  }
  return ctx;
}

export function resumeAudio() {
  try {
    const c = getAudioContext();
    if (c.state === 'suspended') c.resume();
  } catch (err) {
    console.warn('Áudio indisponível', err);
  }
}

export function setPreviewVolume(v) {
  getAudioContext();
  previewGain.gain.value = v;
}

export function attachElement(el) {
  const existing = gains.get(el);
  if (existing) return existing;
  const c = getAudioContext();
  let node;
  try {
    node = c.createMediaElementSource(el);
  } catch (err) {
    console.warn('Não foi possível rotear o áudio do clipe', err);
    node = null;
  }
  const g = c.createGain();
  g.gain.value = 1;
  if (node) node.connect(g);
  g.connect(bus);
  gains.set(el, g);
  connected.add(el);
  return g;
}

export function setElementVolume(el, v) {
  const g = attachElement(el);
  g.gain.value = Math.max(0, Math.min(2, v));
}

export function getStreamAudioTrack() {
  getAudioContext();
  return streamDest.stream.getAudioTracks()[0] || null;
}

export function suspendPreview(flag) {
  if (!ctx || !previewGain) return;
  previewGain.gain.value = flag ? 0 : 1;
}

export function getAudioClock() {
  return getAudioContext().currentTime;
}
