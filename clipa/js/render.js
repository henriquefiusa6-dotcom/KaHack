import { state, clipAtTime, clipDuration } from './store.js';
import { getClipElement, mediaById } from './media.js';
import { clamp, lerp, easeOutCubic, easeOutBack, roundRect } from './util.js';

export const FILTER_PRESETS = {
  none: { label: 'Original', css: '', adj: {} },
  mono: { label: 'Preto e branco', css: 'grayscale(1)', adj: {} },
  sepia: { label: 'Sépia', css: 'sepia(0.85)', adj: {} },
  cine: { label: 'Cinema', css: 'contrast(1.18) saturate(0.82) brightness(0.97)', adj: {} },
  quente: { label: 'Quente', css: 'saturate(1.15) sepia(0.18) brightness(1.05)', adj: {} },
  frio: { label: 'Frio', css: 'saturate(1.05) hue-rotate(-12deg) brightness(1.02)', adj: {} },
  vintage: { label: 'Vintage', css: 'sepia(0.35) contrast(0.92) saturate(0.85) brightness(1.04)', adj: {} },
  vivido: { label: 'Vívido', css: 'saturate(1.5) contrast(1.1)', adj: {} },
  escuro: { label: 'Escurecer', css: 'brightness(0.78) contrast(1.05)', adj: {} },
  sonho: { label: 'Sonho', css: 'blur(1.2px) brightness(1.1) saturate(1.2)', adj: {} },
};

export const ANIMATIONS = {
  none: 'Nenhuma',
  fade: 'Fade',
  fadeUp: 'Surgir de baixo',
  fadeDown: 'Surgir de cima',
  slideLeft: 'Deslizar ←',
  slideRight: 'Deslizar →',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  pop: 'Pop',
  spin: 'Girar',
};

export function computeLayout(project, cw, ch) {
  const scale = Math.min(cw / project.width, ch / project.height);
  const w = project.width * scale;
  const h = project.height * scale;
  return { x: (cw - w) / 2, y: (ch - h) / 2, w, h, scale };
}

function fitRect(fit, vw, vh, fw, fh) {
  if (!vw || !vh) return null;
  if (fit === 'fill') return { sx: 0, sy: 0, sw: vw, sh: vh, x: 0, y: 0, w: fw, h: fh };
  if (fit === 'contain') {
    const k = Math.min(fw / vw, fh / vh);
    const w = vw * k;
    const h = vh * k;
    return { sx: 0, sy: 0, sw: vw, sh: vh, x: (fw - w) / 2, y: (fh - h) / 2, w, h };
  }
  if (fit === 'original') {
    const k = Math.min(1, fw / vw, fh / vh);
    const w = vw * k;
    const h = vh * k;
    return { sx: 0, sy: 0, sw: vw, sh: vh, x: (fw - w) / 2, y: (fh - h) / 2, w, h };
  }
  const arF = fw / fh;
  const arV = vw / vh;
  let sw = vw;
  let sh = vh;
  if (arV > arF) sw = vh * arF;
  else sh = vw / arF;
  return { sx: (vw - sw) / 2, sy: (vh - sh) / 2, sw, sh, x: 0, y: 0, w: fw, h: fh };
}

function cssFilterFor(clip) {
  const a = clip.adjust || {};
  const parts = [];
  const preset = FILTER_PRESETS[clip.filter]?.css;
  if (preset) parts.push(preset);
  if (a.brightness !== 1) parts.push(`brightness(${a.brightness})`);
  if (a.contrast !== 1) parts.push(`contrast(${a.contrast})`);
  if (a.saturation !== 1) parts.push(`saturate(${a.saturation})`);
  if (a.hue) parts.push(`hue-rotate(${a.hue}deg)`);
  if (a.blur) parts.push(`blur(${a.blur}px)`);
  return parts.length ? parts.join(' ') : 'none';
}

export function animValues(clip, t) {
  const d = clipDuration(clip);
  const dur = clamp(clip.animDur || 0.6, 0.05, Math.max(0.05, d));
  const local = clamp(t - clip.start, 0, d);
  const inP = clip.animIn && clip.animIn !== 'none' ? clamp(local / dur, 0, 1) : 1;
  const outP = clip.animOut && clip.animOut !== 'none' ? clamp((d - local) / dur, 0, 1) : 1;
  return { inP, outP, p: Math.min(inP, outP) };
}

