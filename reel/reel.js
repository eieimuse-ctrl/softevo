/* =====================================================================
   SoftEvo Reels — 縦動画 (1080×1920 / 30fps) の画をつくる。画面の文字はすべて英語
   ---------------------------------------------------------------------
   ・SoftEvo の部品 (世界・生物・脳) を「スマホ 360×640 の画面 × 3倍」として描き、1枚に合成する
   ・物理は決定論: 同じエピソードなら何度描いても同じ画 (コマを飛ばして描いても同じ)
   ・window.REEL.seek(i) で i コマ目を描く → reel/capture.mjs が PNG 連番に書き出す (動画への変換は別の場所で)
   ・レイアウトは Reels の UI に隠れる所 (上 250px・下 640px・右下のボタン列) を避けてある
   ===================================================================== */
// 部品は 3 倍の解像度で描く (どの端末で開いても 1080×1920 にぴったり合成できるように)
Object.defineProperty(window, 'devicePixelRatio', { configurable: true, get: () => 3 });

import { Creature, brainLayout, groundY, DEFAULT_SETTINGS, FPS } from '../js/sim.js';
import { Camera, drawWorld, drawCreature } from '../js/world.js';
import { BrainView, BRAIN_TEXT_EN } from '../js/brainview.js';
import { fitCanvas, PAL, clamp } from '../js/ui.js';
import { b64ToF32 } from '../js/store.js';

const W = 1080, H = 1920, VFPS = 30, S = 3;
const FONT = '"DotGothic16", monospace';
// ─── レイアウト (px は 1080×1920 の座標) ───
const LAY = {
  title: 306,                                    // CREATURE #001
  gen: 398,                                      // GEN 14 · first steps
  world: { x: 0, y: 420, w: 1080, h: 528 },      // 世界 (CSS 360×176)
  brain: { x: 42, y: 984, w: 888, h: 300 },      // 脳 (CSS 296×100)。右はボタンの列を空ける
  strip: 1332,                                   // 世代のバー
  safe: { top: 250, bottom: 1280, right: 960 },  // Reels の UI に隠れる所 (目安)
};

const params = new URLSearchParams(location.search);
const CAPTURE = params.has('capture');
let guides = params.has('guides');
const ep = await (await fetch(params.get('ep') || 'episodes/ep001.json', { cache: 'no-store' })).json();
const bp = ep.blueprint, settings = { ...DEFAULT_SETTINGS, ...ep.settings };
const layout = brainLayout(bp, settings);
const env = { terrain: settings.terrain, objective: settings.objective, gravity: settings.gravity, friction: settings.friction, evalSeconds: settings.evalSeconds };
const gCache = new Map();
const genome = g => { if (!gCache.has(g)) gCache.set(g, b64ToF32(ep.genomes[g])); return gCache.get(g); };

// コマの割り振り
let acc = 0;
const shots = ep.shots.map((s, i) => { const o = { ...s, i, start: acc, frames: Math.round(s.sec * VFPS) }; acc += o.frames; return o; });
const TOTAL = acc;
const maxGen = Math.max(...shots.filter(s => !s.end).map(s => s.gen), 1);

// ─── 作業用キャンバス (CSS の大きさで SoftEvo の部品が描く) ───
const frame = document.getElementById('frame'), X = frame.getContext('2d');
const worldCv = document.getElementById('w-world'), brainCv = document.getElementById('w-brain'), coverCv = document.getElementById('w-cover');
const css = (cv, r) => { cv.style.width = `${r.w / S}px`; cv.style.height = `${r.h / S}px`; };
css(worldCv, LAY.world); css(brainCv, LAY.brain); css(coverCv, { w: 1080, h: 540 });
const brain = new BrainView(brainCv);
brain.text = BRAIN_TEXT_EN;
brain.setRun(layout);

