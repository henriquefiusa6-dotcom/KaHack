import {
  state, clipById, clipDuration, clipEnd, emitChange, savePoint, removeClip, duplicateClip,
  splitClip, setProject, mediaTimeAt,
} from './store.js';
import { mediaById, mediaStore } from './media.js';
import { FILTER_PRESETS, ANIMATIONS } from './render.js';
import { on } from './bus.js';
import { h, fmtDur, fmtBytes, clamp } from './util.js';

let rootEl;
let builtKey = '';

export function initPanel(container) {
  rootEl = container;
  rootEl.innerHTML = '';
  build();
  on('selection', () => build(true));
  on('change', ({ reason }) => {
    if (reason === 'structure' || reason === 'project' || reason === 'view') build();
  });
}

function build(force = false) {
  const found = state.selectedId ? clipById(state.selectedId) : null;
  const key = found ? `${found.clip.id}:${found.track.id}:${found.clip.type}` : `project:${JSON.stringify(state.project)}:${state.tracks.map((t) => t.id + t.hidden + t.muted).join('')}`;
  if (!force && key === builtKey) return;
  builtKey = key;
  rootEl.innerHTML = '';
  if (found) rootEl.append(...buildClipPanel(found.clip, found.track));
  else rootEl.append(...buildProjectPanel());
}

/* ------------------------------- componentes ------------------------------ */

function section(title, ...children) {
  const sec = h('section', { class: 'panel-section' },
    h('header', { class: 'panel-section-head' }, h('span', {}, title)),
    h('div', { class: 'panel-section-body' }, ...children),
  );
  const head = sec.querySelector('.panel-section-head');
  head.addEventListener('click', () => sec.classList.toggle('collapsed'));
  return sec;
}

function field(label, control, hint) {
  return h('label', { class: 'field' },
    h('span', { class: 'field-label' }, label),
    h('div', { class: 'field-control' }, control, hint ? h('small', { class: 'field-hint' }, hint) : null),
  );
}

function withUndo(el) {
  el.addEventListener('pointerdown', () => savePoint());
  el.addEventListener('keydown', () => { if (!el._undoKey) { savePoint(); el._undoKey = true; } });
  el.addEventListener('blur', () => { el._undoKey = false; });
  return el;
}

function slider({ label, value, min, max, step, onInput, suffix = '', formatter }) {
  const out = h('span', { class: 'slider-val' }, formatter ? formatter(value) : `${value}${suffix}`);
  const input = withUndo(h('input', {
    type: 'range', min: String(min), max: String(max), step: String(step), value: String(value),
    oninput: (e) => {
      const v = Number(e.target.value);
      out.textContent = formatter ? formatter(v) : `${fmtNum(v)}${suffix}`;
      onInput(v);
    },
  }));
  return h('div', { class: 'slider-field' },
    h('div', { class: 'slider-top' }, h('span', { class: 'field-label' }, label), out),
    input,
  );
}

function fmtNum(v) {
  return Math.abs(v) >= 10 ? String(Math.round(v)) : String(Math.round(v * 100) / 100);
}

function select({ label, value, options, onChange }) {
  const sel = withUndo(h('select', {
    onchange: (e) => onChange(e.target.value),
  }, Object.entries(options).map(([k, v]) => h('option', { value: k, selected: k === value }, v))));
  return field(label, sel);
}

function colorField({ label, value, onChange }) {
  const wrap = h('div', { class: 'color-field' },
    h('input', { type: 'color', value: normalizeColor(value), oninput: (e) => onChange(e.target.value) }),
    h('input', {
      type: 'text', class: 'color-text', value: value === 'transparent' ? 'transparente' : value,
      onchange: (e) => onChange(e.target.value.trim()),
    }),
  );
  wrap.querySelector('input[type=color]').addEventListener('pointerdown', () => savePoint());
  wrap.querySelector('.color-text').addEventListener('focus', () => savePoint());
  return field(label, wrap);
}

