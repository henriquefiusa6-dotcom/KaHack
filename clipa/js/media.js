import { uid } from './util.js';
import { getAudioContext, attachElement } from './audio.js';

/** Biblioteca de mídias importadas: id -> objeto. */
export const mediaStore = new Map();

const clipElements = new Map(); // clipId -> HTMLVideoElement | HTMLAudioElement
const imageElements = new Map(); // mediaId -> HTMLImageElement

export function mediaById(id) {
  return mediaStore.get(id) || null;
}

export function mediaList() {
  return [...mediaStore.values()];
}

export function isSupported(file) {
  return /^(video|audio|image)\//.test(file.type) || /\.(mp4|webm|mov|m4v|ogv|mkv|mp3|wav|m4a|aac|ogg|flac|jpe?g|png|gif|webp|bmp|avif)$/i.test(file.name);
}

function baseType(file) {
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  if (file.type.startsWith('image/')) return 'image';
  if (/\.(mp4|webm|mov|m4v|ogv|mkv)$/i.test(file.name)) return 'video';
  if (/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(file.name)) return 'audio';
  return 'image';
}

function loadVideo(url) {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    video.src = url;
    const timeout = setTimeout(() => reject(new Error('Tempo esgotado ao ler o vídeo')), 25_000);

    video.addEventListener('loadedmetadata', () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      const finish = () => {
        clearTimeout(timeout);
        let thumb = null;
        try {
          const cw = 320;
          const chh = Math.max(1, Math.round((video.videoHeight / (video.videoWidth || 1)) * cw));
          const canvas = document.createElement('canvas');
          canvas.width = cw;
          canvas.height = chh;
          canvas.getContext('2d').drawImage(video, 0, 0, cw, chh);
          thumb = canvas.toDataURL('image/jpeg', 0.72);
        } catch (err) {
          console.warn('Sem miniatura para', url, err);
        }
        resolve({
          width: video.videoWidth || 1280,
          height: video.videoHeight || 720,
          duration: duration || 4,
          thumb,
        });
        video.removeAttribute('src');
        video.load();
      };
      const seekTo = Math.min(Math.max(0.06, duration * 0.15), Math.max(0.06, duration - 0.15));
      video.addEventListener('seeked', finish, { once: true });
      try { video.currentTime = seekTo; } catch { finish(); }
    }, { once: true });

    video.addEventListener('error', () => {
      clearTimeout(timeout);
      reject(new Error('Formato de vídeo não suportado pelo navegador'));
    }, { once: true });
  });
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight, duration: 4, img });
    img.onerror = () => reject(new Error('Não foi possível abrir a imagem'));
    img.src = url;
  });
}

function loadAudio(url) {
  return new Promise((resolve, reject) => {
    const audio = document.createElement('audio');
    audio.preload = 'metadata';
    audio.src = url;
    const timeout = setTimeout(() => reject(new Error('Tempo esgotado ao ler o áudio')), 25_000);
    audio.addEventListener('loadedmetadata', () => {
      clearTimeout(timeout);
      resolve({
        duration: Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 4,
        width: 0,
        height: 0,
      });
    }, { once: true });
    audio.addEventListener('error', () => {
      clearTimeout(timeout);
      reject(new Error('Formato de áudio não suportado'));
    }, { once: true });
  });
}

export async function computePeaks(url, buckets = 260) {
  try {
    const res = await fetch(url);
    const buf = await res.arrayBuffer();
    const ctx = getAudioContext();
    const audioBuf = await ctx.decodeAudioData(buf);
    const data = audioBuf.getChannelData(0);
    const size = Math.max(1, Math.floor(data.length / buckets));
    const peaks = new Array(buckets).fill(0);
    for (let i = 0; i < buckets; i++) {
      let max = 0;
      const start = i * size;
      for (let j = 0; j < size; j += 12) {
        const v = Math.abs(data[start + j] || 0);
        if (v > max) max = v;
      }
      peaks[i] = max;
    }
    const top = Math.max(...peaks, 0.0001);
    return peaks.map((p) => Math.min(1, p / top));
  } catch (err) {
    console.warn('Não foi possível gerar a forma de onda', err);
    return null;
  }
}