function applyAnim(ctx, clip, t, fw, fh) {
  const { inP, outP } = animValues(clip, t);
  let alpha = 1;
  let tx = 0;
  let ty = 0;
  let scale = 1;
  let rot = 0;

  const applyIn = (name, p) => {
    switch (name) {
      case 'fade': alpha *= p; break;
      case 'fadeUp': alpha *= p; ty += (1 - easeOutCubic(p)) * fh * 0.08; break;
      case 'fadeDown': alpha *= p; ty -= (1 - easeOutCubic(p)) * fh * 0.08; break;
      case 'slideLeft': alpha *= p; tx -= (1 - easeOutCubic(p)) * fw * 0.35; break;
      case 'slideRight': alpha *= p; tx += (1 - easeOutCubic(p)) * fw * 0.35; break;
      case 'zoomIn': alpha *= p; scale *= lerp(0.55, 1, easeOutCubic(p)); break;
      case 'zoomOut': alpha *= p; scale *= lerp(1.35, 1, easeOutCubic(p)); break;
      case 'pop': alpha *= p; scale *= Math.max(0.02, easeOutBack(p)); break;
      case 'spin': alpha *= p; scale *= lerp(0.4, 1, easeOutCubic(p)); rot += (1 - p) * -Math.PI * 0.6; break;
      default: break;
    }
  };

  if (clip.animIn && clip.animIn !== 'none') applyIn(clip.animIn, inP);
  if (clip.animOut && clip.animOut !== 'none' && outP < 1) {
    // a saída inverte o efeito de entrada quando o nome combina
    alpha *= easeOutCubic(outP);
    if (clip.animOut === 'fade') { /* apenas alpha */ }
    else if (clip.animOut === 'fadeUp') ty += (1 - outP) * fh * 0.08;
    else if (clip.animOut === 'fadeDown') ty -= (1 - outP) * fh * 0.08;
    else if (clip.animOut === 'slideLeft') tx -= (1 - outP) * fw * 0.35;
    else if (clip.animOut === 'slideRight') tx += (1 - outP) * fw * 0.35;
    else if (clip.animOut === 'zoomIn') scale *= lerp(1, 1.4, 1 - outP);
    else if (clip.animOut === 'zoomOut') scale *= lerp(1, 0.6, 1 - outP);
    else if (clip.animOut === 'pop') scale *= lerp(1, 0.2, 1 - outP);
    else if (clip.animOut === 'spin') { scale *= lerp(1, 0.4, 1 - outP); rot += (1 - outP) * Math.PI * 0.6; }
  }

  const tr = clip.transform || {};
  ctx.translate(fw / 2 + (tr.x || 0) + tx, fh / 2 + (tr.y || 0) + ty);
  ctx.rotate(((tr.rotate || 0) * Math.PI) / 180 + rot);
  ctx.scale((tr.scale || 1) * scale, (tr.scale || 1) * scale);
  ctx.globalAlpha *= clamp((tr.opacity ?? 1) * alpha, 0, 1);
  return { fw, fh };
}

