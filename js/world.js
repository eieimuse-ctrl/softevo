/* =====================================================================
   SoftEvo — world.js
   世界と生物の描画 (理論座標: cm, y上向き)。ドット絵: 線はキャンバスで、節点・目・地面はドット単位で描く
   ===================================================================== */
import { groundY, NODE_R } from './sim.js';
import { PAL, muscleColor, hueColor, checker, pixelDisc, dotSpace, toDot, fitCanvas } from './ui.js';

export class Camera {
  constructor() { this.x = 0; this.y = 40; this.zoom = 2; }
  sx(wx, w) { return (wx - this.x) * this.zoom + w / 2; }
  sy(wy, h) { return h / 2 - (wy - this.y) * this.zoom; }
  wx(sx, w) { return (sx - w / 2) / this.zoom + this.x; }
  wy(sy, h) { return (h / 2 - sy) / this.zoom + this.y; }
  apply(ctx, w, h) {
    ctx.translate(w / 2 - this.x * this.zoom, h / 2 + this.y * this.zoom);
    ctx.scale(this.zoom, -this.zoom);
  }
}

/** 静的な体 (設計図やサムネ用) を Creature と同じ形に */
export function staticBody(bp) {
  const n = bp.nodes.length, m = bp.edges.length;
  const b = {
    n, x: new Float64Array(n), y: new Float64Array(n), contact: new Uint8Array(n),
    ea: new Int32Array(m), eb: new Int32Array(m), isMuscle: new Uint8Array(m), muscleEdge: [],
    out: null, vx: 0, vy: 0, tilt: 0,
  };
  bp.nodes.forEach((p, i) => { b.x[i] = p.x; b.y[i] = p.y; });
  bp.edges.forEach((e, k) => { b.ea[k] = e.a; b.eb[k] = e.b; if (e.type === 'muscle') { b.isMuscle[k] = 1; b.muscleEdge.push(k); } });
  b.out = new Float64Array(b.muscleEdge.length);
  return b;
}

function prep(c) {
  if (c._mOf) return;
  c._mOf = new Int32Array(c.ea.length).fill(-1);
  c.muscleEdge.forEach((e, j) => { c._mOf[e] = j; });
  // 頭 = 静止形で一番上のノード (同じ高さなら前側)
  const ry = c.ry || c.y, rx = c.rx || c.x, d = c.dir || 1;
  let h = 0;
  for (let i = 1; i < c.n; i++) if (ry[i] > ry[h] + 0.5 || (Math.abs(ry[i] - ry[h]) <= 0.5 && rx[i] * d > rx[h] * d)) h = i;
  c._head = h;
}

/**
 * 生物を描く (ctx は Camera.apply 済み)
 * o: { ghost: hue|null, selEdge, selNode, eyes, glowNodes:Set, glowEdges:Set, tint: hue|null }
 *   ghost … 影 (1ドットの線と点の骨組み。筋肉の動きと目は描かない。主役を隠さず、形は見分けられるように)
 */