/** Importa arquivos e devolve a lista de mídias criadas. */
export async function importFiles(fileList, onProgress) {
  const files = [...fileList].filter(isSupported);
  const created = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    onProgress?.(i, files.length, file.name);
    const type = baseType(file);
    const url = URL.createObjectURL(file);
    try {
      let meta;
      if (type === 'video') meta = await loadVideo(url);
      else if (type === 'audio') meta = await loadAudio(url);
      else meta = await loadImage(url);

      const media = {
        id: uid('media'),
        name: file.name.replace(/\.[^.]+$/, ''),
        type,
        url,
        size: file.size,
        duration: meta.duration || 4,
        width: meta.width || 0,
        height: meta.height || 0,
        thumb: type === 'image' ? url : meta.thumb || null,
        peaks: null,
        // reaproveita a imagem já decodificada na importação (evita 1º quadro vazio)
        img: type === 'image' ? meta.img || null : null,
      };
      if (type === 'audio') media.peaks = await computePeaks(url);
      mediaStore.set(media.id, media);
      created.push(media);
    } catch (err) {
      URL.revokeObjectURL(url);
      console.warn('Falha ao importar', file.name, err);
      created.push({ error: true, name: file.name, message: err.message });
    }
  }
  return created;
}

export function removeMedia(id) {
  const media = mediaStore.get(id);
  if (!media) return;
  for (const [clipId, el] of clipElements) {
    if (el.dataset.mediaId === id) disposeClipElement(clipId);
  }
  imageElements.delete(id);
  URL.revokeObjectURL(media.url);
  mediaStore.delete(id);
}

/* -------------------------- elementos de reprodução -------------------------- */

export function getImageElement(media) {
  let img = imageElements.get(media.id);
  if (!img) {
    img = media.img || new Image();
    if (!media.img) {
      img.src = media.url;
      img.decode?.().catch(() => {});
    }
    media.img = img;
    imageElements.set(media.id, img);
  }
  return img;
}

export function getClipElement(clip) {
  if (!clip.mediaId) return null;
  const media = mediaById(clip.mediaId);
  if (!media) return null;
  if (media.type === 'image') return getImageElement(media);

  let el = clipElements.get(clip.id);
  if (el) return el;

  el = document.createElement(media.type === 'audio' ? 'audio' : 'video');
  el.src = media.url;
  el.preload = 'auto';
  el.playsInline = true;
  el.muted = false;
  el.volume = 1;
  el.dataset.mediaId = media.id;
  el.dataset.clipId = clip.id;
  el.style.cssText = 'position:fixed;left:-20px;bottom:-20px;width:4px;height:4px;opacity:0.01;pointer-events:none;z-index:-1;';
  document.body.append(el);
  attachElement(el);
  clipElements.set(clip.id, el);
  return el;
}

export function prepareAllElements(clips) {
  for (const clip of clips) {
    if (clip.type === 'video' || clip.type === 'audio') getClipElement(clip);
  }
}

export function disposeClipElement(clipId) {
  const el = clipElements.get(clipId);
  if (!el) return;
  try { el.pause(); } catch {}
  el.removeAttribute('src');
  try { el.load(); } catch {}
  el.remove();
  clipElements.delete(clipId);
}

export function listClipElements() {
  return [...clipElements.entries()];
}

/** Espera até que os elementos de vídeo tenham quadros prontos (útil na exportação). */
export async function waitForReady(clips, timeout = 4000) {
  const start = performance.now();
  while (performance.now() - start < timeout) {
    const pending = clips.some((clip) => {
      if (clip.type !== 'video') return false;
      const el = clipElements.get(clip.id);
      return el && el.readyState < 2;
    });
    if (!pending) return true;
    await new Promise((r) => setTimeout(r, 80));
  }
  return false;
}
