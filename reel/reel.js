/* =====================================================================
   Softevo Reels — 縦動画 (1080×1920 / 30fps) の画をつくる (v2: 台本 drop16・音ハメ)
   ---------------------------------------------------------------------
   ・Softevo の部品 (世界・生物・脳) を「スマホ 360×640 の画面 × 3倍」で描いて 1枚に合成する
   ・コマ番号 → シミュレーションの時刻 (エピソードの map) → 生物の姿。物理は決定論なので
     どのコマから描いても同じ画になる (巻き戻し・スロー・倍速も自由)
   ・カット・文字・揺れ・紙吹雪はすべて拍 (15コマ) の頭にそろえてある。曲は reel/music.mjs
   ・window.REEL.seek(i) で i コマ目を描く → reel/capture.mjs が PNG 連番と MP4 に
   ・Reels の UI に隠れる所 (上 250px・下・右下のボタン列) を避けてある
   ===================================================================== */
// 部品は 3 倍の解像度で描く (どの端末で開いても 1080×1920 にぴったり合成できるように)
Object.defineProperty(window, 'devicePixelRatio', { configurable: true, get: () => 3 });

import { Creature, brainLayout, groundY, DEFAULT_SETTINGS, FPS } from '../js/sim.js';
import { Camera, drawWorld, drawCreature } from '../js/world.js';
import { BrainView, BRAIN_TEXT_EN } from '../js/brainview.js';
import { fitCanvas, PAL, clamp, dotSpace } from '../js/ui.js';
import { b64ToF32 } from '../js/store.js';

const W = 1080, H = 1920, S = 3;
const FONT = '"DotGothic16", monospace';
// ─── レイアウト (px は 1080×1920 の座標) ───
const LAY = {
  title: 324,                                    // AI LEARNS TO WALK
  world: { x: 0, y: 354, w: 1080, h: 600 },      // 世界 (CSS 360×200)。上の 54px は進み具合のバー
  brain: { x: 42, y: 990, w: 888, h: 300 },      // 脳 (CSS 296×100)。右はボタンの列を空ける
  safe: { top: 250, bottom: 1280, right: 960 },  // Reels の UI に隠れる所 (目安)
};

const params = new URLSearchParams(location.search);
const CAPTURE = params.has('capture');
let guides = params.has('guides');
const ep = await (await fetch(params.get('ep') || 'episodes/ep001.json', { cache: 'no-store' })).json();
if (ep.format !== 'softevo-reel/2') throw new Error('このページは episode v2 用です。node reel/make-episode.mjs で作り直してください');
const bp = ep.blueprint, settings = { ...DEFAULT_SETTINGS, ...ep.settings };
const layout = brainLayout(bp, settings);
const env = { terrain: settings.terrain, objective: settings.objective, gravity: settings.gravity, friction: settings.friction, evalSeconds: settings.evalSeconds };
const VFPS = ep.fps, TOTAL = ep.frames, BEAT = ep.beat, A = ep.at, T = ep.texts, GOAL = ep.goal * 100, EVAL = settings.evalSeconds;
const genomes = Object.fromEntries(Object.entries(ep.genomes).map(([k, v]) => [k, b64ToF32(v)]));

// ─── 作業用キャンバス ───
const frame = document.getElementById('frame'), X = frame.getContext('2d');
const worldCv = document.getElementById('w-world'), brainCv = document.getElementById('w-brain'), coverCv = document.getElementById('w-cover');
const css = (cv, r) => { cv.style.width = `${r.w / S}px`; cv.style.height = `${r.h / S}px`; };
css(worldCv, LAY.world); css(brainCv, LAY.brain); css(coverCv, { w: 1080, h: 420 });
const brain = new BrainView(brainCv);
brain.text = BRAIN_TEXT_EN;
brain.setRun(layout);
const CW = LAY.world.w / S, CH = LAY.world.h / S; // 世界の CSS の大きさ