export function drawCreature(ctx, c, o = {}) {
  prep(c);
  const { x, y, ea, eb, isMuscle, out } = c;
  const ghost = o.ghost != null;
  const m = ctx.getTransform();
  const sc = Math.hypot(m.a, m.b) || 1; // 世界 1cm が何ドットか
  const live = !!c.brain;
  // 影 (同世代のライバル・ほかのレーン): 骨は中くらいの明るさ、筋肉は暗く、節点は明るい点。どれも1ドット
  const gBone = ghost ? hueColor(o.ghost, 1) : null, gMus = ghost ? hueColor(o.ghost, 0) : null, gDot = ghost ? hueColor(o.ghost, 2) : null;
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';

  // 筋肉 (縮むほど明るく太く)
  for (let e = 0; e < ea.length; e++) {
    if (!isMuscle[e]) continue;
    const j = c._mOf[e], a = out ? out[j] : 0;
    const con = Math.max(0, -a), ext = Math.max(0, a);
    const sel = o.selEdge === e || (o.glowEdges && o.glowEdges.has(e));
    if (sel && !ghost) {
      ctx.strokeStyle = PAL.white; ctx.lineWidth = 7 + 4 * con;
      ctx.beginPath(); ctx.moveTo(x[ea[e]], y[ea[e]]); ctx.lineTo(x[eb[e]], y[eb[e]]); ctx.stroke();
    }
    ctx.strokeStyle = ghost ? gMus : muscleColor(j, !live ? 2 : con > 0.35 ? 2 : ext > 0.45 ? 0 : 1);
    ctx.lineWidth = ghost ? 1 / sc : 1.6 + 3.6 * con + (1 - ext) * 0.6;
    ctx.beginPath(); ctx.moveTo(x[ea[e]], y[ea[e]]); ctx.lineTo(x[eb[e]], y[eb[e]]); ctx.stroke();
  }

  // 骨
  ctx.strokeStyle = ghost ? gBone : PAL.n7;
  ctx.lineWidth = ghost ? 1 / sc : 3.2;
  ctx.beginPath();
  for (let e = 0; e < ea.length; e++) {
    if (isMuscle[e]) continue;
    ctx.moveTo(x[ea[e]], y[ea[e]]); ctx.lineTo(x[eb[e]], y[eb[e]]);
  }
  ctx.stroke();

  // 節点と目はドット単位で (きっちりした丸に)。o.tint (色相) があれば節点の輪をその色に (動画で生物ごとの色)
  const R = Math.max(1, Math.round(NODE_R * sc));
  const ring = o.tint != null ? hueColor(o.tint, 2) : PAL.n7, core = o.tint != null ? hueColor(o.tint, 0) : PAL.n2;
  dotSpace(ctx);
  for (let i = 0; i < c.n; i++) {
    const [X, Y] = toDot(ctx, x[i], y[i], m);
    if (ghost) { ctx.fillStyle = gDot; ctx.fillRect(Math.round(X) - 1, Math.round(Y) - 1, 2, 2); continue; }
    const glow = o.selNode === i || (o.glowNodes && o.glowNodes.has(i));
    if (glow) pixelDisc(ctx, X, Y, R + 2, PAL.white);
    pixelDisc(ctx, X, Y, R, c.contact[i] ? PAL.g2 : ring);
    if (R >= 2) pixelDisc(ctx, X, Y, R - 1, c.contact[i] ? PAL.g0 : core);
  }

  // 目 — 動く方向を見る
  if (o.eyes !== false && !ghost) {
    const h = c._head;
    const sp = Math.hypot(c.vx, c.vy);
    const lx = sp > 0.05 ? c.vx / sp : (c.dir || 1), ly = sp > 0.05 ? c.vy / sp : 0;
    let dx = m.a * lx + m.c * ly, dy = m.b * lx + m.d * ly;
    const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
    const ca = Math.cos(c.tilt || 0), sa = Math.sin(c.tilt || 0);
    const E = Math.max(1, Math.round(3.3 * sc)), ps = E >= 3 ? 2 : 1;
    const eyes = [-1, 1].map(s => {
      const ox = s * 3.2, oy = 2.2;
      return toDot(ctx, x[h] + ox * ca - oy * sa, y[h] + ox * sa + oy * ca, m);
    });
    for (const [X, Y] of eyes) pixelDisc(ctx, X, Y, E, PAL.white);
    ctx.fillStyle = PAL.ink;
    for (const [X, Y] of eyes) {
      const k = Math.max(0, E - ps + 0.5) * 0.75;
      ctx.fillRect(Math.round(X + dx * k - (ps - 1) / 2), Math.round(Y + dy * k - (ps - 1) / 2), ps, ps);
    }
  }
  ctx.restore();
  ctx.restore();
}

