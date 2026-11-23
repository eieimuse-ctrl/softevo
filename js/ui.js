/* SoftEvo — ui.js : 小さなUIヘルパー + ドット絵の描画 */
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
}

// ════════════════════════════════════════════════════════════
//  パレット (SoftEvo 36色)
//  夜の研究所の紺 9段 + 地面のティール + 金・橙(興奮)・青(抑制)・桃・紫・赤・若草 の明暗
// ════════════════════════════════════════════════════════════
export const PAL = {
  ink: '#05060e', n1: '#0b0f24', n2: '#131a3a', n3: '#1e2a55', n4: '#304377', n5: '#4c64a3', n6: '#8197cf', n7: '#c3cff0', white: '#f5f7ff',
  t0: '#0b2f2c', t1: '#136152', t2: '#20a07c', t3: '#43e0a8', t4: '#b0f7d6',
  g0: '#4a3207', g1: '#b07d10', g2: '#ffd166', g3: '#fff4b8',
  o0: '#4a1f08', o1: '#a8501a', o2: '#ff9e3d',
  b0: '#0c2a52', b1: '#1c64b4', b2: '#46bfff',
  p0: '#4d1240', p1: '#a8287e', p2: '#ff62d0',
  v0: '#2c1858', v1: '#6a3fc0', v2: '#b88cff',
  r0: '#4f0d1d', r1: '#b0213e', r2: '#ff5268',
  l0: '#24400c', l1: '#5f9a1c', l2: '#b8f25c',
};
const P = PAL;
/** 色相ごとの明暗 [暗, 中, 明] */
const RAMPS = {
  pink: [P.p0, P.p1, P.p2], lime: [P.l0, P.l1, P.l2], blue: [P.b0, P.b1, P.b2], orange: [P.o0, P.o1, P.o2],
  teal: [P.t1, P.t2, P.t3], purple: [P.v0, P.v1, P.v2], gold: [P.g0, P.g1, P.g2], red: [P.r0, P.r1, P.r2],
};
const RAMP_HUE = [['red', 355], ['orange', 25], ['gold', 45], ['lime', 90], ['teal', 160], ['blue', 210], ['purple', 265], ['pink', 315]];
const MUSCLE_RAMPS = ['pink', 'lime', 'blue', 'orange', 'teal', 'purple', 'gold', 'red'];
/** 筋肉 j の色。level 0=暗 (伸びている) 1=中 2=明 (縮んでいる) */
export const muscleColor = (j, level = 2) => RAMPS[MUSCLE_RAMPS[j % MUSCLE_RAMPS.length]][level];
/** 任意の色相 (0-360) → いちばん近い色相の明暗 */
export function hueColor(h, level = 2) {
  h = ((h % 360) + 360) % 360;
  let best = RAMP_HUE[0][0], bd = 1e9;
  for (const [name, c] of RAMP_HUE) { const d = Math.min(Math.abs(h - c), 360 - Math.abs(h - c)); if (d < bd) { bd = d; best = name; } }
  return RAMPS[best][level];
}
/** 値 -1..1 → 色の段階 (負: 青, 正: 橙)。小さい値は null */
export function signedColor(v, floor = 0.12) {
  const t = Math.abs(v);
  if (t < floor) return null;
  const r = v >= 0 ? RAMPS.orange : RAMPS.blue;
  return t < 0.4 ? r[0] : t < 0.7 ? r[1] : r[2];
}
export const POS = P.o2, NEG = P.b2;