function normalizeColor(c) {
  if (!c || c === 'transparent') return '#000000';
  if (/^#[0-9a-f]{6}$/i.test(c)) return c;
  if (/^#[0-9a-f]{3}$/i.test(c)) return '#' + c.slice(1).split('').map((x) => x + x).join('');
  return '#ffffff';
}

function numberField({ label, value, min, max, step, onChange, suffix = '' }) {
  return field(label, h('div', { class: 'num-wrap' },
    h('input', {
      type: 'number', min: String(min), max: String(max), step: String(step), value: String(Math.round(value * 100) / 100),
      onchange: (e) => {
        const v = Number(e.target.value);
        if (!Number.isFinite(v)) return;
        onChange(clamp(v, min, max));
      },
    }),
    suffix ? h('span', { class: 'num-suffix' }, suffix) : null,
  ));
}

function toggleField({ label, value, onChange }) {
  const input = h('input', { type: 'checkbox', checked: !!value, onchange: (e) => onChange(e.target.checked) });
  input.addEventListener('pointerdown', () => savePoint());
  return h('label', { class: 'toggle-field' }, input, h('span', {}, label));
}

function button(text, onClick, variant = '') {
  return h('button', { class: `btn ${variant}`, onclick: onClick }, text);
}

/* --------------------------------- projeto -------------------------------- */

const RES_PRESETS = {
  '1920x1080': '16:9 — Full HD (1920×1080)',
  '1080x1920': '9:16 — Vertical (1080×1920)',
  '1080x1080': '1:1 — Quadrado (1080×1080)',
  '1280x720': '16:9 — HD (1280×720)',
  '3840x2160': '16:9 — 4K (3840×2160)',
  '720x1280': '9:16 — Vertical leve (720×1280)',
};

function buildProjectPanel() {
  const p = state.project;
  const nameInput = h('input', {
    type: 'text', value: p.name, class: 'text-input',
    onchange: (e) => setProject({ name: e.target.value || 'Meu projeto' }),
  });
  nameInput.addEventListener('focus', () => savePoint());

  const resKey = `${p.width}x${p.height}`;
  const options = { ...RES_PRESETS };
  if (!options[resKey]) options[resKey] = `Personalizado (${p.width}×${p.height})`;

  const totalClips = state.tracks.reduce((n, t) => n + t.clips.length, 0);

  return [
    h('div', { class: 'panel-head' },
      h('div', {}, h('h2', {}, 'Projeto'),
        h('p', { class: 'muted' }, 'Nada selecionado — ajustes gerais do vídeo')),
    ),
    section('Geral',
      field('Nome', nameInput),
      select({
        label: 'Formato', value: resKey, options,
        onChange: (v) => {
          const [w, hh] = v.split('x').map(Number);
          setProject({ width: w, height: hh });
        },
      }),
      field('Taxa de quadros', h('select', {
        onchange: (e) => setProject({ fps: Number(e.target.value) }),
      }, [24, 25, 30, 60].map((f) => h('option', { value: String(f), selected: f === p.fps }, `${f} fps`)))),
      colorField({ label: 'Cor de fundo', value: p.bg, onChange: (v) => setProject({ bg: v }) }),
    ),
    section('Conteúdo',
      h('div', { class: 'stat-row' }, h('span', {}, 'Clipes'), h('strong', {}, String(totalClips))),
      h('div', { class: 'stat-row' }, h('span', {}, 'Faixas'), h('strong', {}, String(state.tracks.length))),
      h('div', { class: 'stat-row' }, h('span', {}, 'Mídias'), h('strong', {}, String(mediaStore.size))),
      totalClips === 0 ? h('p', { class: 'empty-note' }, 'Importe vídeos, imagens ou músicas pela aba Mídia e arraste para a linha do tempo.') : null,
    ),
    section('Atalhos',
      shortcutList(),
    ),
  ];
}

function shortcutList() {
  const items = [
    ['Espaço', 'Reproduzir / pausar'],
    ['S', 'Dividir clipe'],
    ['Ctrl + Z', 'Desfazer'],
    ['Ctrl + Shift + Z', 'Refazer'],
    ['Ctrl + D', 'Duplicar'],
    ['Delete', 'Excluir'],
    ['← / →', 'Mover 1 quadro'],
    ['Shift + ← / →', 'Mover 1 segundo'],
    ['Ctrl + scroll', 'Zoom da linha do tempo'],
  ];
  return h('div', { class: 'shortcuts' }, items.map(([k, v]) => h('div', { class: 'shortcut' },
    h('kbd', {}, k), h('span', {}, v))));
}

/* ---------------------------------- clipe --------------------------------- */

function buildClipPanel(clip, track) {
  const media = clip.mediaId ? mediaById(clip.mediaId) : null;
  const typeLabel = { video: 'Vídeo', image: 'Imagem', audio: 'Áudio', text: 'Texto' }[clip.type] || 'Clipe';
  const dur = clipDuration(clip);

  const head = h('div', { class: 'panel-head' },
    h('div', {},
      h('h2', {}, clip.name),
      h('p', { class: 'muted' }, `${typeLabel} · ${fmtDur(dur)} · faixa ${track.name}`),
    ),
    h('div', { class: 'panel-actions' },
      button('Dividir', () => {
        const ok = splitClip(clip.id, state.time);
        if (!ok) splitClip(clip.id, clip.start + dur / 2);
      }, 'ghost'),
      button('Duplicar', () => duplicateClip(clip.id), 'ghost'),
      button('Excluir', () => removeClip(clip.id), 'danger'),
    ),
  );

  const sections = [head, section('Tempo',
    numberField({
      label: 'Início', value: clip.start, min: 0, max: 3600, step: 0.05, suffix: 's',
      onChange: (v) => { savePoint(); clip.start = v; emitChange('structure'); },
    }),
    numberField({
      label: 'Duração', value: dur, min: 0.1, max: 3600, step: 0.05, suffix: 's',
      onChange: (v) => { savePoint(); clip.length = v * (clip.speed || 1); emitChange('structure'); },
    }),
    media ? h('div', { class: 'stat-row' }, h('span', {}, 'Trecho usado'),
      h('strong', {}, `${fmtDur(mediaTimeAt(clip, clip.start))} → ${fmtDur(mediaTimeAt(clip, clipEnd(clip) - 0.01))}`)) : null,
    clip.type !== 'image' && clip.type !== 'text' ? slider({
      label: 'Velocidade', value: clip.speed || 1, min: 0.25, max: 3, step: 0.05, suffix: '×',
      formatter: (v) => `${v.toFixed(2)}×`,
      onInput: (v) => { clip.speed = v; emitChange('structure'); },
    }) : null,
  )];

  if (clip.type === 'text') sections.push(buildTextSection(clip));
  if (clip.type === 'audio') sections.push(buildAudioSection(clip, track));
  if (clip.type === 'video' || clip.type === 'image') sections.push(buildVisualSection(clip));

  sections.push(section('Animação',
    select({
      label: 'Entrada', value: clip.animIn, options: ANIMATIONS,
      onChange: (v) => { savePoint(); clip.animIn = v; emitChange('prop'); },
    }),
    select({
      label: 'Saída', value: clip.animOut, options: ANIMATIONS,
      onChange: (v) => { savePoint(); clip.animOut = v; emitChange('prop'); },
    }),
    slider({
      label: 'Duração da animação', value: clip.animDur, min: 0.1, max: 3, step: 0.05, suffix: 's',
      onInput: (v) => { clip.animDur = v; emitChange('prop'); },
    }),
  ));

  if (clip.type !== 'text') sections.push(section('Transformação', ...transformControls(clip)));
  sections.push(section('Informações',
    media ? h('div', { class: 'stat-row' }, h('span', {}, 'Arquivo'), h('strong', { class: 'ellipsis' }, media.name)) : null,
    media ? h('div', { class: 'stat-row' }, h('span', {}, 'Resolução'), h('strong', {}, media.width ? `${media.width}×${media.height}` : '—')) : null,
    media ? h('div', { class: 'stat-row' }, h('span', {}, 'Tamanho'), h('strong', {}, fmtBytes(media.size))) : null,
    h('div', { class: 'stat-row' }, h('span', {}, 'ID'), h('strong', { class: 'mono' }, clip.id.slice(-6))),
  ));

  return sections;
}

function transformControls(clip) {
  const tr = clip.transform;
  return [
    slider({
      label: 'Escala', value: tr.scale, min: 0.05, max: 3, step: 0.01,
      formatter: (v) => `${Math.round(v * 100)}%`,
      onInput: (v) => { tr.scale = v; emitChange('prop'); },
    }),
    slider({
      label: 'Rotação', value: tr.rotate, min: -180, max: 180, step: 1, suffix: '°',
      onInput: (v) => { tr.rotate = v; emitChange('prop'); },
    }),
    slider({
      label: 'Opacidade', value: tr.opacity, min: 0, max: 1, step: 0.01,
      formatter: (v) => `${Math.round(v * 100)}%`,
      onInput: (v) => { tr.opacity = v; emitChange('prop'); },
    }),
    slider({
      label: 'Posição X', value: tr.x, min: -state.project.width, max: state.project.width, step: 1, suffix: 'px',
      onInput: (v) => { tr.x = v; emitChange('prop'); },
    }),
    slider({
      label: 'Posição Y', value: tr.y, min: -state.project.height, max: state.project.height, step: 1, suffix: 'px',
      onInput: (v) => { tr.y = v; emitChange('prop'); },
    }),
    button('Centralizar', () => {
      savePoint();
      tr.x = 0; tr.y = 0; tr.scale = 1; tr.rotate = 0;
      emitChange('prop');
      build(true);
    }, 'ghost full'),
  ];
}

function buildVisualSection(clip) {
  const chipButtons = Object.entries(FILTER_PRESETS).map(([key, preset]) => {
    const btn = h('button', {
      class: `chip ${clip.filter === key ? 'active' : ''}`,
      onclick: () => {
        savePoint();
        clip.filter = key;
        chipButtons.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        emitChange('prop');
      },
    }, preset.label);
    return btn;
  });
  const chips = h('div', { class: 'chips' }, chipButtons);

  return section('Imagem',
    clip.type === 'video' || clip.type === 'image' ? select({
      label: 'Encaixe', value: clip.fit, options: {
        cover: 'Preencher (cortar)', contain: 'Conter (barras)', fill: 'Esticar', original: 'Tamanho original',
      },
      onChange: (v) => { savePoint(); clip.fit = v; emitChange('prop'); },
    }) : null,
    h('div', { class: 'field-label', style: { marginBottom: '6px' } }, 'Filtro'),
    chips,
    slider({
      label: 'Brilho', value: clip.adjust.brightness, min: 0.2, max: 2, step: 0.01,
      formatter: (v) => `${Math.round(v * 100)}%`,
      onInput: (v) => { clip.adjust.brightness = v; emitChange('prop'); },
    }),
    slider({
      label: 'Contraste', value: clip.adjust.contrast, min: 0.4, max: 2, step: 0.01,
      formatter: (v) => `${Math.round(v * 100)}%`,
      onInput: (v) => { clip.adjust.contrast = v; emitChange('prop'); },
    }),
    slider({
      label: 'Saturação', value: clip.adjust.saturation, min: 0, max: 2.5, step: 0.01,
      formatter: (v) => `${Math.round(v * 100)}%`,
      onInput: (v) => { clip.adjust.saturation = v; emitChange('prop'); },
    }),
    slider({
      label: 'Matiz', value: clip.adjust.hue, min: -180, max: 180, step: 1, suffix: '°',
      onInput: (v) => { clip.adjust.hue = v; emitChange('prop'); },
    }),
    slider({
      label: 'Desfoque', value: clip.adjust.blur, min: 0, max: 14, step: 0.1, suffix: 'px',
      onInput: (v) => { clip.adjust.blur = v; emitChange('prop'); },
    }),
    slider({
      label: 'Vinheta', value: clip.adjust.vignette, min: 0, max: 1, step: 0.01,
      formatter: (v) => `${Math.round(v * 100)}%`,
      onInput: (v) => { clip.adjust.vignette = v; emitChange('prop'); },
    }),
    isDefaultAdjust(clip.adjust) ? null : button('Redefinir ajustes', () => {
      savePoint();
      clip.adjust = { brightness: 1, contrast: 1, saturation: 1, hue: 0, blur: 0, vignette: 0 };
      clip.filter = 'none';
      build(true);
      emitChange('prop');
    }, 'ghost full'),
  );
}

function isDefaultAdjust(a) {
  return a.brightness === 1 && a.contrast === 1 && a.saturation === 1 && !a.hue && !a.blur && !a.vignette;
}

const FONTS = {
  '"Inter", "Segoe UI", system-ui, sans-serif': 'Inter / Sistema',
  'Georgia, "Times New Roman", serif': 'Georgia (serifada)',
  '"Courier New", monospace': 'Courier (mono)',
  'Impact, "Arial Black", sans-serif': 'Impact (grossa)',
  '"Trebuchet MS", sans-serif': 'Trebuchet',
  'Verdana, Geneva, sans-serif': 'Verdana',
  '"Comic Sans MS", cursive': 'Comic Sans',
};

function buildTextSection(clip) {
  const t = clip.text;
  const area = withUndo(h('textarea', {
    class: 'text-area', rows: '3', value: t.content,
    oninput: (e) => { t.content = e.target.value; emitChange('prop'); },
  }));
  area.value = t.content;

  const bgToggle = h('input', {
    type: 'checkbox', checked: t.bg !== 'transparent',
    onchange: (e) => {
      savePoint();
      t.bg = e.target.checked ? '#000000' : 'transparent';
      emitChange('prop');
      build(true);
    },
  });

  return section('Texto',
    area,
    h('div', { class: 'quick-row' },
      h('button', {
        class: 'chip', onclick: () => { savePoint(); t.size = Math.round(state.project.height * 0.1); t.weight = 800; emitChange('prop'); build(true); },
      }, 'Título'),
      h('button', {
        class: 'chip', onclick: () => { savePoint(); t.size = Math.round(state.project.height * 0.05); t.weight = 600; emitChange('prop'); build(true); },
      }, 'Subtítulo'),
      h('button', {
        class: 'chip', onclick: () => { savePoint(); t.bg = '#ffffff'; t.color = '#111111'; t.size = Math.round(state.project.height * 0.05); emitChange('prop'); build(true); },
      }, 'Legenda'),
      h('button', {
        class: 'chip', onclick: () => { savePoint(); t.bg = 'transparent'; t.color = '#111111'; t.stroke = 0; t.weight = 900; emitChange('prop'); build(true); },
      }, 'Destaque'),
    ),
    select({
      label: 'Fonte', value: t.family, options: FONTS,
      onChange: (v) => { savePoint(); t.family = v; emitChange('prop'); },
    }),
    slider({
      label: 'Tamanho', value: t.size, min: 12, max: 400, step: 1, suffix: 'px',
      onInput: (v) => { t.size = v; emitChange('prop'); },
    }),
    select({
      label: 'Peso', value: String(t.weight), options: { '300': 'Leve', '400': 'Normal', '600': 'Semibold', '700': 'Bold', '800': 'Extra', '900': 'Preto' },
      onChange: (v) => { savePoint(); t.weight = Number(v); emitChange('prop'); },
    }),
    colorField({ label: 'Cor do texto', value: t.color, onChange: (v) => { t.color = v; emitChange('prop'); } }),
    h('label', { class: 'toggle-field' }, bgToggle, h('span', {}, 'Fundo do texto')),
    t.bg !== 'transparent' ? colorField({ label: 'Cor do fundo', value: t.bg, onChange: (v) => { t.bg = v; emitChange('prop'); } }) : null,
    slider({
      label: 'Borda', value: t.stroke, min: 0, max: 16, step: 0.5, suffix: 'px',
      onInput: (v) => { t.stroke = v; emitChange('prop'); },
    }),
    t.stroke ? colorField({ label: 'Cor da borda', value: t.strokeColor, onChange: (v) => { t.strokeColor = v; emitChange('prop'); } }) : null,
    toggleField({ label: 'Sombra', value: t.shadow, onChange: (v) => { savePoint(); t.shadow = v; emitChange('prop'); } }),
    select({
      label: 'Alinhamento', value: t.align, options: { center: 'Centro', left: 'Esquerda', right: 'Direita' },
      onChange: (v) => { savePoint(); t.align = v; emitChange('prop'); },
    }),
    slider({
      label: 'Posição X', value: Math.round(t.x * 100), min: 0, max: 100, step: 1, suffix: '%',
      onInput: (v) => { t.x = v / 100; emitChange('prop'); },
    }),
    slider({
      label: 'Posição Y', value: Math.round(t.y * 100), min: 0, max: 100, step: 1, suffix: '%',
      onInput: (v) => { t.y = v / 100; emitChange('prop'); },
    }),
    slider({
      label: 'Largura máx.', value: Math.round(t.maxWidth * 100), min: 20, max: 100, step: 1, suffix: '%',
      onInput: (v) => { t.maxWidth = v / 100; emitChange('prop'); },
    }),
    slider({
      label: 'Espaço entre linhas', value: t.lineHeight, min: 0.8, max: 2, step: 0.05, suffix: '',
      onInput: (v) => { t.lineHeight = v; emitChange('prop'); },
    }),
  );
}

function buildAudioSection(clip, track) {
  return section('Áudio',
    slider({
      label: 'Volume', value: clip.volume, min: 0, max: 2, step: 0.01,
      formatter: (v) => `${Math.round(v * 100)}%`,
      onInput: (v) => { clip.volume = v; emitChange('prop'); },
    }),
    toggleField({
      label: 'Silenciar esta faixa', value: track.muted,
      onChange: (v) => { savePoint(); track.muted = v; emitChange('view'); },
    }),
    h('p', { class: 'empty-note' }, 'O volume é aplicado na prévia e na exportação.'),
  );
}