// ─── 軌跡: 1/60 秒ごとの姿を記録しておく (どの時刻でも、逆向きでも取り出せる) ───
const front = c => { let m = -Infinity; for (let i = 0; i < c.n; i++) if (c.x[i] > m) m = c.x[i]; return m; };
class Track {
  constructor(g) {
    const c = this.c = new Creature(bp, layout, g, env);
    this.base = { n: c.n, ea: c.ea, eb: c.eb, isMuscle: c.isMuscle, muscleEdge: c.muscleEdge, rx: c.rx, ry: c.ry, dir: 1, brain: true };
    this.nose0 = front(c);
    this.snaps = [];
    this.push();
  }
  push() {
    const c = this.c;
    this.snaps.push({ x: Float64Array.from(c.x), y: Float64Array.from(c.y), out: Float64Array.from(c.out), contact: Uint8Array.from(c.contact), vx: c.vx, vy: c.vy, tilt: c.tilt, acts: c.brain.acts.map(a => Float64Array.from(a)), cx: c.centroid()[0], nose: front(c) });
  }
  at(k) { k = Math.max(0, Math.floor(k)); while (this.snaps.length <= k) { this.c.step(); this.push(); } return this.snaps[k]; }
  /** 時刻 u (ステップ, 小数可) の姿。drawCreature にそのまま渡せる形 */
  pose(u) {
    const k = Math.max(0, Math.floor(u)), a = Math.max(0, u - k), P0 = this.at(k), P1 = a > 1e-6 ? this.at(k + 1) : P0;
    const p = Object.create(this.base);
    p.x = P1 === P0 ? P0.x : P0.x.map((v, i) => v + (P1.x[i] - v) * a);
    p.y = P1 === P0 ? P0.y : P0.y.map((v, i) => v + (P1.y[i] - v) * a);
    p.out = P0.out; p.contact = P0.contact; p.vx = P0.vx; p.vy = P0.vy; p.tilt = P0.tilt;
    p.nose = P0.nose + (P1.nose - P0.nose) * a;
    return p;
  }
  /** カメラ用: 重心を前後 0.2 秒でならす (揺れない・決定論) */
  camX(u) { const c = Math.round(u); let s = 0, n = 0; for (let k = Math.max(0, c - 12); k <= c + 12; k++) { s += this.at(k).cx; n++; } return s / n; }
}
const tracks = new Map();
const trackOf = key => { if (!tracks.has(key)) tracks.set(key, new Track(genomes[key])); return tracks.get(key); };

// ─── 台本 ───
const segs = ep.segments;
const segAt = f => segs.find(s => f >= s.from && f < s.to) || segs[segs.length - 1];
const seg = id => segs.find(s => s.id === id);
const smooth = p => p * p * (3 - 2 * p);
const easeOut = p => 1 - (1 - p) * (1 - p);
/** コマ → シミュレーションの秒 (折れ線。'inOut' はなめらかに) */
function mapAt(map, f) {
  for (let i = 1; i < map.length; i++) {
    const [fa, ta] = map[i - 1], [fb, tb, ease] = map[i];
    if (f <= fb || i === map.length - 1) {
      let p = clamp((f - fa) / (fb - fa), 0, 1);
      if (ease === 'inOut') p = smooth(p);
      return { t: ta + (tb - ta) * p, p };
    }
  }
  return { t: map[0][1], p: 0 };
}
const NOSE0 = trackOf(segs[0].genome).nose0;   // どの個体も同じ姿から始まる
const GOAL_X = NOSE0 + GOAL;
const meters = (tr, k) => Math.max(0, (tr.at(k).nose - tr.nose0) / 100);
// その場面より前に出た「いちばんの記録」(バーの白い目盛)
const RESULTS = segs.filter(s => ['hook', 'm1', 'm2', 'almost'].includes(s.id)).map(s => ({ to: s.to, d: meters(trackOf(s.genome), EVAL * FPS) }));
const bestBefore = sg => RESULTS.filter(r => r.to <= sg.from).reduce((m, r) => Math.max(m, r.d), -1);

// ─── 画角: 場面ごとに体がよく見える大きさ (幅は窓の42%、高さは空の部分に収まる) ───
function extents(tr, t0, t1) {
  let w = 0, h = 0;
  for (let k = Math.floor(t0 * FPS); k <= Math.ceil(t1 * FPS); k += 3) {
    const s = tr.at(k); let x0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < s.x.length; i++) { x0 = Math.min(x0, s.x[i]); x1 = Math.max(x1, s.x[i]); y1 = Math.max(y1, s.y[i]); }
    w = Math.max(w, x1 - x0); h = Math.max(h, y1 - groundY(env.terrain, s.cx));
  }
  return { w, h };
}
const GROUND = 0.76, HUDH = 20; // 地面は窓の上から76% / 上のバーは CSS 20px
const fitZoom = list => {
  let w = 0, h = 0;
  for (const s of list) { const tr = trackOf(s.genome), ts = s.map.map(m => m[1]); const e = extents(tr, Math.min(...ts), Math.max(...ts)); w = Math.max(w, e.w); h = Math.max(h, e.h); }
  return clamp(Math.min(CW * 0.42 / Math.max(30, w), (CH * GROUND - HUDH - 8) / Math.max(20, h)), 0.3, 3);
};
const ZH = fitZoom([seg('hook')]);
const ZM = fitZoom(['m1', 'm2', 'almost', 'final'].map(seg));
console.log(`zoom hook ${ZH.toFixed(2)} / main ${ZM.toFixed(2)}`);