function hash01(i) {
  const s = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

// 土の模様 (8×8 ドット)
let soilTile = null;
function soil(ctx) {
  if (!soilTile) {
    soilTile = document.createElement('canvas'); soilTile.width = soilTile.height = 8;
    const g = soilTile.getContext('2d');
    g.fillStyle = PAL.t0; g.fillRect(0, 0, 8, 8);
    g.fillStyle = PAL.t1; for (const [px, py] of [[1, 2], [5, 6], [6, 1]]) g.fillRect(px, py, 1, 1);
    g.fillStyle = PAL.ink; for (const [px, py] of [[3, 4], [0, 7]]) g.fillRect(px, py, 1, 1);
  }
  return ctx.createPattern(soilTile, 'repeat');
}

/** 背景と地面 (ctx は通常のスクリーン座標 = CSS px) */
export function drawWorld(ctx, cam, w, h, terrain, deco = {}) {
  const m = ctx.getTransform(), s = m.a; // CSS 1px が何ドットか
  const W = Math.ceil(w * s), H = Math.ceil(h * s);
  const Z = cam.zoom;
  const dX = cx => Math.floor(cx * s), dY = cy => Math.floor(cy * s);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, Math.round(m.e), Math.round(m.f));

  // 空: 上ほど暗い帯。境目は市松でぼかす
  const band = Math.round(H * 0.36);
  ctx.fillStyle = PAL.ink; ctx.fillRect(0, 0, W, band);
  ctx.fillStyle = PAL.n1; ctx.fillRect(0, band, W, H - band);
  ctx.fillStyle = checker(ctx, PAL.n1); ctx.fillRect(0, band - 3, W, 3);
  ctx.fillStyle = checker(ctx, PAL.ink); ctx.fillRect(0, band, W, 2);

  // 星 (遠いのでゆっくり流れる)
  const cell = 13, shift = cam.x * Z * s * 0.06;
  for (let ci = Math.floor(shift / cell) - 1; ci <= Math.floor((shift + W) / cell) + 1; ci++) {
    const h1 = hash01(ci * 7.13);
    if (h1 > 0.5) continue;
    ctx.fillStyle = h1 < 0.06 ? PAL.n7 : h1 < 0.22 ? PAL.n5 : PAL.n4;
    ctx.fillRect(Math.round(ci * cell + hash01(ci * 3.71 + 9.1) * cell - shift), Math.round(hash01(ci * 1.37 + 4.2) * H * 0.6), 1, 1);
  }

  // 遠景の山 (2層の視差)
  for (const [par, col, amp, base] of [[0.25, PAL.n2, 60, 140], [0.5, PAL.n3, 40, 70]]) {
    ctx.fillStyle = col;
    for (let X = 0; X < W; X++) {
      const wx = ((X + 0.5) / s - w / 2) / Z + cam.x * par;
      const wy = base + amp * (Math.sin(wx * 0.006) * 0.6 + Math.sin(wx * 0.017 + 2) * 0.4);
      const Y = Math.max(0, dY(h / 2 - (wy - cam.y * par) * Z));
      if (Y < H) ctx.fillRect(X, Y, 1, H - Y);
    }
  }

  // 1m ごとの点線
  const x0 = cam.wx(0, w) - 20, x1 = cam.wx(w, w) + 20;
  const startX = deco.startX ?? 0;
  for (let k = Math.floor((x0 - startX) / 100); k <= Math.ceil((x1 - startX) / 100); k++) {
    ctx.fillStyle = checker(ctx, k % 5 === 0 ? PAL.n4 : PAL.n2);
    ctx.fillRect(dX(cam.sx(startX + k * 100, w)), 0, 1, H);
  }

  // 地面: 列ごとに高さを測って、表面2段 + 土の模様
  const gy = new Int32Array(W);
  for (let X = 0; X < W; X++) gy[X] = dY(cam.sy(groundY(terrain, cam.wx((X + 0.5) / s, w)), h));
  const pat = soil(ctx);
  pat.setTransform(new DOMMatrix([1, 0, 0, 1, -Math.round(cam.x * Z * s), Math.round(cam.y * Z * s)]));
  ctx.fillStyle = pat;
  for (let X = 0; X < W; X++) if (gy[X] + 2 < H) ctx.fillRect(X, gy[X] + 2, 1, H - gy[X] - 2);
  ctx.fillStyle = PAL.t2;
  for (let X = 0; X < W; X++) {
    ctx.fillRect(X, gy[X] + 1, 1, 1);
    // 段差の縦の面
    if (X && gy[X] < gy[X - 1] - 1) ctx.fillRect(X, gy[X] + 1, 1, gy[X - 1] - gy[X]);
    if (X && gy[X] > gy[X - 1] + 1) ctx.fillRect(X - 1, gy[X - 1] + 1, 1, gy[X] - gy[X - 1]);
  }
  ctx.fillStyle = PAL.t3;
  for (let X = 0; X < W; X++) ctx.fillRect(X, gy[X], 1, 1);
  const gAt = X => (X >= 0 && X < W ? gy[X] : dY(cam.sy(groundY(terrain, cam.wx((X + 0.5) / s, w)), h)));

  // スタートの旗 (市松)
  const labels = [];
  const SX = dX(cam.sx(startX, w));
  if (SX > -6 && SX < W + 2) {
    const g0 = gAt(SX), ph = Math.max(7, Math.round(30 * Z * s));
    ctx.fillStyle = PAL.n7; ctx.fillRect(SX, g0 - ph, 1, ph);
    for (let r = 0; r < 3; r++) for (let q = 0; q < 4; q++) { ctx.fillStyle = (r + q) % 2 ? PAL.ink : PAL.white; ctx.fillRect(SX + 1 + q, g0 - ph + r, 1, 1); }
  }

  // 距離の目盛
  const every = Z < 0.6 ? 5 : 1;
  for (let k = Math.ceil((x0 - startX) / 100); k <= Math.floor((x1 - startX) / 100); k++) {
    if (k % every) continue;
    const wx = startX + k * 100, X = dX(cam.sx(wx, w)), G = gAt(X);
    ctx.fillStyle = k === 0 ? PAL.g2 : k % 5 === 0 ? PAL.n7 : PAL.n5;
    ctx.fillRect(X, G + 2, 1, k % 5 === 0 ? 4 : 2);
    labels.push([k === 0 ? 'START' : `${k}m`, cam.sx(wx, w), cam.sy(groundY(terrain, wx), h) + 24, k === 0 ? PAL.g2 : k % 5 === 0 ? PAL.n7 : PAL.n5]);
  }

  // 記録の旗
  let flag = null;
  if (deco.record && deco.record.x > x0 && deco.record.x < x1) {
    const rx = deco.record.x, X = dX(cam.sx(rx, w)), G = gAt(X);
    const ph = Math.max(Math.round(50 * s), Math.round(90 * Z * s)), fh = Math.max(5, Math.round(14 * s)), fw = Math.max(6, Math.round(22 * s));
    ctx.fillStyle = PAL.g2; ctx.fillRect(X, G - ph, 1, ph);
    for (let r = 0; r <= fh; r++) {
      const len = Math.round(fw * (1 - Math.abs(r - fh / 2) / (fh / 2)));
      if (len > 0) ctx.fillRect(X + 1, G - ph + r, len, 1);
    }
    flag = { sx: (X + 0.5) / s, top: (G - ph) / s, fw: fw / s };
  }
  ctx.restore();

  // 文字は CSS 座標で
  ctx.font = '11px system-ui'; ctx.textAlign = 'center';
  for (const [t, lx, ly, col] of labels) { ctx.fillStyle = col; ctx.fillText(t, lx, ly); }
  if (flag) {
    // 旗の文字は生物 (deco.avoid) と重ならない側に。どちらも重なるなら出さない (旗だけで分かる)
    ctx.font = '11px system-ui';
    const tw = ctx.measureText(deco.record.label).width, ty = flag.top + 11;
    const hit = (x0, x1) => deco.avoid && x1 > deco.avoid[0] && x0 < deco.avoid[2] && ty > deco.avoid[1] && ty - 12 < deco.avoid[3];
    const R = [flag.sx + flag.fw + 6, flag.sx + flag.fw + 6 + tw], L = [flag.sx - 6 - tw, flag.sx - 6];
    const side = [R, L].find(([x0, x1]) => x0 > 4 && x1 < w - 4 && !hit(x0, x1));
    if (side) {
      ctx.textAlign = 'left'; ctx.lineJoin = 'round';
      ctx.strokeStyle = PAL.ink; ctx.lineWidth = 3; ctx.strokeText(deco.record.label, side[0], ty);
      ctx.fillStyle = PAL.g2; ctx.fillText(deco.record.label, side[0], ty);
    }
  }
}

export function drawThumb(canvas, bp) {
  const { ctx, w, h } = fitCanvas(canvas, { px: 2 });
  ctx.clearRect(0, 0, w + 8, h + 8);
  if (!bp.nodes.length) return;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const p of bp.nodes) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
  const cam = new Camera();
  cam.zoom = Math.min((w - 30) / Math.max(40, maxX - minX + 20), (h - 24) / Math.max(40, maxY - minY + 20));
  cam.x = (minX + maxX) / 2; cam.y = (minY + maxY) / 2;
  ctx.save(); cam.apply(ctx, w, h);
  const b = staticBody(bp);
  b.ry = b.y; b.rx = b.x;
  drawCreature(ctx, b, {});
  ctx.restore();
}
