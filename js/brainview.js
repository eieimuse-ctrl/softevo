/* =====================================================================
   SoftEvo — brainview.js
   脳の可視化
   ・活動: 信号の流れ (w × 活性) を色と光る粒で
   ・重み: 学習した結合そのもの
   ・変異: 親からどのシナプスが変わったか
   ・ニューロンをタップ → 体のどこに対応するかを強調、手術 (ノックアウト)
   ===================================================================== */
import { weightIndex, biasIndex, rhythmHz } from './sim.js';
import { fitCanvas, clamp, signedColor, muscleColor, PAL, pixelDisc, dotSpace, toDot } from './ui.js';

const GROUP_COLOR = { stretch: PAL.p2, touch: PAL.g2, body: PAL.b2, clock: PAL.t3 };
const GROUP_NAME = { stretch: '筋の伸び', touch: '接地', body: '姿勢/速度', clock: 'リズム' };

export class BrainView {
  constructor(canvas, hooks = {}) {
    this.canvas = canvas;
    this.hooks = hooks;
    this.mode = 'activity';
    this.sel = null;
    this.hover = null;
    this.layout = null;
    this.genome = null; this.parent = null;
    this.pos = null; this.lastSize = '';
    canvas.addEventListener('pointerup', e => {
      const hit = this.hit(e);
      this.sel = hit && this.sel && hit.l === this.sel.l && hit.i === this.sel.i ? null : hit;
      this.hooks.onSelect && this.hooks.onSelect(this.sel);
    });
    canvas.addEventListener('pointermove', e => { if (e.pointerType === 'mouse') this.hover = this.hit(e); });
    canvas.addEventListener('pointerleave', () => { this.hover = null; });
  }

  setRun(layout) { this.layout = layout; this.sel = null; this.lastSize = ''; }
  setGenomes(g, parent) { this.genome = g; this.parent = parent; this.diffStats = null; }

  select(l, i) { this.sel = l == null ? null : { l, i }; this.hooks.onSelect && this.hooks.onSelect(this.sel); }

  computeLayout(w, h) {
    const key = `${w}x${h}`;
    if (key === this.lastSize && this.pos) return;
    this.lastSize = key;
    const { sizes, inputs } = this.layout;
    const L = sizes.length;
    const LW = w < 380 ? 70 : 92, RW = w < 380 ? 40 : 52, top = 24, bot = 8;
    this.LW = LW; this.RW = RW; this.top = top;
    const xs = sizes.map((_, l) => LW + 10 + (w - LW - RW - 20) * l / (L - 1));
    this.pos = [];
    // 入力: グループ間にすき間
    const groups = [];
    inputs.forEach((inp, i) => { if (!groups.length || groups[groups.length - 1].g !== inp.group) groups.push({ g: inp.group, start: i, n: 0 }); groups[groups.length - 1].n++; });
    const slots = sizes[0] + (groups.length - 1) * 0.9;
    const sp = (h - top - bot) / slots;
    this.inSp = sp;
    this.r0 = clamp(sp * 0.36, 2.2, 8);
    const p0 = []; let y = top + sp / 2;
    groups.forEach((gr, gi) => { if (gi) y += sp * 0.9; for (let k = 0; k < gr.n; k++) { p0.push({ x: xs[0], y }); y += sp; } });
    this.groups = groups;
    this.pos.push(p0);
    for (let l = 1; l < L; l++) {
      const n = sizes[l];
      const s = Math.min((h - top - bot) / n, 34);
      const y0 = top + (h - top - bot - s * n) / 2 + s / 2;
      this.pos.push(Array.from({ length: n }, (_, i) => ({ x: xs[l], y: y0 + i * s })));
      this['r' + l] = clamp(s * 0.34, 3, 10);
    }
  }

  radius(l) { return this['r' + l] || this.r0; }