// ─── 文字 ───
function text(str, x, y, size, color, align = 'center') {
  X.font = `${size}px ${FONT}`; X.textAlign = align; X.textBaseline = 'alphabetic';
  const d = Math.max(3, size / 16);
  X.fillStyle = PAL.ink; X.fillText(str, x + d, y + d);
  X.fillStyle = color; X.fillText(str, x, y);
}
function outlined(str, x, y, size, color, align = 'center') {
  X.font = `${size}px ${FONT}`; X.textAlign = align; X.textBaseline = 'alphabetic';
  X.lineJoin = 'round'; X.lineWidth = Math.max(9, size / 5); X.strokeStyle = PAL.ink; X.strokeText(str, x, y);
  X.fillStyle = color; X.fillText(str, x, y);
}
const width = (str, size) => { X.font = `${size}px ${FONT}`; return X.measureText(str).width; };
/** 拍に合わせて飛び出す文字 (k = 出てから何コマ目か) */
function pop(str, x, y, size, color, k, align = 'center', draw = outlined) {
  if (k < 0) return;
  const dy = [-15, -6, 2][k] ?? 0;
  draw(str, x, y + dy, size, k === 0 ? PAL.white : color, align);
}

// 市松模様 (ドット絵の半透明)。1ドット = 3px / 6px
const pat = (color, dot = S) => {
  const c = document.createElement('canvas'); c.width = c.height = dot * 2;
  const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, dot, dot); g.fillRect(dot, dot, dot, dot);
  return X.createPattern(c, 'repeat');
};
const gridPat = (() => { const c = document.createElement('canvas'); c.width = c.height = 24; const g = c.getContext('2d'); g.fillStyle = PAL.n2; g.fillRect(0, 0, 6, 6); return X.createPattern(c, 'repeat'); })();
const CHK_INK = pat(PAL.ink), CHK_N7 = pat(PAL.n7), CHK_N4 = pat(PAL.n4), CHK_WHITE = pat(PAL.white, 6);