// ─── 体の大きさとカメラ ───
let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
for (const p of bp.nodes) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
const BW = Math.max(40, x1 - x0), BH = Math.max(30, y1 - y0);
const CW = LAY.world.w / S, CH = LAY.world.h / S; // 世界の CSS の大きさ
// 縦動画では生物を大きく (幅は窓の46%、高さは窓の半分まで)。上の2割は文字のために空ける
const ZOOM = clamp(Math.min(CW * 0.46 / BW, CH * 0.5 / BH), 0.3, 4);
const camFollow = (cam, c, snap) => {
  const [cx] = c.centroid();
  const tx = cx + CW * 0.06 / ZOOM; // 生物は少し左 (44%) に。右上の距離メーターと重ねない
  cam.x = snap ? tx : cam.x + (tx - cam.x) * 0.18;
  cam.y = groundY(env.terrain, cx) + CH * 0.30 / ZOOM; // 地面は窓の下から2割
};

// ─── シミュレーション (コマ番号から決まる) ───
let st = null;
function fresh(shot, zoom = ZOOM) {
  const main = new Creature(bp, layout, genome(shot.gen), env);
  const ghost = shot.ghost != null ? new Creature(bp, layout, genome(shot.ghost), env) : null;
  const cam = new Camera(); cam.zoom = zoom;
  camFollow(cam, main, true);
  return { shot, f: 0, main, ghost, cam };
}
function advance(s) {
  const n = Math.round(FPS / VFPS * (s.shot.speed || 1));
  for (let k = 0; k < n; k++) { s.main.step(); if (s.ghost) s.ghost.step(); }
  camFollow(s.cam, s.main, false);
  s.f++;
}
function stateAt(shot, f) {
  if (!st || st.shot !== shot || st.f > f) st = fresh(shot);
  while (st.f < f) advance(st);
  return st;
}

// ─── 文字 (DotGothic16 は 16 の倍数の大きさでくっきり) ───
function text(str, x, y, size, color, align = 'center') {
  X.font = `${size}px ${FONT}`; X.textAlign = align; X.textBaseline = 'alphabetic';
  const d = Math.max(3, size / 8); // 影は2ドット
  X.fillStyle = PAL.ink; X.fillText(str, x + d, y + d);
  X.fillStyle = color; X.fillText(str, x, y);
}
function outlined(str, x, y, size, color, align = 'center') {
  X.font = `${size}px ${FONT}`; X.textAlign = align; X.textBaseline = 'alphabetic';
  X.lineJoin = 'round'; X.lineWidth = size / 5; X.strokeStyle = PAL.ink; X.strokeText(str, x, y);
  X.fillStyle = color; X.fillText(str, x, y);
}
const width = (str, size) => { X.font = `${size}px ${FONT}`; return X.measureText(str).width; };

// 市松模様 (ドット絵の半透明)。1ドット = 3px
const pat = (color, dot = S) => {
  const c = document.createElement('canvas'); c.width = c.height = dot * 2;
  const g = c.getContext('2d'); g.fillStyle = color; g.fillRect(0, 0, dot, dot); g.fillRect(dot, dot, dot, dot);
  return X.createPattern(c, 'repeat');
};
const gridPat = (() => { const c = document.createElement('canvas'); c.width = c.height = 24; const g = c.getContext('2d'); g.fillStyle = PAL.n2; g.fillRect(0, 0, 6, 6); return X.createPattern(c, 'repeat'); })();
const CHK_INK = pat(PAL.ink), CHK_N7 = pat(PAL.n7), CHK_N4 = pat(PAL.n4);