function drawVignette(ctx, strength, w, h) {
  if (!strength) return;
  const g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.72);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${clamp(strength, 0, 1)})`);
  ctx.save();
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

function drawMediaClip(ctx, clip, t, fw, fh) {
  if (clip.type === 'audio') return false;
  const media = mediaById(clip.mediaId);
  const el = getClipElement(clip);
  if (!media || !el) return false;

  const vw = media.type === 'image' ? media.width : el.videoWidth;
  const vh = media.type === 'image' ? media.height : el.videoHeight;
  if (!vw || !vh) return false;

  const rect = fitRect(clip.fit, vw, vh, fw, fh);
  if (!rect) return false;

  ctx.save();
  applyAnim(ctx, clip, t, fw, fh);
  ctx.filter = cssFilterFor(clip);
  ctx.imageSmoothingQuality = 'high';
  try {
    ctx.drawImage(el, rect.sx, rect.sy, rect.sw, rect.sh,
      rect.x - fw / 2, rect.y - fh / 2, rect.w, rect.h);
  } catch (err) {
    /* quadro ainda não disponível */
  }
  ctx.restore();

  if (clip.adjust?.vignette) {
    ctx.save();
    applyAnim(ctx, clip, t, fw, fh);
    ctx.translate(-fw / 2, -fh / 2);
    drawVignette(ctx, clip.adjust.vignette, fw, fh);
    ctx.restore();
  }
  return true;
}

function wrapLines(ctx, text, maxWidth) {
  const paragraphs = String(text).split('\n');
  const lines = [];
  for (const para of paragraphs) {
    const words = para.split(/\s+/).filter((w) => w.length);
    if (!words.length) { lines.push(''); continue; }
    let line = words[0];
    for (let i = 1; i < words.length; i++) {
      const test = line + ' ' + words[i];
      if (ctx.measureText(test).width <= maxWidth) line = test;
      else { lines.push(line); line = words[i]; }
    }
    lines.push(line);
  }
  return lines;
}

function drawTextClip(ctx, clip, t, fw, fh) {
  const cfg = clip.text;
  if (!cfg) return false;
  ctx.save();
  applyAnim(ctx, clip, t, fw, fh);

  const fontSize = cfg.size;
  ctx.font = `${cfg.weight || 700} ${fontSize}px ${cfg.family || 'sans-serif'}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${cfg.letterSpacing || 0}px`;

  const maxWidth = Math.max(80, (cfg.maxWidth || 0.86) * fw);
  const lines = wrapLines(ctx, cfg.content || '', maxWidth);
  const lineH = fontSize * (cfg.lineHeight || 1.2);
  const totalH = lineH * lines.length;
  const px = (cfg.x ?? 0.5) * fw - fw / 2;
  const py = (cfg.y ?? 0.5) * fh - fh / 2;

  const widest = Math.max(...lines.map((l) => ctx.measureText(l).width), 10);
  const align = cfg.align || 'center';

  // fundo
  if (cfg.bg && cfg.bg !== 'transparent') {
    const padX = fontSize * (cfg.bgPad ?? 0.35);
    const padY = fontSize * (cfg.bgPad ?? 0.35) * 0.55;
    const bx = px - widest / 2 - padX;
    const by = py - totalH / 2 - padY;
    ctx.save();
    ctx.fillStyle = cfg.bg;
    roundRect(ctx, bx, by, widest + padX * 2, totalH + padY * 2, cfg.radius ?? 18);
    ctx.fill();
    ctx.restore();
  }

  if (cfg.shadow) {
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = Math.max(4, fontSize * 0.12);
    ctx.shadowOffsetY = Math.max(2, fontSize * 0.03);
  }
  if (cfg.stroke) {
    ctx.lineWidth = cfg.stroke;
    ctx.strokeStyle = cfg.strokeColor || '#000';
    ctx.lineJoin = 'round';
  }

  lines.forEach((line, i) => {
    const y = py - totalH / 2 + lineH / 2 + i * lineH;
    const lineW = ctx.measureText(line).width;
    let x = px;
    if (align === 'left') x = px - widest / 2 + lineW / 2;
    else if (align === 'right') x = px + widest / 2 - lineW / 2;
    if (cfg.stroke) ctx.strokeText(line, x, y);
    ctx.fillStyle = cfg.color || '#fff';
    ctx.fillText(line, x, y);
  });

  ctx.restore();
  return true;
}

/**
 * Desenha um quadro do projeto no canvas informado.
 * @returns {{drawn:number}}
 */
export function renderFrame(ctx, cw, ch, t, opts = {}) {
  const project = opts.project || state.project;
  const dpr = opts.dpr || 1;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.globalAlpha = 1;
  ctx.filter = 'none';
  ctx.clearRect(0, 0, cw, ch);
  ctx.fillStyle = opts.outside || '#000000';
  ctx.fillRect(0, 0, cw, ch);

  const layout = computeLayout(project, cw, ch);
  ctx.save();
  ctx.translate(layout.x, layout.y);
  ctx.beginPath();
  ctx.rect(0, 0, layout.w, layout.h);
  ctx.clip();
  ctx.fillStyle = project.bg || '#000';
  ctx.fillRect(0, 0, layout.w, layout.h);

  let drawn = 0;
  const tracks = [...state.tracks].reverse();
  for (const track of tracks) {
    if (track.hidden || track.muted) continue;
    const clip = clipAtTime(track, t);
    if (!clip) continue;
    ctx.save();
    ctx.scale(layout.scale, layout.scale);
    const fw = project.width;
    const fh = project.height;
    let ok = false;
    if (clip.type === 'text') ok = drawTextClip(ctx, clip, t, fw, fh);
    else ok = drawMediaClip(ctx, clip, t, fw, fh);
    ctx.restore();
    if (ok) drawn++;
  }

  ctx.restore();
  ctx.restore();
  return { drawn, layout };
}

/** Quadro vazio com a cor do projeto (usado como miniatura padrão). */
export function renderEmpty(ctx, cw, ch) {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, cw, ch);
  const layout = computeLayout(state.project, cw, ch);
  ctx.fillStyle = state.project.bg;
  ctx.fillRect(layout.x, layout.y, layout.w, layout.h);
}