// ─── 世界の上に描く物 (ドット単位) ───
function drawGoal(ctx, cam, w, h, lit) {
  const s = ctx.getTransform().a;
  const X0 = Math.floor(cam.sx(GOAL_X, w) * s), G = Math.floor(cam.sy(groundY(env.terrain, GOAL_X), h) * s);
  if (X0 < -30 || X0 > w * s + 4) return;
  dotSpace(ctx);
  // ポールは空の6割まで (上の文字と重ならない)
  const ph = Math.min(Math.max(20, Math.round(110 * cam.zoom * s)), Math.round((G - (HUDH + 6) * s) * 0.6));
  // 地面のゴールライン (市松)
  for (let r = 0; r < 4; r++) for (let q = -1; q <= 1; q++) { ctx.fillStyle = (r + q + 8) % 2 ? PAL.ink : PAL.white; ctx.fillRect(X0 + q, G + r, 1, 1); }
  // ポールと旗 (ゴール後は市松の旗)
  ctx.fillStyle = PAL.white; ctx.fillRect(X0, G - ph, 1, ph);
  const fh = Math.max(8, Math.round(ph * 0.3)), fw = Math.round(fh * 1.5);
  for (let r = 0; r < fh; r++) {
    const len = Math.round(fw * (1 - Math.abs(r - (fh - 1) / 2) / (fh / 2 + 0.5)));
    for (let q = 0; q < len; q++) { ctx.fillStyle = lit && ((q >> 1) + (r >> 1)) % 2 ? PAL.white : PAL.g2; ctx.fillRect(X0 + 1 + q, G - ph + r, 1, 1); }
  }
  ctx.restore();
}
/** 惜しい! 鼻先と旗のすき間を赤い線で */
function drawGap(ctx, cam, w, h, nose) {
  const s = ctx.getTransform().a;
  const a = Math.round(cam.sx(nose, w) * s), b = Math.floor(cam.sx(GOAL_X, w) * s), G = Math.floor(cam.sy(groundY(env.terrain, GOAL_X), h) * s);
  if (b - a < 2) return;
  dotSpace(ctx);
  ctx.fillStyle = PAL.r2;
  ctx.fillRect(a, G - 3, b - a, 1);
  ctx.fillRect(a, G - 5, 1, 5); ctx.fillRect(b - 1, G - 5, 1, 5);
  ctx.restore();
}
// 紙吹雪 (ゴールの旗から。種で決まるので毎回同じ)
const CONF = (() => {
  let a = 0x9e3779b9; const r = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const cols = [PAL.g2, PAL.t3, PAL.r2, PAL.b2, PAL.p2, PAL.white, PAL.l2, PAL.o2];
  return Array.from({ length: 64 }, (_, i) => ({ vx: (r() - 0.5) * 700, vy: 300 + r() * 650, c: cols[i % cols.length], ph: (r() * 6) | 0, drag: 0.6 + r() * 0.8 }));
})();
function drawConfetti(ctx, cam, w, h, f) {
  const t = (f - A.drop) / VFPS;
  if (t < 0 || t > 2.6) return;
  const s = ctx.getTransform().a, gy = groundY(env.terrain, GOAL_X);
  dotSpace(ctx);
  for (const p of CONF) {
    const k = 1 - Math.exp(-p.drag * t);
    const x = GOAL_X + p.vx * k / p.drag, y = gy + 100 + p.vy * k / p.drag - 300 * t * t;
    if (y < gy + 2) continue;
    const Xd = Math.round(cam.sx(x, w) * s), Yd = Math.round(cam.sy(y, h) * s);
    const spin = ((f >> 1) + p.ph) % 3;
    ctx.fillStyle = p.c; ctx.fillRect(Xd, Yd, spin === 0 ? 2 : 1, spin === 2 ? 1 : 2);
  }
  ctx.restore();
}

// ─── 1コマを描く ───
const morph = new Float32Array(genomes[segs[0].genome].length);
const SILENT = [[A.timeUp, A.final], [A.slow, A.drop]]; // 曲が止まっている所 (拍で光らせない)
const onBeat = f => f % BEAT < 2 && !SILENT.some(([a, b]) => f >= a && f < b);
function shakeAt(f) {
  const hit = (f0, amp, n) => { const k = f - f0; return k >= 0 && k < n ? amp * (1 - k / n) * (k % 2 ? -1 : 1) : 0; };
  const bonk = ep.events.find(e => e.type === 'bonk');
  return Math.round(hit(A.drop, 24, 9) + (bonk ? hit(bonk.f, 12, 6) : 0));
}