// ─── 1コマを描く ───
function background() {
  X.imageSmoothingEnabled = false;
  X.fillStyle = PAL.n1; X.fillRect(0, 0, W, H);
  X.fillStyle = gridPat; X.fillRect(0, 0, W, H);
}
function windowFrame(r) {
  X.fillStyle = PAL.ink; X.fillRect(r.x - 12, r.y - 12, r.w + 24, r.h + 24);
  X.fillStyle = PAL.n4; X.fillRect(r.x - 6, r.y - 6, r.w + 12, r.h + 12);
  X.fillStyle = PAL.ink; X.fillRect(r.x + r.w + 12, r.y, 12, r.h + 24); X.fillRect(r.x, r.y + r.h + 12, r.w + 24, 12); // 段差の影
}
function typed(str, frames, speed = 1.6) { return str.slice(0, Math.max(0, Math.floor(frames * speed))); }

async function renderFrame(i) {
  i = clamp(Math.floor(i), 0, TOTAL - 1);
  const shot = shots.find(s => i < s.start + s.frames) || shots[shots.length - 1];
  const f = i - shot.start;
  const play = shot.end ? shots[shot.i - 1] : shot;
  const s = stateAt(play, shot.end ? play.frames - 1 : f);

  // 世界と生物 (SoftEvo のドット描画)
  {
    const { ctx, w, h } = fitCanvas(worldCv, { px: 2 });
    drawWorld(ctx, s.cam, w, h, env.terrain, { startX: s.main.startX });
    ctx.save(); s.cam.apply(ctx, w, h);
    if (s.ghost) drawCreature(ctx, s.ghost, { ghost: 205, eyes: false });
    drawCreature(ctx, s.main, {});
    ctx.restore();
  }
  // 脳
  if (brain.genome !== genome(play.gen)) brain.setGenomes(genome(play.gen), null);
  brain.render(s.main.brain.acts, null, i / VFPS);
  await new Promise(r => setTimeout(r, 0)); // ドットにそろえて表に出るのを待つ

  background();
  // 世界の窓 (横いっぱい)
  const R = LAY.world;
  X.fillStyle = PAL.ink; X.fillRect(0, R.y - 12, W, R.h + 24);
  X.fillStyle = PAL.n4; X.fillRect(0, R.y - 6, W, 6); X.fillRect(0, R.y + R.h, W, 6);
  X.drawImage(worldCv, R.x, R.y, R.w, R.h);
  // 脳の窓
  windowFrame(LAY.brain);
  X.drawImage(brainCv, LAY.brain.x, LAY.brain.y, LAY.brain.w, LAY.brain.h);
  text('BRAIN', LAY.brain.x + 8, LAY.brain.y - 22, 32, PAL.n6, 'left');

  // 切り替わりのちらつき (2コマ)
  if (!shot.end && shot.i > 0 && f < 2) { X.fillStyle = f === 0 ? CHK_N7 : CHK_N4; X.fillRect(0, R.y, W, R.h); }

  // 上の見出し
  text(ep.title, W / 2, LAY.title, 64, PAL.g2);
  const hooking = shot.hook && f < (shot.hookSec || 2.4) * VFPS;
  if (!shot.end) {
    const a = play.caption, b = play.sub ? `  ${play.sub}` : '';
    const wa = width(a, 80), wb = width(b, 48), x = (W - wa - wb) / 2;
    text(a, x, LAY.gen, 80, PAL.white, 'left');
    text(b, x + wa, LAY.gen, 48, play.kind === 'final' ? PAL.g2 : PAL.t3, 'left');
    // 距離メーター
    const d = Math.max(0, s.main.distance()) / 100;
    if (!hooking) outlined(`${d.toFixed(1)} m`, W - 36, R.y + 84, 64, PAL.white, 'right');
    if ((play.speed || 1) !== 1) outlined(`×${play.speed} speed`, W - 36, R.y + 132, 32, PAL.g2, 'right');
    if (s.ghost) outlined(`ghost = GEN ${play.ghost}`, 36, R.y + 64, 32, PAL.n6, 'left');
  }

  // つかみ (最初の数秒): 空の部分にタイプライターで (生物は隠さない)
  if (hooking) {
    const [l1, l2 = ''] = shot.hook;
    X.fillStyle = PAL.ink; X.fillRect(0, R.y + 6, W, 134);
    X.fillStyle = CHK_INK; X.fillRect(0, R.y + 140, W, 9);
    const t1 = typed(l1, f), t2 = typed(l2, f - l1.length / 1.6 - 4);
    text(t1 + (t2 ? '' : (f >> 3) % 2 ? '▮' : ''), W / 2, R.y + 70, 64, PAL.white);
    if (t2) text(t2 + ((f >> 3) % 2 ? '▮' : ''), W / 2, R.y + 124, 48, PAL.g2);
  }

  // 世代のバー
  {
    const y = LAY.strip, a = 150, b = 930;
    X.fillStyle = PAL.ink; X.fillRect(a - 6, y - 9, b - a + 12, 18);
    X.fillStyle = PAL.n4; X.fillRect(a, y - 3, b - a, 6);
    const cur = shot.end ? shots.length - 2 : shot.i;
    for (const sh of shots) {
      if (sh.end) continue;
      const x = a + (b - a) * sh.gen / maxGen, past = sh.i < cur, now = sh.i === cur;
      const r = now ? 15 : 9;
      X.fillStyle = PAL.ink; X.fillRect(x - r - 3, y - r - 3, 2 * r + 6, 2 * r + 6);
      X.fillStyle = now ? PAL.g2 : past ? PAL.t3 : PAL.n5; X.fillRect(x - r, y - r, 2 * r, 2 * r);
    }
    text('GEN 0', a - 24, y + 12, 32, PAL.n6, 'right');
    text(`${maxGen}`, b + 24, y + 12, 32, PAL.n6, 'left');
  }

  // おわり: 結果と呼びかけ
  if (shot.end) {
    X.fillStyle = CHK_INK; X.fillRect(0, 0, W, H);
    const top = 560, bot = 1230;
    X.fillStyle = PAL.ink; X.fillRect(0, top, W, bot - top);
    X.fillStyle = PAL.n4; X.fillRect(0, top, W, 6); X.fillRect(0, bot - 6, W, 6);
    const E = ep.end, step = k => f >= k * 7;
    if (step(0)) text(E.big, W / 2, 700, 80, PAL.g2);
    if (step(1)) text(E.sub, W / 2, 790, 48, PAL.white);
    if (step(2)) text(E.cta[0], W / 2, 930, 48, PAL.t3);
    if (step(3)) text(`${E.cta[1]} ↓`, W / 2, 1012, 64, PAL.white);
    if (step(4)) text(E.ask, W / 2, 1130, 48, PAL.g2);
  }

  if (guides && !CAPTURE) drawGuides();
}