// ─── パレットへの丸め (32^3 の早見表) ───
const PAL_RGB = Object.values(PAL).map(h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]);
let LUT = null;
function lut() {
  if (LUT) return LUT;
  LUT = new Uint32Array(32768);
  for (let r = 0; r < 32; r++) for (let g = 0; g < 32; g++) for (let b = 0; b < 32; b++) {
    const R = r * 8 + 4, G = g * 8 + 4, B = b * 8 + 4;
    let best = 0, bd = Infinity;
    for (let i = 0; i < PAL_RGB.length; i++) {
      const [pr, pg, pb] = PAL_RGB[i], rm = (R + pr) / 2, dr = R - pr, dg = G - pg, db = B - pb;
      const d = (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
      if (d < bd) { bd = d; best = i; }
    }
    const [pr, pg, pb] = PAL_RGB[best];
    LUT[(r << 10) | (g << 5) | b] = ((255 << 24) | (pb << 16) | (pg << 8) | pr) >>> 0;
  }
  return LUT;
}
/** 画素をすべてパレットの色にそろえる (半透明は透明か不透明に) */
function quantize(c, w, h) {
  const img = c.getImageData(0, 0, w, h), d = new Uint32Array(img.data.buffer), L = lut();
  for (let i = 0; i < d.length; i++) {
    const v = d[i];
    if ((v >>> 24) < 128) { d[i] = 0; continue; }
    d[i] = L[((v & 0xf8) << 7) | ((v >> 6) & 0x3e0) | ((v >> 19) & 0x1f)];
  }
  c.putImageData(img, 0, 0);
}
// 文字の色もパレットに (暗い背景の上に置いた色として)
const probe = document.createElement('canvas').getContext('2d');
const cssCache = new Map();
export function snapCss(style, alpha = 1) {
  if (typeof style !== 'string') return style;
  const key = style + '|' + alpha;
  let v = cssCache.get(key);
  if (v) return v;
  probe.fillStyle = '#000'; probe.fillStyle = style;
  const n = probe.fillStyle;
  let r, g, b, a = 1;
  if (n[0] === '#') { r = parseInt(n.slice(1, 3), 16); g = parseInt(n.slice(3, 5), 16); b = parseInt(n.slice(5, 7), 16); }
  else { const m = n.match(/[\d.]+/g); r = +m[0]; g = +m[1]; b = +m[2]; if (m[3] != null) a = +m[3]; }
  a *= alpha;
  const [br, bg, bb] = PAL_RGB[1];
  r = r * a + br * (1 - a); g = g * a + bg * (1 - a); b = b * a + bb * (1 - a);
  const p = lut()[((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)];
  v = `rgb(${p & 255},${(p >> 8) & 255},${(p >> 16) & 255})`;
  cssCache.set(key, v);
  return v;
}

// ════════════════════════════════════════════════════════════
//  ピクセル描画
//  ・描画は「低解像度の裏キャンバス」に (1ドット = PX CSSピクセル)。呼び出し側は今まで通り CSS px で描く
//  ・描き終わったら (同じタスクの終わりに) パレットへ丸めて、くっきり拡大して表に出す
//  ・文字だけは表の高解像度キャンバスに DotGothic16 で描き直す (小さな日本語も読めるように)
// ════════════════════════════════════════════════════════════
export const FONT = '"DotGothic16", "Hiragino Kaku Gothic ProN", "Noto Sans JP", monospace';
const MIN_LINE = 1.25; // 線は最低これだけの太さ (ドット)。細すぎて途切れないように
const pending = new Set();
let flushQueued = false;
const PROTO = CanvasRenderingContext2D.prototype;
const FONT_PROP = Object.getOwnPropertyDescriptor(PROTO, 'font');
export const mapFont = v => { const m = /([\d.]+)px/.exec(v); return `${m ? Math.max(10, +m[1]) : 12}px ${FONT}`; };

function patchCtx(c, st) {
  // 文字のサイズはそのまま、書体だけドット文字に
  Object.defineProperty(c, 'font', { configurable: true, get() { return FONT_PROP.get.call(this); }, set(v) { FONT_PROP.set.call(this, mapFont(v)); } });
  c.stroke = function (path) {
    const m = this.getTransform(), s = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1, lw = this.lineWidth;
    if (lw * s < MIN_LINE) this.lineWidth = MIN_LINE / s;
    if (path) PROTO.stroke.call(this, path); else PROTO.stroke.call(this);
    this.lineWidth = lw;
  };
  if (!st) return;
  // 文字は記録しておき、表に出す時に高解像度で描く
  const text = stroke => function (s, x, y, mw) {
    st.texts.push({
      s: String(s), x, y, mw, stroke, m: this.getTransform(), font: this.font, align: this.textAlign, base: this.textBaseline,
      style: snapCss(stroke ? this.strokeStyle : this.fillStyle, this.globalAlpha), lw: this.lineWidth, lj: this.lineJoin, clip: st.clip,
    });
  };
  c.fillText = text(false);
  c.strokeText = text(true);
  // 矩形のクリップ (レーンなど) は文字にも効かせる
  c.save = function () { st.clipStack.push(st.clip); PROTO.save.call(this); };
  c.restore = function () { st.clip = st.clipStack.length ? st.clipStack.pop() : null; PROTO.restore.call(this); };
  c.beginPath = function () { st.lastRect = null; PROTO.beginPath.call(this); };
  c.rect = function (x, y, w, h) {
    const m = this.getTransform();
    const xs = [x, x + w].flatMap(px => [y, y + h].map(py => [m.a * px + m.c * py + m.e, m.b * px + m.d * py + m.f]));
    st.lastRect = [Math.min(...xs.map(p => p[0])), Math.min(...xs.map(p => p[1])), Math.max(...xs.map(p => p[0])), Math.max(...xs.map(p => p[1]))];
    PROTO.rect.call(this, x, y, w, h);
  };
  c.clip = function (...a) {
    if (st.lastRect) {
      const r = st.lastRect, k = st.clip;
      st.clip = k ? [Math.max(k[0], r[0]), Math.max(k[1], r[1]), Math.min(k[2], r[2]), Math.min(k[3], r[3])] : r;
    }
    PROTO.clip.apply(this, a);
  };
}

function present(st) {
  st.queued = false;
  const { canvas, lo, lctx, k } = st;
  quantize(lctx, lo.width, lo.height);
  const h = canvas.getContext('2d');
  h.setTransform(1, 0, 0, 1, 0, 0);
  h.imageSmoothingEnabled = false;
  h.clearRect(0, 0, canvas.width, canvas.height);
  h.drawImage(lo, 0, 0, lo.width * k, lo.height * k);
  for (const t of st.texts) {
    h.save();
    if (t.clip) { h.beginPath(); h.rect(t.clip[0] * k, t.clip[1] * k, (t.clip[2] - t.clip[0]) * k, (t.clip[3] - t.clip[1]) * k); h.clip(); }
    const m = t.m;
    h.setTransform(m.a * k, m.b * k, m.c * k, m.d * k, m.e * k, m.f * k);
    h.font = t.font; h.textAlign = t.align; h.textBaseline = t.base;
    if (t.stroke) { h.strokeStyle = t.style; h.lineWidth = t.lw; h.lineJoin = t.lj; if (t.mw != null) h.strokeText(t.s, t.x, t.y, t.mw); else h.strokeText(t.s, t.x, t.y); }
    else { h.fillStyle = t.style; if (t.mw != null) h.fillText(t.s, t.x, t.y, t.mw); else h.fillText(t.s, t.x, t.y); }
    h.restore();
  }
}

function flush() {
  flushQueued = false;
  for (const st of pending) present(st);
  pending.clear();
}

/**
 * キャンバスを用意して {ctx, w, h, px} を返す。ctx は CSS px で描ける (実体は 1/px の低解像度)。
 * opts.px: 1ドットの大きさ (CSS px)。省略時は幅で決める (広い画面ほど粗く)
 */
export function fitCanvas(canvas, opts = {}) {
  const r = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
  const px = opts.px || (w >= 600 ? 3 : 2);
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const k = Math.max(1, Math.round(px * dpr));
  let st = canvas.__px;
  if (!st) {
    const lo = document.createElement('canvas');
    st = canvas.__px = { canvas, lo, lctx: lo.getContext('2d', { willReadFrequently: true }), texts: [], clip: null, clipStack: [], lastRect: null, queued: false, k };
    lo.__st = st;
    patchCtx(st.lctx, st);
    canvas.style.imageRendering = 'pixelated';
  }
  const lw = Math.ceil(w / px), lh = Math.ceil(h / px);
  if (st.lo.width !== lw || st.lo.height !== lh) { st.lo.width = lw; st.lo.height = lh; }
  if (canvas.width !== lw * k || canvas.height !== lh * k) { canvas.width = lw * k; canvas.height = lh * k; }
  st.k = k; st.px = px;
  st.texts.length = 0; st.clip = null; st.clipStack.length = 0;
  const c = st.lctx;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, lw, lh);
  c.setTransform(1 / px, 0, 0, 1 / px, 0, 0);
  c.imageSmoothingEnabled = false;
  c.globalAlpha = 1;
  if (!st.queued) {
    st.queued = true; pending.add(st);
    if (!flushQueued) { flushQueued = true; queueMicrotask(flush); }
  }
  return { ctx: c, w, h, px };
}

// ─── ドット絵の小道具 (どれも「ドット座標」= 変換なしで使う) ───
/** いまの変換で (x, y) がどのドットに来るか */
export function toDot(ctx, x, y, m = ctx.getTransform()) { return [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]; }
/** ドット座標で描くために変換を外す (戻すときは ctx.restore()) */
export function dotSpace(ctx) { ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); }
/** 半径 r ドットの円 (きっちりしたドット円) */
export function pixelDisc(ctx, cx, cy, r, style) {
  cx = Math.round(cx); cy = Math.round(cy); r = Math.max(0, Math.round(r));
  ctx.fillStyle = style;
  for (let dy = -r; dy <= r; dy++) {
    const half = Math.floor(Math.sqrt((r + 0.5) * (r + 0.5) - dy * dy));
    ctx.fillRect(cx - half, cy + dy, half * 2 + 1, 1);
  }
}
/** 市松模様 (ドットで表す半透明)。pattern.setTransform で位置合わせして使う */
const checkers = new Map();
export function checker(ctx, color, dense = false) {
  const key = color + dense;
  let c = checkers.get(key);
  if (!c) {
    c = document.createElement('canvas'); c.width = c.height = 2;
    const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, 1, 1); g.fillRect(1, 1, 1, 1);
    if (dense) g.fillRect(1, 0, 1, 1);
    checkers.set(key, c);
  }
  return ctx.createPattern(c, 'repeat');
}