async function renderFrame(i) {
  const f = clamp(Math.floor(i), 0, TOTAL - 1);
  const sg = segAt(f), tr = trackOf(sg.genome);
  const { t } = mapAt(sg.map, f), u = t * FPS;
  // 巻き戻しの進み (0 → 1)。画角・脳の重み・世代の数字をこれでそろえる
  const p = sg.id === 'cta' ? clamp(1 - t / sg.map[0][1], 0, 1) : 0;
  const P = tr.pose(u), snap = tr.at(Math.max(1, u)); // 脳は最初の判断 (1ステップ目) から見せる
  const dist = Math.max(0, (P.nose - tr.nose0) / 100);
  const k = f - sg.from;

  // カメラ
  let zoom = sg.id === 'hook' ? ZH : ZM, cx = tr.camX(u) + CW * 0.08 / zoom; // 生物は窓の42%に (前の旗が見える)
  if (sg.id === 'cta') zoom = ZM + (ZH - ZM) * p, cx = tr.camX(u) + CW * 0.08 / zoom;
  if (sg.id === 'almost' && f >= A.timeUp) { // 時間切れ: すき間に寄る
    const q = easeOut(clamp((f - A.timeUp) / 6, 0, 1));
    const mid = (P.nose + GOAL_X) / 2;
    zoom *= 1 + 0.3 * q; cx = cx + (mid - cx) * q;
  }
  if (f >= A.slow && f < A.drop) zoom *= 1 + 0.14 * smooth((f - A.slow) / (A.drop - A.slow)); // スローでじわっと寄る
  const cam = new Camera(); cam.zoom = zoom; cam.x = cx; cam.y = groundY(env.terrain, cx) + CH * (GROUND - 0.5) / zoom;

  // 世界と生物 (Softevo のドット描画)
  {
    const { ctx, w, h } = fitCanvas(worldCv, { px: 2 });
    drawWorld(ctx, cam, w, h, env.terrain, { startX: tr.nose0 });
    drawGoal(ctx, cam, w, h, f >= A.drop && f < A.cta);
    ctx.save(); cam.apply(ctx, w, h); drawCreature(ctx, P, {}); ctx.restore();
    if (sg.id === 'almost' && f >= A.timeUp) drawGap(ctx, cam, w, h, P.nose);
    drawConfetti(ctx, cam, w, h, f);
  }
  // 脳 (巻き戻しでは最終世代 → 第0世代のランダムな重みへ戻っていく)
  if (sg.morphTo) {
    const g0 = genomes[sg.genome], g1 = genomes[sg.morphTo];
    for (let j = 0; j < morph.length; j++) morph[j] = g0[j] + (g1[j] - g0[j]) * p;
    brain.setGenomes(morph, null);
  } else if (brain.genome !== genomes[sg.genome]) brain.setGenomes(genomes[sg.genome], null);
  brain.render(snap.acts, null, f / VFPS);
  await new Promise(r => setTimeout(r, 0)); // ドットにそろえて表に出るのを待つ

  // ─── 合成 ───
  X.imageSmoothingEnabled = false;
  X.fillStyle = PAL.n1; X.fillRect(0, 0, W, H);
  X.fillStyle = gridPat; X.fillRect(0, 0, W, H);
  const R = LAY.world, beat = onBeat(f);
  const sh = shakeAt(f);
  X.fillStyle = PAL.ink; X.fillRect(0, R.y - 12, W, R.h + 24);
  X.drawImage(worldCv, R.x + sh, R.y, R.w, R.h);
  X.fillStyle = beat ? PAL.n6 : PAL.n4; X.fillRect(0, R.y - 6, W, 6); X.fillRect(0, R.y + R.h, W, 6);
  // 脳の窓
  {
    const B = LAY.brain;
    X.fillStyle = PAL.ink; X.fillRect(B.x - 12, B.y - 12, B.w + 24, B.h + 24);
    X.fillStyle = beat ? PAL.n6 : PAL.n4; X.fillRect(B.x - 6, B.y - 6, B.w + 12, B.h + 12);
    X.fillStyle = PAL.ink; X.fillRect(B.x + B.w + 12, B.y, 12, B.h + 24); X.fillRect(B.x, B.y + B.h + 12, B.w + 24, 12);
    X.drawImage(brainCv, B.x, B.y, B.w, B.h);
  }
  // カットのちらつき (2コマ)
  if (['m1', 'm2', 'almost', 'final'].includes(sg.id) && k < 2) { X.fillStyle = k === 0 ? CHK_N7 : CHK_N4; X.fillRect(0, R.y, W, R.h); }
  // スロー: 左右を暗く
  if (f >= A.slow && f < A.drop) { X.fillStyle = CHK_INK; X.fillRect(0, R.y, 150, R.h); X.fillRect(W - 150, R.y, 150, R.h); }
  // ゴールの瞬間: 白く光る
  if (f >= A.drop && f < A.drop + 3) { X.fillStyle = f - A.drop < 2 ? PAL.white : CHK_WHITE; X.fillRect(0, R.y, W, R.h); }

  // 上の見出し (シリーズの番号つき)
  {
    const tag = `  ${ep.tag}`, wt = width(T.title, 64), wg = width(tag, 48), x = (W - wt - wg) / 2;
    text(T.title, x, LAY.title, 64, PAL.g2, 'left');
    text(tag, x + wt, LAY.title, 48, PAL.n6, 'left');
  }
  hud(f, sg, dist);
  // 世代 (世界の左上。カットのたびに拍に合わせて飛び出す)
  const GX = 42, GY = R.y + 146;
  if (f < A.result) {
    pop(`GEN ${sg.gen}`, GX, GY, 80, sg.id === 'final' ? PAL.g2 : PAL.white, sg.id === 'hook' ? 9 : k, 'left');
    const bonk = ep.events.find(e => e.type === 'bonk');
    if (sg.id === 'hook' && (!bonk || f < bonk.f)) outlined(T.hookSub, GX + 4, GY + 52, 40, PAL.t3, 'left');
  }

  // ─── 場面ごとの文字 ───
  const SY = R.y + 250, SY2 = R.y + 318; // 空の部分
  if (sg.id === 'hook') {
    const bonk = ep.events.find(e => e.type === 'bonk');
    if (bonk) pop(T.hookFail, W / 2, SY, 64, PAL.r2, f - bonk.f);
  }
  if (sg.id === 'almost' && f >= A.timeUp) { // 惜しい!: 世界はすき間を見せたいので、文字は脳の窓の上に
    const B = LAY.brain;
    X.fillStyle = PAL.ink; X.fillRect(0, B.y - 12, W, B.h + 24);
    X.fillStyle = PAL.r1; X.fillRect(0, B.y - 12, W, 6); X.fillRect(0, B.y + B.h + 6, W, 6);
    pop(T.almost, W / 2, B.y + 140, 96, PAL.g2, f - A.timeUp);
    pop(T.almostShort, W / 2, B.y + 232, 64, PAL.r2, f - A.timeUp - 8);
  }
  // ゴール! (1小節) → 「だれも教えていない」(1小節)
  if (sg.id === 'final' && f >= A.drop && f < A.goalSub) pop(T.goalBig, W / 2, R.y + 204, 128, PAL.g2, f - A.drop);
  if (sg.id === 'final' && f >= A.goalSub && f < A.result) pop(T.goalSub, W / 2, R.y + 236, 56, PAL.white, f - A.goalSub);
  if (f >= A.result && f < A.cta) results(f - A.result);
  if (sg.id === 'cta') cta(f - A.cta);

  if (guides && !CAPTURE) drawGuides();
}