function drawGuides() {
  const G = LAY.safe;
  X.fillStyle = 'rgba(255,82,104,0.28)';
  X.fillRect(0, 0, W, G.top); X.fillRect(0, G.bottom, W, H - G.bottom); X.fillRect(G.right, 950, W - G.right, G.bottom - 950);
  X.font = `32px ${FONT}`; X.textAlign = 'left'; X.fillStyle = '#ff98a5';
  X.fillText('IG UI (top)', 24, 60); X.fillText('IG caption & buttons', 24, G.bottom + 50); X.fillText('btns', G.right + 8, 990);
}

// ─── 表紙 (プロフィールの一覧で 4:5 / 3:4 に切り取られても大事な所が残るように) ───
async function renderCover() {
  const fin = shots.find(s => s.kind === 'final') || shots.filter(s => !s.end).pop();
  const cz = clamp(Math.min(360 * 0.62 / BW, 180 * 0.66 / BH), 0.3, 5);
  const s = fresh({ ...fin, ghost: null }, cz);
  for (let k = 0; k < 60; k++) advance(s); // 2秒走ったところの姿
  const { ctx, w, h } = fitCanvas(coverCv, { px: 3 });
  drawWorld(ctx, s.cam, w, h, env.terrain, { startX: s.main.startX });
  ctx.save(); s.cam.apply(ctx, w, h); drawCreature(ctx, s.main, {}); ctx.restore();
  await new Promise(r => setTimeout(r, 0));
  background();
  const C = ep.cover;
  text(C.top, W / 2, 430, 64, PAL.g2);
  text(C.big, W / 2, 690, 256, PAL.white);
  const r = { x: 0, y: 760, w: 1080, h: 540 };
  X.fillStyle = PAL.ink; X.fillRect(0, r.y - 12, W, r.h + 24);
  X.fillStyle = PAL.n4; X.fillRect(0, r.y - 6, W, 6); X.fillRect(0, r.y + r.h, W, 6);
  X.drawImage(coverCv, r.x, r.y, r.w, r.h);
  text(C.sub, W / 2, 1420, 64, PAL.t3);
  text(C.sub2, W / 2, 1510, 64, PAL.g2);
  if (guides && !CAPTURE) {
    X.strokeStyle = '#ff5268'; X.lineWidth = 6;
    X.strokeRect(3, (H - 1350) / 2, W - 6, 1350); X.strokeRect(3, (H - 1440) / 2, W - 6, 1440);
    X.font = `32px ${FONT}`; X.fillStyle = '#ff98a5'; X.textAlign = 'left';
    X.fillText('grid crop 4:5 / 3:4', 24, (H - 1440) / 2 - 16);
  }
}

