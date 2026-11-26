/* =====================================================================
   SoftEvo — randbody.js
   「おまかせ」: 毎回ちがう体をつくる
   ・背骨 (2〜5節) の高さ・間隔・反り、腹の補強、脚 (0〜5本・1〜2関節)、頭、しっぽ を乱数で決める
   ・筋肉は関節をまたぐように張る (脚の振り・ひざ・背骨の曲げ・しっぽ・首)
   ・座標は 5cm 刻み (設計画面のマス目) なので、そのまま手で直せる
   ===================================================================== */
import { validateBlueprint } from './sim.js';

const MAX_NODES = 24, MAX_EDGES = 64;
const snap = v => Math.round(v / 5) * 5;

export function randomBody(rand = Math.random) {
  for (let tries = 0; tries < 40; tries++) {
    const bp = build(rand);
    if (bp && !validateBlueprint(bp) && bp.nodes.length <= MAX_NODES && bp.edges.length <= MAX_EDGES) return bp;
  }
  return null;
}

function build(rand) {
  const R = (a, b) => a + (b - a) * rand();
  const RI = (a, b) => Math.floor(R(a, b + 1));
  const chance = p => rand() < p;
  const nodes = [], edges = [], seen = new Set();
  const node = (x, y) => {
    x = snap(x); y = Math.max(0, snap(y));
    const k = nodes.findIndex(n => n.x === x && n.y === y);
    if (k >= 0) return k;
    nodes.push({ x, y });
    return nodes.length - 1;
  };
  const edge = (a, b, type) => {
    if (a === b) return;
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ a, b, type });
  };

  // ── 背骨 ──
  const plan = rand();
  const crawler = plan < 0.14;                 // 脚なし (シャクトリ / イモムシ型)
  const segs = crawler ? RI(3, 5) : RI(2, 4);
  const gap = R(22, 40);
  const H = crawler ? R(15, 30) : R(30, 75);
  const arch = R(-12, 18);
  const spine = [];
  for (let i = 0; i < segs; i++) {
    const t = segs > 1 ? i / (segs - 1) : 0.5;
    spine.push(node((i - (segs - 1) / 2) * gap, H + arch * Math.sin(Math.PI * t)));
  }
  for (let i = 1; i < segs; i++) edge(spine[i - 1], spine[i], 'bone');

  // ── 腹 (トラスで背骨を補強。脚なしなら腹が地面をこする) ──
  const belly = [];
  if (crawler || chance(0.55)) {
    const depth = crawler ? H : R(12, Math.max(14, H * 0.5));
    for (let i = 0; i < segs - 1; i++) {
      const a = nodes[spine[i]], b = nodes[spine[i + 1]];
      const k = node((a.x + b.x) / 2, Math.min(a.y, b.y) - depth);
      belly.push(k);
      edge(spine[i], k, 'bone'); edge(spine[i + 1], k, 'bone');
      if (i > 0) edge(belly[i - 1], k, crawler ? 'muscle' : chance(0.5) ? 'muscle' : 'bone');
    }
  }
  // 背骨を曲げる筋肉 (1つ飛ばしで張る)
  for (let i = 0; i + 2 < segs; i++) if (crawler || chance(0.6)) edge(spine[i], spine[i + 2], 'muscle');
  if (crawler) {
    // 腹と背中のあいだにも筋肉 (伸び縮みで這う)
    for (let i = 0; i < belly.length; i++) if (chance(0.7)) edge(belly[i], spine[i + (chance(0.5) ? 0 : 1)], 'muscle');
  }

  // ── 脚 ──
  if (!crawler) {
    // どの節から脚を出すか: 前と後ろは必ず。間はおまかせ (二足なら1か所)
    const biped = segs === 2 && chance(0.3);
    const hips = biped ? [spine[0]] : spine.filter((_, i) => i === 0 || i === segs - 1 || chance(0.45));
    const twoJoint = chance(0.65);
    const splay = R(0, 18);
    for (const [hi, hip] of hips.entries()) {
      const p = nodes[hip];
      const lean = (hi === 0 ? -1 : 1) * splay * (hips.length > 1 ? 1 : 0);
      const pairs = biped ? [-1, 1] : [0];
      for (const side of pairs) {
        const fx = p.x + lean + side * R(10, 22);
        const foot = node(fx, 0);
        if (twoJoint) {
          const kneeOut = R(-14, 14);
          const knee = node((p.x + fx) / 2 + kneeOut, p.y * R(0.4, 0.6));
          edge(hip, knee, 'bone'); edge(knee, foot, 'bone');
          // 脚の振り: となりの節 (なければ腹/頭側) → ひざ
          const anchor = spine[spine.indexOf(hip) + (spine.indexOf(hip) > 0 ? -1 : 1)] ?? belly[0];
          if (anchor != null) edge(anchor, knee, 'muscle');
          // ひざの曲げ: 腰 → 足
          edge(hip, foot, 'muscle');
        } else {
          edge(hip, foot, 'bone');
          const anchor = spine[spine.indexOf(hip) + (spine.indexOf(hip) > 0 ? -1 : 1)] ?? belly[0];
          if (anchor != null) edge(anchor, foot, 'muscle');
        }
      }
    }
    if (biped) {
      // 二足: 両足のあいだにも筋肉 (歩幅)
      const feet = nodes.map((n, i) => (n.y === 0 ? i : -1)).filter(i => i >= 0);
      if (feet.length >= 2) edge(feet[0], feet[feet.length - 1], 'muscle');
    }
  }

  // ── 頭 ──
  if (chance(0.7)) {
    const front = nodes[spine[segs - 1]];
    const head = node(front.x + R(12, 24), front.y + R(4, 22));
    edge(spine[segs - 1], head, 'bone');
    if (segs >= 2) edge(spine[segs - 2], head, chance(0.5) ? 'muscle' : 'bone');
  }
  // ── しっぽ ──
  if (chance(0.5)) {
    let prev = spine[0], px = nodes[prev].x, py = nodes[prev].y;
    const n = RI(1, 3), dy = R(-12, 6);
    for (let i = 0; i < n; i++) {
      px -= R(14, 22); py = Math.max(5, py + dy);
      const t = node(px, py);
      edge(prev, t, 'bone');
      // しっぽを振る筋肉
      const base = i === 0 ? (spine[1] ?? belly[0]) : prev;
      if (base != null && base !== prev) edge(base, t, 'muscle');
      else if (i > 0) edge(spine[0], t, 'muscle');
      prev = t;
    }
  }
  if (!edges.some(e => e.type === 'muscle')) return null;
  return { nodes, edges };
}