// 進み具合のバー (世界の上): いまの距離 | ゴールまで | 旗 10 m
function hud(f, sg, dist) {
  const R = LAY.world, y = R.y + 12, x0 = 228, x1 = 876;
  X.fillStyle = PAL.ink; X.fillRect(0, R.y, W, 54);
  X.fillStyle = PAL.n3; X.fillRect(0, R.y + 54, W, 3);
  const done = f >= A.drop && f < A.cta;
  const q = clamp(dist * 100 / GOAL, 0, 1);
  // 数字
  const col = done ? PAL.g2 : sg.id === 'almost' && f >= A.timeUp ? PAL.r2 : PAL.white;
  text(`${sg.id === 'cta' ? '<< ' : ''}${dist.toFixed(1)} m`, 204, y + 32, 32, sg.id === 'cta' ? PAL.n6 : col, 'right');
  // バー
  X.fillStyle = PAL.n2; X.fillRect(x0, y + 6, x1 - x0, 18);
  X.fillStyle = done ? PAL.g2 : PAL.t3; X.fillRect(x0, y + 6, Math.round((x1 - x0) * q / 6) * 6, 18);
  if (!done) { X.fillStyle = PAL.t4; X.fillRect(x0, y + 6, Math.round((x1 - x0) * q / 6) * 6, 6); }
  for (let gx = x0 + 108; gx < x1; gx += 108) { X.fillStyle = PAL.ink; X.fillRect(gx, y + 6, 6, 18); } // 目盛 (1/6 ごと)
  const best = bestBefore(sg);
  if (best > 0 && sg.id !== 'cta' && !done) { const bx = x0 + Math.round((x1 - x0) * clamp(best * 100 / GOAL, 0, 1) / 6) * 6; X.fillStyle = PAL.white; X.fillRect(bx - 3, y, 6, 30); }
  // 旗
  X.fillStyle = PAL.white; X.fillRect(x1 + 18, y - 3, 6, 36);
  for (let r = 0; r < 4; r++) { X.fillStyle = PAL.g2; X.fillRect(x1 + 24, y - 3 + r * 6, 30 - Math.abs(r - 1.5) * 12, 6); }
  text(T.goal, x1 + 66, y + 32, 32, PAL.g2, 'left');
}

