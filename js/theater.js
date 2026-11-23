/* =====================================================================
   SoftEvo — theater.js
   「劇場」: Worker が評価した個体を決定論的に再生する
   ・single : チャンピオン + 同世代の上位個体をゴーストで
   ・lanes  : レーンに並べて同時に走らせる (進化のパレード / かけっこ)
   ・脳の手術 (ノックアウト) をリアルタイムに適用
   ===================================================================== */
import { Creature, FPS, groundY, formatFitness } from './sim.js';
import { Camera, drawCreature, drawWorld } from './world.js';
import { fitCanvas, clamp, PAL, hueColor, pixelDisc, dotSpace, toDot } from './ui.js';

const HIST = 240; // 記録するフレーム数 (4秒)

function sizeOf(bp) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of bp.nodes) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y); }
  return Math.max(40, x1 - x0, y1 - y0);
}
const unitDone = u => u.t >= u.steps || u.broken;

export class Theater {
  constructor(canvas, hooks = {}) {
    this.canvas = canvas;
    this.hooks = hooks;
    this.cam = new Camera();
    this.userZoom = 1;
    this.speed = 1;
    this.acc = 0;
    this.spec = null;
    this.units = [];
    this.ghosts = [];
    this.main = null;
    this.knock = null;
    this.finished = false;
    this.holdT = 0;
    this.showGhosts = true;
    this.trail = [];
    this.bindInput();
  }

  setRun(bp, layout) {
    this.bp = bp; this.layout = layout;
    this.knock = layout.sizes.map(n => new Uint8Array(n));
    this.M = layout.outputs.length;
    this.gaitOut = Array.from({ length: this.M }, () => new Float32Array(HIST));
    this.gaitTouch = Array.from({ length: bp.nodes.length }, () => new Uint8Array(HIST));
    this.actHist = layout.sizes.map(n => Array.from({ length: n }, () => new Float32Array(HIST)));
    this.head = 0; this.filled = 0;
    this.size = sizeOf(bp);
  }

  knockCount() { return this.knock ? this.knock.reduce((s, k) => s + k.reduce((a, b) => a + b, 0), 0) : 0; }

  makeUnit(l) {
    const bp = l.bp || this.bp, layout = l.layout || this.layout;
    const c = new Creature(bp, layout, l.genome, l.env);
    c.lane = l; c.steps = Math.round(l.env.evalSeconds * FPS);
    return c;
  }

  play(spec) {
    this.spec = spec;
    this.finished = false; this.holdT = 0; this.acc = 0;
    this.trail = [];
    this.head = 0; this.filled = 0;
    this.ghosts = [];
    if (spec.kind === 'lanes') {
      this.units = spec.lanes.map(l => this.makeUnit(l));
      this.main = this.units[spec.main ?? this.units.length - 1];
    } else {
      this.units = [this.makeUnit(spec)];
      this.main = this.units[0];
      if (spec.kind === 'single') this.ghosts = (spec.ghosts || []).map(g => { const c = new Creature(this.bp, this.layout, g.genome, spec.env); c.hue = g.hue; return c; });
    }
    if (this.main.brain.sizes.length === this.knock.length) this.main.brain.knock = this.knock;
    let size = 0;
    for (const u of this.units) size = Math.max(size, sizeOf(u.lane.bp || this.bp));
    this.size = size;
    const [cx, cy] = this.main.centroid();
    this.cam.x = cx; this.cam.y = cy + 20;
  }

  update(dt) {
    if (!this.main) return;
    if (this.finished) {
      this.holdT += dt;
      if (this.holdT > 1.6 / Math.max(1, this.speed * 0.5)) { const f = this.hooks.onFinish; this.holdT = -1e9; f && f(); }
      return;
    }
    this.acc += dt * FPS * this.speed;
    let n = Math.min(Math.floor(this.acc), 40);
    this.acc -= Math.floor(this.acc);
    const units = this.units;
    while (n-- > 0 && !units.every(unitDone)) {
      for (const u of units) {
        if (unitDone(u)) continue;
        u.step();
      }
      if (this.spec.kind === 'single' && this.showGhosts) for (const g of this.ghosts) if (g.t < units[0].steps) g.step();
      this.record();
    }
    if (units.every(unitDone)) this.finished = true;
  }