/**
 * 丸い体 (転がって進む生き物向け): 外周 5〜9 点 + 中心 (スポーク) または 弦、ときどきトゲ。
 * 外周の半径・つぶれ方・どこを筋肉にするかは毎回ちがう。座標は 5cm 刻み
 */
export function randomRoundBody(rand = Math.random) {
  for (let tries = 0; tries < 40; tries++) {
    const bp = buildRound(rand);
    if (bp && !validateBlueprint(bp) && bp.nodes.length <= MAX_NODES && bp.edges.length <= MAX_EDGES) return bp;
  }
  return null;
}

function buildRound(rand) {
  const R = (a, b) => a + (b - a) * rand();
  const RI = (a, b) => Math.floor(R(a, b + 1));
  const chance = p => rand() < p;
  const nodes = [], edges = [], seen = new Set();
  const node = (x, y) => {
    x = snap(x); y = Math.max(0, snap(y));
    const k = nodes.findIndex(n => n.x === x && n.y === y);
    if (k >= 0) return k;
    nodes.push({ x, y });
    return nodes.length - 1;
  };
  const edge = (a, b, type) => {
    if (a === b) return;
    const key = a < b ? `${a}-${b}` : `${b}-${a}`;
    if (seen.has(key)) return;
    seen.add(key);
    edges.push({ a, b, type });
  };
  // ── 外周 ──
  const K = RI(5, 9), r0 = R(25, 45), squash = R(0.8, 1.15), cy = r0 * squash + 5, phase = R(0, Math.PI * 2 / K);
  const rim = [];
  for (let i = 0; i < K; i++) {
    const a = phase + i / K * Math.PI * 2, rr = r0 * R(0.85, 1.15);
    const k = node(Math.sin(a) * rr, cy + Math.cos(a) * rr * squash);
    if (!rim.includes(k)) rim.push(k);
  }
  const N = rim.length;
  if (N < 4) return null;
  for (let i = 0; i < N; i++) edge(rim[i], rim[(i + 1) % N], chance(0.2) ? 'muscle' : 'bone');
  // ── 中心とスポーク、または 弦 ──
  if (chance(0.75)) {
    const hub = node(R(-5, 5), cy + R(-5, 5));
    for (let i = 0; i < N; i++) edge(hub, rim[i], chance(0.6) ? 'muscle' : 'bone');
  } else {
    for (let i = 0; i < N; i++) edge(rim[i], rim[(i + Math.floor(N / 2)) % N], chance(0.6) ? 'muscle' : 'bone');
    for (let i = 0; i < N; i += 2) if (chance(0.5)) edge(rim[i], rim[(i + 2) % N], 'bone');
  }
  // ── トゲ (0〜2本。体に表情が出る) ──
  for (let s = RI(0, 2); s > 0; s--) {
    const i = RI(0, N - 1), p = nodes[rim[i]], c = { x: 0, y: cy };
    const dx = p.x - c.x, dy = p.y - c.y, d = Math.hypot(dx, dy) || 1, len = R(10, 20);
    const tip = node(p.x + dx / d * len, p.y + dy / d * len);
    edge(rim[i], tip, 'bone');
    edge(rim[(i + 1) % N], tip, chance(0.5) ? 'muscle' : 'bone');
  }
  // 筋肉は 3本以上 (足りなければ骨を筋肉に)
  let muscles = edges.filter(e => e.type === 'muscle').length;
  for (const e of edges) { if (muscles >= 3) break; if (e.type === 'bone' && chance(0.5)) { e.type = 'muscle'; muscles++; } }
  if (muscles < 1) return null;
  return { nodes, edges };
}