// 結果 (小節7): 第0世代 → 最終世代。数字は16分ごとに増えて、3拍目で止まる
function results(k) {
  const R0 = LAY.world.y, R1 = LAY.brain.y + LAY.brain.h;
  X.fillStyle = CHK_INK; X.fillRect(0, R0, W, R1 - R0 + 12);
  const top = 600, bot = 1140;
  X.fillStyle = PAL.ink; X.fillRect(0, top, W, bot - top);
  X.fillStyle = PAL.n4; X.fillRect(0, top, W, 6); X.fillRect(0, bot - 6, W, 6);
  const [ga, gb, da, db, tries] = T.result, fin = ep.stats.final;
  pop(ga, 270, 712, 64, PAL.n6, k, 'center', text);
  pop('→', 540, 712, 64, PAL.n6, k, 'center', text);
  pop(gb, 810, 712, 64, PAL.g2, k, 'center', text);
  pop(da, 270, 860, 96, PAL.r2, k - 2, 'center', text);
  const c = easeOut(clamp(k / (2 * BEAT), 0, 1)) * fin;
  if (k >= 2) text(`${(k >= 2 * BEAT ? fin : c).toFixed(1)} m`, 810, 860, 96, k >= 2 * BEAT ? PAL.g2 : PAL.white);
  pop(tries, 540, 1040, 64, PAL.t3, k - 2 * BEAT, 'center', text);
}

// 呼びかけ (小節8): 巻き戻しを見せながら
function cta(k) {
  const R = LAY.world, B = LAY.brain;
  X.fillStyle = CHK_INK; X.fillRect(0, R.y + 57, W, R.h - 57); X.fillRect(0, B.y - 12, W, B.h + 24);
  const [a, b, c] = T.cta;
  pop(a, W / 2, R.y + 236, 128, PAL.g2, k);
  pop(b, W / 2, R.y + 318, 48, PAL.white, k - 4);
  X.fillStyle = PAL.ink; if (k >= BEAT) X.fillRect(0, B.y - 12, W, B.h + 24);
  pop(c, W / 2, B.y + 170, 96, PAL.white, k - BEAT);
}

function drawGuides() {
  const G = LAY.safe;
  X.fillStyle = 'rgba(255,82,104,0.28)';
  X.fillRect(0, 0, W, G.top); X.fillRect(0, G.bottom, W, H - G.bottom); X.fillRect(G.right, 950, W - G.right, G.bottom - 950);
  X.font = `32px ${FONT}`; X.textAlign = 'left'; X.fillStyle = '#ff98a5';
  X.fillText('IG UI (top)', 24, 60); X.fillText('IG caption & buttons', 24, G.bottom + 50); X.fillText('btns', G.right + 8, 990);
}

// ─── 表紙: 第0世代 (倒れた姿) と 最終世代 (走る姿) を上下に。4:5 / 3:4 に切り取られても残る位置 ───
async function renderCover() {
  const hook = seg('hook'), fin = seg('final');
  const shots = [];
  {
    const tr = trackOf(hook.genome);
    const bonk = ep.events.find(e => e.type === 'bonk');
    const tI = bonk ? mapAt(hook.map, bonk.f).t : 1;
    shots.push({ tr, u: Math.round(tI * 0.62 * FPS), label: ep.cover.a, sub: ep.cover.aSub, col: PAL.r2 }); // 倒れる途中
  }
  {
    const tr = trackOf(fin.genome);
    // 3〜6秒で、体を大きく伸ばした瞬間 (高さが上位2割に入る姿のうち最初)
    const hs = [];
    for (let k = 3 * FPS; k <= 6 * FPS; k++) { const s = tr.at(k); let y1 = -1e9; for (const v of s.y) y1 = Math.max(y1, v); hs.push([k, y1]); }
    const cut = hs.map(h => h[1]).sort((a, b) => a - b)[Math.floor(hs.length * 0.8)];
    shots.push({ tr, u: hs.find(h => h[1] >= cut)[0], label: ep.cover.b, sub: ep.cover.bSub, col: PAL.g2 });
  }
  X.imageSmoothingEnabled = false;
  X.fillStyle = PAL.n1; X.fillRect(0, 0, W, H);
  X.fillStyle = gridPat; X.fillRect(0, 0, W, H);
  text(T.title, W / 2, 392, 80, PAL.g2);
  const ys = [452, 1012];
  for (let j = 0; j < 2; j++) {
    const sh = shots[j], P = sh.tr.pose(sh.u);
    let x0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let q = 0; q < P.n; q++) { x0 = Math.min(x0, P.x[q]); x1 = Math.max(x1, P.x[q]); y1 = Math.max(y1, P.y[q]); }
    sh.zoom = clamp(Math.min(360 * 0.5 / Math.max(30, x1 - x0), (140 * 0.72 - 30) / Math.max(20, y1)), 0.3, 3); // 上30pxは文字
    const cam = new Camera(); cam.zoom = sh.zoom; cam.x = (x0 + x1) / 2; cam.y = groundY(env.terrain, cam.x) + 140 * (0.72 - 0.5) / sh.zoom;
    const { ctx, w, h } = fitCanvas(coverCv, { px: 2 });
    drawWorld(ctx, cam, w, h, env.terrain, { startX: sh.tr.nose0 });
    drawGoal(ctx, cam, w, h, false);
    ctx.save(); cam.apply(ctx, w, h); drawCreature(ctx, P, {}); ctx.restore();
    await new Promise(r => setTimeout(r, 0));
    const y = ys[j];
    X.fillStyle = PAL.ink; X.fillRect(0, y - 12, W, 444);
    X.drawImage(coverCv, 0, y, 1080, 420);
    X.fillStyle = PAL.n4; X.fillRect(0, y - 6, W, 6); X.fillRect(0, y + 420, W, 6);
    outlined(sh.label, 48, y + 96, 96, sh.col, 'left');
    outlined(sh.sub, W - 48, y + 96, 80, PAL.white, 'right');
  }
  text('↓', W / 2, 980, 64, PAL.n6);
  text(`CREATURE ${ep.tag}`, W / 2, 1550, 48, PAL.n6);
  if (guides && !CAPTURE) {
    X.strokeStyle = '#ff5268'; X.lineWidth = 6;
    X.strokeRect(3, (H - 1350) / 2, W - 6, 1350); X.strokeRect(3, (H - 1440) / 2, W - 6, 1440);
    X.font = `32px ${FONT}`; X.fillStyle = '#ff98a5'; X.textAlign = 'left';
    X.fillText('grid crop 4:5 / 3:4', 24, (H - 1440) / 2 - 16);
  }
}