let toastTimer = null;
export function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

export function confirmDialog(title, body, okLabel = 'OK', danger = false) {
  return new Promise(resolve => {
    const back = el('div', { class: 'modal-back' });
    const done = v => { back.remove(); resolve(v); };
    const box = el('div', { class: 'modal' },
      el('h3', {}, title),
      el('p', {}, body),
      el('div', { class: 'modal-actions' },
        el('button', { class: 'btn ghost', onclick: () => done(false) }, 'キャンセル'),
        el('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => done(true) }, okLabel)));
    back.append(box);
    back.addEventListener('pointerdown', e => { if (e.target === back) done(false); });
    document.body.append(back);
  });
}

/** 1行の文字入力 (ブラウザの prompt の代わり)。キャンセルなら null */
export function askText(title, { value = '', placeholder = '', max = 16, okLabel = '決定', note = '' } = {}) {
  return new Promise(resolve => {
    const back = el('div', { class: 'modal-back' });
    const input = el('input', { class: 'on-input ask-input', maxlength: max, placeholder, value, enterkeyhint: 'done' });
    const done = v => { back.remove(); resolve(v); };
    const ok = () => { const v = input.value.trim(); if (v) done(v.slice(0, max)); else input.focus(); };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') ok(); if (e.key === 'Escape') done(null); });
    back.append(el('div', { class: 'modal' },
      el('h3', {}, title),
      note ? el('p', { class: 'dim' }, note) : null,
      input,
      el('div', { class: 'modal-actions' },
        el('button', { class: 'btn ghost', onclick: () => done(null) }, 'キャンセル'),
        el('button', { class: 'btn primary', onclick: ok }, okLabel))));
    back.addEventListener('pointerdown', e => { if (e.target === back) done(null); });
    document.body.append(back);
    setTimeout(() => { input.focus(); input.select(); }, 30);
  });
}

export function infoDialog(title, html) {
  const back = el('div', { class: 'modal-back' });
  const box = el('div', { class: 'modal wide' }, el('h3', {}, title));
  const body = el('div', { class: 'modal-body' }); body.innerHTML = html;
  box.append(body, el('div', { class: 'modal-actions' }, el('button', { class: 'btn primary', onclick: () => back.remove() }, 'とじる')));
  back.append(box);
  back.addEventListener('pointerdown', e => { if (e.target === back) back.remove(); });
  document.body.append(back);
}

export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, t) => a + (b - a) * t;