  record() {
    const m = this.main, h = this.head;
    for (let j = 0; j < this.M && j < m.out.length; j++) this.gaitOut[j][h] = m.out[j];
    for (let i = 0; i < m.n && i < this.gaitTouch.length; i++) this.gaitTouch[i][h] = m.contact[i];
    const acts = m.brain.acts;
    if (acts.length === this.actHist.length) for (let l = 0; l < acts.length; l++) for (let i = 0; i < acts[l].length; i++) this.actHist[l][i][h] = acts[l][i];
    this.head = (h + 1) % HIST; this.filled = Math.min(HIST, this.filled + 1);
    if (m.t % 4 === 0) { const [cx, cy] = m.centroid(); this.trail.push(cx, cy); if (this.trail.length > 600) this.trail.splice(0, 2); }
  }

  progress() {
    if (!this.main) return 0;
    let p = 0;
    for (const u of this.units) p = Math.max(p, u.t / u.steps);
    return clamp(p, 0, 1);
  }

  liveScore() {
    if (!this.main || this.spec.kind !== 'single') return '';
    const env = this.spec.env;
    return formatFitness(this.main.fitness(env.objective), env.objective);
  }

  // ─── 入力: ズーム / 筋肉タップ ───
  bindInput() {
    const c = this.canvas;
    const ptrs = new Map(); let pinch = null, down = null;
    c.addEventListener('wheel', e => { e.preventDefault(); this.userZoom = clamp(this.userZoom * Math.exp(-e.deltaY * 0.0015), 0.25, 5); }, { passive: false });
    c.addEventListener('pointerdown', e => {
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: this.userZoom }; }
      else down = { x: e.clientX, y: e.clientY };
    });
    c.addEventListener('pointermove', e => {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch && ptrs.size === 2) { const [a, b] = [...ptrs.values()]; this.userZoom = clamp(pinch.z * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(10, pinch.d), 0.25, 5); }
    });
    const end = e => {
      ptrs.delete(e.pointerId);
      if (ptrs.size < 2) pinch = null;
      if (down && e.type === 'pointerup' && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 8) this.tap(e);
      down = null;
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
  }

  tap(e) {
    if (!this.main || this.spec.kind === 'lanes' || !this.hooks.onTapBody) return;
    const r = this.canvas.getBoundingClientRect(), w = r.width, h = r.height;
    const px = this.cam.wx(e.clientX - r.left, w), py = this.cam.wy(e.clientY - r.top, h);
    const m = this.main, R = 16 / this.cam.zoom;
    let best = null, bd = R;
    for (let i = 0; i < m.n; i++) { const d = Math.hypot(m.x[i] - px, m.y[i] - py); if (d < bd) { bd = d; best = { node: i }; } }
    if (!best) {
      m.muscleEdge.forEach((e2, j) => {
        const A = m.ea[e2], B = m.eb[e2];
        const dx = m.x[B] - m.x[A], dy = m.y[B] - m.y[A], L = dx * dx + dy * dy || 1;
        const t = clamp(((px - m.x[A]) * dx + (py - m.y[A]) * dy) / L, 0, 1);
        const d = Math.hypot(m.x[A] + dx * t - px, m.y[A] + dy * t - py);
        if (d < bd) { bd = d; best = { muscle: j }; }
      });
    }
    this.hooks.onTapBody(best);
  }

  // ─── 描画 ───
  render() {
    // レーン (小さな生物がたくさん) は細かいドット、1匹を大きく映す時は画面幅で決める
    const { ctx, w, h } = fitCanvas(this.canvas, { px: this.spec && this.spec.kind === 'lanes' ? 2 : 0 });
    if (!this.main) { ctx.fillStyle = PAL.ink; ctx.fillRect(0, 0, w, h); return; }
    if (this.spec.kind === 'lanes') return this.renderLanes(ctx, w, h);
    const env = this.spec.env;
    const [cx, cy] = this.main.centroid();
    const baseZoom = clamp(Math.min(w, h * 1.4) / (this.size * 4.2), 0.35, 4);
    const Z = baseZoom * this.userZoom;
    this.cam.zoom = Z;
    this.cam.x += (cx - this.cam.x) * 0.12;
    const gy = groundY(env.terrain, cx);
    const targetY = env.objective === 'jump' ? Math.max(cy, gy + h * 0.28 / Z) : gy + h * 0.22 / Z;
    this.cam.y += (targetY - this.cam.y) * 0.08;

    // 生物が画面のどこにいるか (旗の文字などを重ねないため)
    const mn = this.main;
    let ax0 = Infinity, ax1 = -Infinity, ay0 = Infinity, ay1 = -Infinity;
    for (let i = 0; i < mn.n; i++) {
      const sx = this.cam.sx(mn.x[i], w), sy = this.cam.sy(mn.y[i], h);
      ax0 = Math.min(ax0, sx); ax1 = Math.max(ax1, sx); ay0 = Math.min(ay0, sy); ay1 = Math.max(ay1, sy);
    }
    const avoid = [ax0 - 14, ay0 - 30, ax1 + 14, ay1 + 8]; // 頭上の距離の表示ぶんも空ける
    drawWorld(ctx, this.cam, w, h, env.terrain, { startX: this.main.startX, record: this.spec.record, avoid });

    ctx.save(); this.cam.apply(ctx, w, h);
    // 軌跡
    if (this.trail.length > 4) {
      ctx.strokeStyle = PAL.g1; ctx.lineWidth = 1.5 / Z; ctx.setLineDash([3 / Z, 5 / Z]);
      ctx.beginPath(); ctx.moveTo(this.trail[0], this.trail[1]);
      for (let i = 2; i < this.trail.length; i += 2) ctx.lineTo(this.trail[i], this.trail[i + 1]);
      ctx.stroke(); ctx.setLineDash([]);
    }
    if (this.showGhosts) for (const g of this.ghosts) drawCreature(ctx, g, { ghost: g.hue, alpha: 0.28, eyes: false });
    drawCreature(ctx, this.main, this.glow());
    ctx.restore();

    // 生物の頭上ラベル
    const [hx, hy] = [this.cam.sx(cx, w), this.cam.sy(cy, h)];
    ctx.font = '12px system-ui'; ctx.textAlign = 'center';
    ctx.fillStyle = PAL.white;
    ctx.fillText(this.liveScore(), hx, hy - this.size * 0.75 * Z - 12);
  }

  glow() {
    const glowNodes = new Set(), glowEdges = new Set();
    if (this.highlight) {
      for (const n of this.highlight.nodes) glowNodes.add(n);
      for (const e of this.highlight.edges) glowEdges.add(e);
    }
    return { glowNodes, glowEdges };
  }

  /** レーン: パレード / かけっこ */
  renderLanes(ctx, w, h) {
    const TOP = this.spec.top ?? 46;
    ctx.fillStyle = PAL.ink; ctx.fillRect(0, 0, w, TOP);
    ctx.save(); ctx.translate(0, TOP); h -= TOP;
    const MAP = this.spec.map ? 26 : 0;
    const units = this.units, L = units.length, lh = (h - MAP) / L;
    const bodies = units;
    // 走る生物は各レーンのカメラがそれぞれを追う (ズームは共通 = 大きさを比べられる)
    const Z = clamp(Math.min(w / (this.size * 4.5), lh / (this.size * 1.5)), 0.25, 3) * this.userZoom;
    const dist = u => (u.broken ? -Infinity : u.centroid()[0] - u.startX);
    const order = bodies.slice().sort((a, b) => dist(b) - dist(a));
    const lead = order.length ? dist(order[0]) : 0;
    if (MAP) this.renderMap(ctx, w, MAP, bodies, lead);
    ctx.translate(0, MAP);
    units.forEach((u, i) => {
      ctx.save();
      ctx.beginPath(); ctx.rect(0, i * lh, w, lh); ctx.clip();
      ctx.translate(0, i * lh);
      const l = u.lane;
      let label = l.label;
      const cx = u.centroid()[0];
      // 生物はレーンの右寄り (64%) に映す。左側は札のために空けておく
      const tx = cx - w * 0.14 / Z;
      const cam = u._cam || (u._cam = Object.assign(new Camera(), { x: tx }));
      cam.zoom = Z;
      cam.x += (tx - cam.x) * 0.15;
      cam.y = groundY(l.env.terrain, cx) + lh * 0.25 / Z;
      drawWorld(ctx, cam, w, lh, l.env.terrain, { startX: u.startX });
      ctx.save(); cam.apply(ctx, w, lh);
      // ほかのレーンの生物をゴーストで重ねる (同じ地形のときだけ: スタート位置をそろえて描く)
      if (this.showGhosts) for (const o of bodies) {
        if (o === u || o.lane.env.terrain !== l.env.terrain) continue;
        ctx.save(); ctx.translate(u.startX - o.startX, 0);
        drawCreature(ctx, o, { ghost: o.lane.hue ?? 200, alpha: 0.22, eyes: false });
        ctx.restore();
      }
      drawCreature(ctx, u, {});
      ctx.restore();
      // 札: 左上に小さく。箱で塗らずに縁取りの文字で (後ろが透けて見える)。幅はレーンの半分まで
      const rank = l.rank || (bodies.length > 1 ? `${order.indexOf(u) + 1}位` : '');
      const dist = formatFitness(u.fitness(l.env.objective), l.env.objective);
      const maxW = w * 0.48 - 16;
      let fs = lh < 60 ? 11 : 12, name = label;
      const text = () => `${rank ? rank + ' ' : ''}${name}  ${dist}`;
      ctx.font = `${fs}px system-ui`;
      while (ctx.measureText(text()).width > maxW && fs > 9) ctx.font = `${--fs}px system-ui`;
      while (ctx.measureText(text()).width > maxW && name.length > 2) name = name.slice(0, -2) + '…';
      const ty = 5 + fs;
      ctx.fillStyle = PAL.ink; ctx.fillRect(5, 5, 6, fs + 3);
      ctx.fillStyle = hueColor(l.hue ?? 200, 2); ctx.fillRect(6, 6, 4, fs + 1);
      ctx.textAlign = 'left'; ctx.lineJoin = 'round';
      ctx.strokeStyle = PAL.ink; ctx.lineWidth = 3; ctx.strokeText(text(), 15, ty);
      ctx.fillStyle = order.indexOf(u) === 0 && bodies.length > 1 ? PAL.g2 : PAL.white; // 先頭だけ金色
      ctx.fillText(text(), 15, ty);
      ctx.restore();
      ctx.fillStyle = PAL.n4; ctx.fillRect(0, (i + 1) * lh - 2, w, 2);
    });
    ctx.restore();
  }

  /** 全員の位置関係 (スタート〜先頭) を1本の線に */
  renderMap(ctx, w, H, bodies, lead) {
    const x0 = 44, x1 = w - 16, y = H / 2 + 2;
    const span = Math.max(100, lead) * 1.05;
    const X = d => x0 + clamp(d / span, 0, 1) * (x1 - x0);
    ctx.fillStyle = PAL.n1; ctx.fillRect(0, 0, w, H);
    ctx.fillStyle = PAL.n4; ctx.fillRect(x0, y - 1, x1 - x0, 2);
    ctx.font = '10px system-ui'; ctx.textAlign = 'right'; ctx.fillStyle = PAL.n6;
    ctx.fillText('START', x0 - 6, y + 4);
    for (let m = 1; m * 100 < span; m++) {
      if (span > 1200 && m % 5) continue;
      ctx.fillStyle = PAL.n5; ctx.fillRect(X(m * 100) - 1, y - 4, 2, 8);
    }
    // 走者の印 (ドットの丸)
    const t = ctx.getTransform();
    const R = Math.max(2, Math.round(4 * t.a));
    dotSpace(ctx);
    for (const u of bodies) {
      const d = u.broken ? 0 : u.centroid()[0] - u.startX;
      const [px, py] = toDot(ctx, X(d), y, t);
      pixelDisc(ctx, px, py, R + 1, PAL.ink);
      pixelDisc(ctx, px, py, R, hueColor(u.lane.hue ?? 200, 2));
    }
    ctx.restore();
  }
}