// ─── 外から使う (capture.mjs) ───
await document.fonts.load(`64px ${FONT}`, ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[]_abcdefghijklmnopqrstuvwxyz{|}~→↑↓·×▮—');
let busy = false;
window.REEL = {
  fps: VFPS, width: W, height: H, total: TOTAL, episode: ep, canvas: frame,
  async seek(i) { busy = true; try { await renderFrame(i); } finally { busy = false; } },
  async cover() { busy = true; try { await renderCover(); } finally { busy = false; } },
  ready: true,
};

// ─── プレビュー (再生・シーク・安全領域・表紙) ───
let playing = false, pos = 0, fpos = 0, last = 0, showCover = false;
const $ = s => document.querySelector(s);
const seekEl = $('#seek'), timeEl = $('#time'), playEl = $('#play');
seekEl.max = TOTAL - 1;
$('#guides').checked = guides;
const show = async i => { pos = i; seekEl.value = i; timeEl.textContent = `${(i / VFPS).toFixed(1)} / ${(TOTAL / VFPS).toFixed(1)} s`; showCover = false; await REEL.seek(i); };
playEl.onclick = () => { playing = !playing; playEl.textContent = playing ? '❚❚ Pause' : '▶ Play'; if (playing && pos >= TOTAL - 1) pos = 0; fpos = pos; last = performance.now(); };
seekEl.oninput = () => { playing = false; playEl.textContent = '▶ Play'; fpos = +seekEl.value; show(fpos); };
$('#guides').onchange = e => { guides = e.target.checked; showCover ? REEL.cover() : show(pos); };
$('#cover').onclick = async () => { playing = false; playEl.textContent = '▶ Play'; showCover = true; await REEL.cover(); };
window.addEventListener('keydown', e => { if (e.code === 'Space') { e.preventDefault(); playEl.onclick(); } });
if (CAPTURE) document.querySelectorAll('.bar, #note').forEach(e => e.remove());
await show(0);
const loop = async t => {
  if (playing && !busy) {
    // 1コマに満たない進みもためておく (捨てると止まってしまう)
    fpos = Math.min(TOTAL - 1, fpos + Math.max(0, t - last) / 1000 * VFPS);
    last = t;
    const next = Math.floor(fpos);
    if (next !== pos) await show(next);
    if (pos >= TOTAL - 1) { playing = false; playEl.textContent = '▶ Play'; }
  } else last = t;
  requestAnimationFrame(loop);
};
requestAnimationFrame(loop);