  hit(e) {
    if (!this.pos) return null;
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    let best = null, bd = 18;
    this.pos.forEach((layer, l) => layer.forEach((p, i) => { const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = { l, i }; } }));
    // ラベル部分のタップでも選択
    if (!best && x < this.LW) {
      this.pos[0].forEach((p, i) => { const d = Math.abs(p.y - y); if (d < Math.max(6, this.inSp / 2) && d < bd) { bd = d; best = { l: 0, i }; } });
    }
    return best;
  }

  /** ニューロンの説明 */
  describe(n, acts) {
    const { sizes, inputs, outputs } = this.layout, g = this.genome, L = sizes.length;
    const v = acts ? acts[n.l][n.i] : 0;
    if (n.l === 0) {
      const inp = inputs[n.i];
      const desc = {
        stretch: 'この筋肉がどれだけ伸びている(+)/縮んでいる(−)か。体の「固有感覚」です。',
        touch: 'この点が地面に触れていると 1。足裏の感覚です。',
        body: '体全体の傾きや速さ。バランス感覚です。',
        clock: `脳内の振り子。周期は遺伝子で決まり、この個体は ${rhythmHz(g).toFixed(2)} Hz。歩くリズムの源になりやすい入力です。`,
      }[inp.group];
      return { title: `感覚: ${inp.label}`, group: inp.group, value: v, desc, links: this.topLinks(n) };
    }
    if (n.l === L - 1) {
      const o = outputs[n.i];
      return { title: `運動: ${o.label}`, value: v, color: muscleColor(n.i, 2), desc: `この値で筋肉${n.i + 1}の長さが決まります。＋で伸び、−で縮む。`, links: this.topLinks(n) };
    }
    return { title: `隠れ層${n.l} ニューロン #${n.i + 1}`, value: v, desc: `バイアス ${g[biasIndex(sizes, n.l, n.i)].toFixed(2)}。感覚を組み合わせて「特徴」を作る中間ニューロンです。`, links: this.topLinks(n) };
  }

  topLinks(n) {
    const { sizes, inputs, outputs } = this.layout, g = this.genome, L = sizes.length;
    const name = (l, i) => l === 0 ? inputs[i].label : l === L - 1 ? outputs[i].label : `隠れ${l}-#${i + 1}`;
    const res = { in: [], out: [] };
    if (n.l > 0) {
      const arr = [];
      for (let i = 0; i < sizes[n.l - 1]; i++) arr.push({ name: name(n.l - 1, i), w: g[weightIndex(sizes, n.l, n.i, i)] });
      res.in = arr.sort((a, b) => Math.abs(b.w) - Math.abs(a.w)).slice(0, 3);
    }
    if (n.l < L - 1) {
      const arr = [];
      for (let j = 0; j < sizes[n.l + 1]; j++) arr.push({ name: name(n.l + 1, j), w: g[weightIndex(sizes, n.l + 1, j, n.i)] });
      res.out = arr.sort((a, b) => Math.abs(b.w) - Math.abs(a.w)).slice(0, 3);
    }
    return res;
  }

  /** 選択ニューロンに対応する体の部位 */
  bodyTargets(n) {
    const res = { nodes: [], edges: [] };
    if (!n) return res;
    const { sizes, inputs, outputs } = this.layout, L = sizes.length;
    const mark = (l, i) => {
      if (l === 0) { const p = inputs[i]; if (p.kind === 'node') res.nodes.push(p.idx); else if (p.kind === 'muscle') res.edges.push(p.edge); }
      else if (l === L - 1) res.edges.push(outputs[i].edge);
    };
    mark(n.l, n.i);
    if (n.l > 0 && n.l < L - 1) {
      // 隠れニューロン: 最も強く影響する筋肉
      for (const o of this.topLinks(n).out.slice(0, 2)) { const j = outputs.findIndex(q => q.label === o.name); if (j >= 0) res.edges.push(outputs[j].edge); }
    }
    return res;
  }

  mutationStats() {
    if (this.diffStats) return this.diffStats;
    const g = this.genome, p = this.parent;
    if (!p || p.length !== g.length) return (this.diffStats = null);
    let n = 0, sum = 0;
    for (let i = 0; i < g.length; i++) { const d = Math.abs(g[i] - p[i]); if (d > 1e-6) { n++; sum += d; } }
    return (this.diffStats = { n, mean: n ? sum / n : 0, total: g.length });
  }

  render(acts, knock, time) {
    const { ctx, w, h, px } = fitCanvas(this.canvas, { px: 2 });
    ctx.fillStyle = PAL.ink; ctx.fillRect(0, 0, w, h);
    if (!this.layout || !this.genome) return;
    this.computeLayout(w, h);
    const { sizes, inputs, outputs } = this.layout, g = this.genome, L = sizes.length, pos = this.pos;
    const focus = this.sel || this.hover;
    const mode = this.mode;
    const par = mode === 'mutation' ? this.parent : null;
    const D = px; // 1ドット (CSS px)

    // 見出し
    ctx.font = '11px system-ui'; ctx.textAlign = 'center'; ctx.fillStyle = PAL.n5;
    for (let l = 0; l < L; l++) ctx.fillText(l === 0 ? '感覚' : l === L - 1 ? '筋肉' : `隠れ層${L > 3 ? l : ''}`, pos[l][0].x, 13);

    // 最大重み
    let maxW = 0.001;
    for (let i = 0; i < g.length - 1; i++) maxW = Math.max(maxW, Math.abs(g[i]));

    // ── 結合: 強さを 3 段階の色で (ドット絵なので半透明は使わない) ──
    ctx.lineCap = 'butt';
    const pulses = [];
    const lines = [[], [], [], []]; // 描く順 (弱い → 強い) に集める
    for (let l = 1; l < L; l++) {
      const nIn = sizes[l - 1], nOut = sizes[l];
      const A = acts ? acts[l - 1] : null;
      for (let j = 0; j < nOut; j++) {
        const pj = pos[l][j];
        for (let i = 0; i < nIn; i++) {
          const wi = weightIndex(sizes, l, j, i), wv = g[wi];
          const linked = focus && ((focus.l === l && focus.i === j) || (focus.l === l - 1 && focus.i === i));
          let col = null, lw = 1, tier = 1;
          if (mode === 'mutation') {
            const d = par ? g[wi] - par[wi] : 0;
            if (Math.abs(d) > 1e-6) { col = d > 0 ? PAL.p2 : PAL.v2; lw = Math.abs(d) > 0.3 ? 2 : 1; tier = 3; }
            else { col = PAL.n2; tier = 0; }
          } else if (mode === 'weights') {
            const a = Math.abs(wv) / maxW;
            col = signedColor(wv >= 0 ? a : -a, 0.1); lw = a > 0.7 ? 2 : 1; tier = a > 0.7 ? 3 : a > 0.4 ? 2 : 1;
          } else {
            const sv = A ? wv * A[i] : 0, t = Math.min(1, Math.abs(sv) * 0.55);
            col = signedColor(sv >= 0 ? t : -t, 0.08); lw = Math.abs(wv) > 1.6 ? 2 : 1; tier = t > 0.7 ? 3 : t > 0.4 ? 2 : 1;
            if (Math.abs(sv) > 0.55 && (!focus || linked)) pulses.push([pos[l - 1][i], pj, sv, wi]);
          }
          if (focus && !linked) { if (tier >= 2 && mode !== 'mutation') { col = PAL.n3; lw = 1; tier = 0; } else if (tier < 3) col = null; }
          if (focus && linked && !col) { col = PAL.n5; tier = 1; }
          if (!col) continue;
          lines[tier].push([pos[l - 1][i], pj, col, lw]);
        }
      }
    }
    for (const group of lines) for (const [a, b, col, lw] of group) {
      ctx.strokeStyle = col; ctx.lineWidth = lw * D;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    }

    // ニューロン・信号の粒・×印はドット単位で
    const T = ctx.getTransform();
    dotSpace(ctx);
    // 信号の粒 (2×2 ドット)
    if (mode === 'activity') {
      for (const [a, b, sv, k] of pulses) {
        const t = (time * (0.8 + Math.min(1.5, Math.abs(sv) * 0.5)) + (k * 0.618) % 1) % 1;
        const [X, Y] = toDot(ctx, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, T);
        ctx.fillStyle = sv >= 0 ? PAL.g3 : PAL.white;
        ctx.fillRect(Math.round(X) - 1, Math.round(Y) - 1, 2, 2);
      }
    }

    // ── ニューロン ──
    for (let l = 0; l < L; l++) {
      const R = Math.max(1, Math.round(this.radius(l) / D));
      for (let i = 0; i < sizes[l]; i++) {
        const p = pos[l][i], v = acts ? acts[l][i] : 0;
        const [X, Y] = toDot(ctx, p.x, p.y, T);
        const knocked = knock && knock[l][i];
        const isSel = focus && focus.l === l && focus.i === i;
        if (!knocked && Math.abs(v) > 0.4 && mode === 'activity') pixelDisc(ctx, X, Y, R + 2, v >= 0 ? PAL.o0 : PAL.b0);
        let ring = l === 0 ? GROUP_COLOR[inputs[i].group] : l === L - 1 ? muscleColor(i, 2) : PAL.n6;
        if (mode === 'mutation' && par && l > 0) { const bi = biasIndex(sizes, l, i); if (Math.abs(g[bi] - par[bi]) > 1e-6) ring = PAL.p2; }
        if (isSel) pixelDisc(ctx, X, Y, R + 2, PAL.white);
        pixelDisc(ctx, X, Y, R, knocked ? PAL.n4 : ring);
        if (R >= 2) pixelDisc(ctx, X, Y, R - 1, knocked ? PAL.n2 : mode === 'activity' ? (signedColor(v, 0.15) || PAL.n2) : PAL.n2);
        if (knocked) {
          ctx.fillStyle = PAL.r2;
          for (let q = -R; q <= R; q++) { ctx.fillRect(Math.round(X) + q, Math.round(Y) + q, 1, 1); ctx.fillRect(Math.round(X) + q, Math.round(Y) - q, 1, 1); }
        }
      }
    }
    // 出力の色見本 (筋肉の色)
    {
      const R = Math.max(1, Math.round(this.radius(L - 1) / D));
      outputs.forEach((o, j) => {
        const [X, Y] = toDot(ctx, pos[L - 1][j].x, pos[L - 1][j].y, T);
        ctx.fillStyle = muscleColor(j, 2);
        ctx.fillRect(Math.round(X) + R + 2, Math.round(Y) - 1, 4, 2);
      });
    }
    ctx.restore();

    // ── ラベル ──
    const fs = clamp(this.inSp * 0.85, 7, 12);
    ctx.textBaseline = 'middle';
    if (fs >= 9.5) {
      ctx.font = `${fs}px system-ui`; ctx.textAlign = 'right';
      inputs.forEach((inp, i) => {
        const p = pos[0][i];
        const isF = focus && focus.l === 0 && focus.i === i;
        ctx.fillStyle = isF ? PAL.white : GROUP_COLOR[inp.group];
        ctx.fillText(inp.label, p.x - this.r0 - 5, p.y);
      });
    } else {
      // 小さすぎる時はグループ名だけ
      ctx.font = '11px system-ui'; ctx.textAlign = 'right';
      for (const gr of this.groups) {
        const a = pos[0][gr.start], b = pos[0][gr.start + gr.n - 1];
        ctx.fillStyle = GROUP_COLOR[gr.g]; ctx.fillText(GROUP_NAME[gr.g], a.x - this.r0 - 5, (a.y + b.y) / 2);
      }
    }
    ctx.font = '11px system-ui'; ctx.textAlign = 'left';
    outputs.forEach((o, j) => {
      const p = pos[L - 1][j], r = this.radius(L - 1);
      ctx.fillStyle = muscleColor(j, 2);
      ctx.fillText(o.label, p.x + r + 15, p.y);
    });
    ctx.textBaseline = 'alphabetic';
  }
}