// ─── 外から使う (capture.mjs) ───
await document.fonts.load(`64px ${FONT}`, ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[]_abcdefghijklmnopqrstuvwxyz{|}~→↑↓·×▮—◀');
let busy = false;
window.REEL = {
  fps: VFPS, width: W, height: H, total: TOTAL, episode: ep, canvas: frame,
  async seek(i) { busy = true; try { await renderFrame(i); } finally { busy = false; } },
  async cover() { busy = true; try { await renderCover(); } finally { busy = false; } },
  ready: true,
};

// ─── プレビュー (再生・シーク・安全領域・表紙・音) ───
// 音つきで確かめる: reel/index.html?ep=episodes/ep001.json&audio=../out/ep001/music.wav
const audio = params.get('audio') ? new Audio(params.get('audio')) : null;
let playing = false, pos = 0, fpos = 0, last = 0;
const $ = s => document.querySelector(s);
const seekEl = $('#seek'), timeEl = $('#time'), playEl = $('#play');
seekEl.max = TOTAL - 1;
$('#guides').checked = guides;
const show = async i => { pos = i; seekEl.value = i; timeEl.textContent = `${(i / VFPS).toFixed(1)} / ${(TOTAL / VFPS).toFixed(1)} s`; await REEL.seek(i); };
const stop = () => { playing = false; playEl.textContent = '▶ Play'; if (audio) audio.pause(); };
playEl.onclick = () => {
  if (playing) return stop();
  playing = true; playEl.textContent = '❚❚ Pause'; fpos = pos; last = performance.now();
  if (audio) { audio.currentTime = pos / VFPS; audio.play(); }
};
seekEl.oninput = () => { stop(); fpos = +seekEl.value; show(fpos); };
$('#guides').onchange = e => { guides = e.target.checked; show(pos); };
$('#cover').onclick = async () => { stop(); await REEL.cover(); };
window.addEventListener('keydown', e => { if (e.code === 'Space') { e.preventDefault(); playEl.onclick(); } });
if (CAPTURE) document.querySelectorAll('.bar, #note').forEach(e => e.remove());
await show(0);
const loop = async now => {
  if (playing && !busy) {
    // Instagram と同じく最後まで行ったら最初へ (ループのつなぎ目も確かめられる)
    if (audio) { if (audio.ended) { audio.currentTime = 0; audio.play(); } fpos = audio.currentTime * VFPS; }
    else fpos += Math.max(0, now - last) / 1000 * VFPS;
    last = now;
    if (fpos >= TOTAL) fpos -= TOTAL;
    const next = Math.floor(fpos);
    if (next !== pos) await show(next);
  } else last = now;
  requestAnimationFrame(loop);
};
requestAnimationFrame(loop);
