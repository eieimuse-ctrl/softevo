#!/usr/bin/env node
/* =====================================================================
   Softevo Reels — エピソードをつくる (v2: 音ハメの台本つき。動画の文字はすべて英語)
   ---------------------------------------------------------------------
   台本「drop16」= 16秒・120 BPM・8小節 (1拍 = 15コマ, 1小節 = 60コマ @30fps)。
   カットも文字も効果音も、すべて拍の頭にそろえる。
     小節1  0:00 つかみ     第0世代 (ランダムな脳) が倒れる。倒れた瞬間 = 拍の頭
     小節2  0:02 成長       2つの世代を拍の頭で切り替え
     小節3  0:04 惜しい!    ゴールの旗の数cm手前で時間切れ
     小節4  0:06 最後の挑戦  スネアの連打で盛り上げ、4拍目はスロー + 無音
     小節5  0:08 ゴール      旗を越える瞬間 = 曲のドロップ
     小節6  0:10 勝利の走り
     小節7  0:12 結果       第0世代 → 最終世代
     小節8  0:14 呼びかけ    フォロー・名前をつけて。巻き戻して最初のコマへ (ループ)
   距離は「鼻先」(いちばん前の節点) で測る。旗に触れた見た目と数字が一致するように。

   使い方:
     node reel/make-episode.mjs --ep 2                       いろいろな体をオーディションして自動で選ぶ
     node reel/make-episode.mjs --ep 2 --seed 777            オーディションの種 (同じ種なら同じ回)
     node reel/make-episode.mjs --ep 1 --body-seed 230732    体を決めて作る
     オプション: --cast 24 (候補の数) --cast-gens 30 --finalists 4 --gens 300 --goal 10 (m) --out path
       --hook compare|fail|preview   最初の1秒 (上下比較 / 失敗だけ / 成功の先出し)。1回に変えるのは1つまで
       --color purple                生物の色 (red orange lime teal blue purple pink)。省略時は番号で順番に
       --name BOB                    この生物の名前 (コメントで決まったら)
       --prev BOB                    前の回の生物に決まった名前 (この回の途中で発表する)
       --shape round                 丸い体だけでオーディション (転がる生き物向け)
       --motion roll                 転がって進む (12秒で2回転以上) 体だけを選ぶ。見出しは AI LEARNS TO ROLL
       --title "..."                 見出しを変える
   ===================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mod = f => import(pathToFileURL(path.join(here, '..', 'js', f)).href);
const { Evolver } = await mod('evo.js');
const { DEFAULT_SETTINGS, brainLayout, Creature, FPS } = await mod('sim.js');
const { randomBody, randomRoundBody } = await mod('randbody.js');

// ─── 引数 ───
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) { const k = a.slice(2), v = process.argv[i + 1]; if (v == null || v.startsWith('--')) args[k] = true; else { args[k] = v; i++; } }
}
if (!args.ep) { console.error('使い方: node reel/make-episode.mjs --ep <番号> [--body-seed N | --seed N --cast 24] [--gens 300] [--goal 10]'); process.exit(1); }
const EP = +args.ep, TAG = `#${String(EP).padStart(3, '0')}`;
const SEED = args.seed != null ? (+args.seed >>> 0) : (Math.random() * 2 ** 32) >>> 0;
const GENS = +(args.gens || 300);
const OUT = args.out || path.join(here, 'episodes', `ep${String(EP).padStart(3, '0')}.json`);

// 種から決まる乱数 (mulberry32)
function rng32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const settings = { ...DEFAULT_SETTINGS };
const env = { terrain: settings.terrain, objective: settings.objective, gravity: settings.gravity, friction: settings.friction, evalSeconds: settings.evalSeconds };
const EVAL = settings.evalSeconds;

// ─── 台本 drop16 のコマ (30fps・120 BPM) ───
const VFPS = 30, BPM = 120, BEAT = VFPS * 60 / BPM; // 15コマ
const F = { hook: 0, brainOn: 30, m1: 60, m2: 90, almost: 120, timeUp: 150, final: 180, slow: 225, drop: 240, goalSub: 300, result: 360, cta: 420, end: 480 };
const HOOK = args.hook || 'compare';
if (!['compare', 'fail', 'preview'].includes(HOOK)) { console.error('--hook は compare / fail / preview'); process.exit(1); }

// ─── 体・進化・測定 ───
/** 体の種 → 体と進化の種 (同じ種なら同じ体・同じ進化) */
const SHAPE = args.shape === 'round' ? 'round' : 'any', MOTION = args.motion === 'roll' ? 'roll' : 'any';
function bodyOf(seed) { const r = rng32(seed); const bp = SHAPE === 'round' ? randomRoundBody(r) : randomBody(r); return { seed, bp, evoSeed: (r() * 2 ** 31) | 0 }; }
/** 体が何回転したか (12秒)。転がって進むなら数回転 */
function turnsOf(bp, layout, g, secs = EVAL) {
  const c = new Creature(bp, layout, g, env);
  let prev = c.tilt, acc = 0;
  for (let k = 0; k < secs * FPS; k++) {
    c.step();
    let d = c.tilt - prev; prev = c.tilt;
    if (d > Math.PI) d -= 2 * Math.PI; else if (d < -Math.PI) d += 2 * Math.PI;
    acc += d;
  }
  return Math.abs(acc) / (2 * Math.PI);
}
const front = c => { let m = -Infinity; for (let i = 0; i < c.n; i++) if (c.x[i] > m) m = c.x[i]; return m; };
/** 鼻先の進み (cm) を 1/60 秒ごとに */
function noseRun(bp, layout, g, secs) {
  const c = new Creature(bp, layout, g, env), f0 = front(c), tr = new Float64Array(Math.round(secs * FPS) + 1);
  for (let k = 1; k < tr.length; k++) { c.step(); tr[k] = front(c) - f0; }
  return tr;
}
function evolve(body, gens, quiet) {
  const ev = new Evolver(body.bp, settings, { seed: body.evoSeed });
  const pop0 = ev.pop.map(p => Float32Array.from(p.g)); // 第0世代 = ランダムな脳
  const recs = []; let best = -Infinity, s;
  for (let g = 0; g < gens; g++) {
    s = ev.runGeneration();
    if (s.best > best + 1) { best = s.best; recs.push({ gen: s.gen, cen: s.best, g: Float32Array.from(s.champ.genome) }); }
    if (!quiet && (g + 1) % 100 === 0) console.log(`    第${g + 1}世代  最高 ${(s.bestEver / 100).toFixed(2)} m`);
  }
  return { recs, pop0, bestEver: s.bestEver };
}
/** 第0世代から「倒れる」(なければ「動けない」) 個体を選ぶ */
function pickFail(body, layout, pop0) {
  let head = 0; body.bp.nodes.forEach((p, i) => { if (p.y > body.bp.nodes[head].y) head = i; });
  let y0 = Infinity; for (const p of body.bp.nodes) y0 = Math.min(y0, p.y);
  const tall = body.bp.nodes[head].y - y0 >= 40; // 頭が地面から 40cm 以上 → 倒れると分かる
  const out = [];
  pop0.forEach((g, k) => {
    const c = new Creature(body.bp, layout, g, env), f0 = front(c);
    let tI = -1;
    for (let s = 1; s <= EVAL * FPS; s++) { c.step(); if (tI < 0 && c.contact[head]) tI = s; }
    out.push({ k, tI, d: front(c) - f0 });
  });
  const falls = tall ? out.filter(o => o.tI >= 0.3 * FPS && o.tI <= 1.2 * FPS && Math.abs(o.d) < 40).sort((a, b) => Math.abs(a.d) - Math.abs(b.d)) : [];
  const o = falls[0] || out.slice().sort((a, b) => Math.abs(a.d) - Math.abs(b.d))[0];
  return { ...o, kind: falls.length ? 'fall' : 'still', g: pop0[o.k] };
}
/** ゴールの距離と見せる世代を選ぶ。旗の数cm手前で終わる「惜しい」世代があるほど高得点 */
function plan(body, run) {
  const layout = brainLayout(body.bp, settings);
  for (const r of run.recs) { r.tr = noseRun(body.bp, layout, r.g, EVAL + 8); r.nose = r.tr[EVAL * FPS]; }
  const fin = run.recs.reduce((a, b) => (b.nose > a.nose ? b : a));
  const goals = args.goal ? [+args.goal] : [5, 6, 8, 10, 12, 15, 20, 25, 30];
  let best = null;
  for (const G of goals) {
    const Gc = G * 100, ci = fin.tr.findIndex(v => v >= Gc);
    if (ci < 0) continue;
    const c = ci / FPS;
    if (c < 3 || c > 9) continue; // 最後の挑戦はゴールの 2.5 秒前から見せる
    let al = null;
    for (const r of run.recs) if (r.gen < fin.gen && r.nose < Gc && (!al || r.nose > al.nose)) al = r;
    if (!al || Gc - al.nose > 0.15 * Gc) continue;
    const pool = run.recs.filter(r => r.gen < al.gen && r.nose > 0.2 * Gc && r.nose < al.nose - 0.08 * Gc);
    const near = (p, not) => pool.filter(r => r !== not).sort((a, b) => Math.abs(a.nose - p * Gc) - Math.abs(b.nose - p * Gc))[0];
    const n1 = near(0.4), n2 = near(0.7, n1);
    if (!n1 || !n2) continue;
    const [m1, m2] = n1.gen < n2.gen ? [n1, n2] : [n2, n1];
    if (m2.nose <= m1.nose + 0.1 * Gc) continue;
    const gap = Gc - al.nose;
    const score = 60 * (1 - gap / (0.15 * Gc)) + (G % 5 === 0 ? 8 : 0) + Math.min(G, 20) * 0.5;
    if (!best || score > best.score) best = { G, c, al, m1, m2, fin, gap, score, layout };
  }
  if (!best) return null;
  best.turns = turnsOf(body.bp, best.layout, best.fin.g);
  if (MOTION === 'roll') { if (best.turns < 2) return null; best.score += Math.min(best.turns, 8) * 2; }
  best.fail = pickFail(body, best.layout, run.pop0);
  best.score += best.fail.kind === 'fall' ? 15 : 0;
  best.lock = strideLock(body, best.layout, best.fin.g, best.c); // 歩調が規則正しい = 勝利の走りを拍に合わせられる
  best.score += best.lock ? 10 : 0;
  const n = body.bp.nodes.length;
  best.score += n >= 6 && n <= 14 ? 5 : 0;
  return best;
}

// ─── 体を決める (オーディション) ───
let body, run, P;
if (args['body-seed'] != null) {
  body = bodyOf(+args['body-seed'] >>> 0);
  console.log(`${TAG}  体の種 ${body.seed}: ノード${body.bp.nodes.length} 辺${body.bp.edges.length}  ${GENS}世代を進化中…`);
  run = evolve(body, GENS);
  P = plan(body, run);
  if (!P) { console.error('この体では台本の条件 (惜しい世代・ゴールの時間) を満たせませんでした。--goal を変えるか別の体で。'); process.exit(1); }
} else {
  const N = Math.max(2, +(args.cast || 24)), CG = +(args['cast-gens'] || 30), K = Math.max(1, +(args.finalists || 4));
  const rand = rng32(SEED);
  console.log(`${TAG}  オーディション (種 ${SEED}): ${N}体 × ${CG}世代 → 上位${K}体を ${GENS}世代`);
  const quick = [];
  for (let k = 0; k < N; k++) {
    const b = bodyOf((rand() * 2 ** 31) >>> 0);
    const r = evolve(b, CG, true);
    quick.push({ b, score: r.bestEver });
    console.log(`  候補${String(k + 1).padStart(2)}: 体の種 ${b.seed}  ノード${String(b.bp.nodes.length).padStart(2)}  ${(r.bestEver / 100).toFixed(2)} m`);
  }
  quick.sort((a, b) => b.score - a.score);
  for (const q of quick.slice(0, K)) {
    console.log(`  本番: 体の種 ${q.b.seed}`);
    const r = evolve(q.b, GENS), p = plan(q.b, r);
    if (!p) { console.log(MOTION === 'roll' ? '    → 台本に合わないか、転がっていない' : '    → 台本に合わず'); continue; }
    console.log(`    → ゴール ${p.G} m・惜しい世代 ${p.al.gen} (${(p.gap).toFixed(1)} cm 手前)・第0世代 ${p.fail.kind}・歩調 ${p.lock ? '拍に合う' : '不規則'}・${p.turns.toFixed(1)}回転・ノード ${q.b.bp.nodes.length}・点 ${p.score.toFixed(1)}`);
    if (!P || p.score > P.score) { P = p; body = q.b; run = r; }
  }
  if (!P) { console.error('台本に合う体が見つかりませんでした。--cast を増やすか --seed を変えて。'); process.exit(1); }
  console.log(`  → 体の種 ${body.seed} に決定 (同じ回を作り直すときは --body-seed ${body.seed})`);
}

// ─── 時間の割り付け: コマ → シミュレーションの秒 ───
const { G, c, al, m1, m2, fin, fail, layout } = P;
const ROLLING = MOTION === 'roll' && P.turns >= 2; // 転がって進む回 (--motion roll のときだけ見出しなどを変える)
const r2 = v => Math.round(v * 1000) / 1000;
// つかみ: 倒れた瞬間 (頭が地面に着く) を拍の頭に合わせる。f0 = 第0世代が動き出すコマ
function hookMapFrom(f0) {
  if (fail.kind !== 'fall') return { map: [[f0, 0], [60, r2((60 - f0) / VFPS)]], fI: null };
  const tI = fail.tI / FPS;
  let bestF = null;
  for (const f of [15, 30, 45].map(x => x + f0).filter(x => x < 60)) { const sp = tI / ((f - f0) / VFPS); if (sp >= 0.6 && sp <= 1.5 && (!bestF || Math.abs(Math.log(sp)) < Math.abs(Math.log(bestF.sp)))) bestF = { f, sp }; }
  if (!bestF) return { map: [[f0, 0], [60, r2((60 - f0) / VFPS)]], fI: null };
  return { map: [[f0, 0], [bestF.f, r2(tI)], [60, r2(tI + (60 - bestF.f) / VFPS)]], fI: bestF.f };
}
const endMap = (f0, f1, sp) => [[f0, r2(EVAL - (f1 - f0) / VFPS * sp)], [f1, EVAL]];
// 最後の挑戦の歩調を曲に合わせる: 体が地面に着く瞬間 (いちばん低くなる時) を拍の頭に。
// 歩き方が規則正しければ、ゴールの直後の着地 = ドロップ、勝利の走りは 1歩 = 1拍 (キックと同時に着地)
function strideLock(body, layout, finG, c) {
  const c0 = new Creature(body.bp, layout, finG, env), Hs = [], As = [];
  for (let k = 0; k < (c + 8) * FPS; k++) {
    c0.step();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = 0; i < c0.n; i++) { x0 = Math.min(x0, c0.x[i]); x1 = Math.max(x1, c0.x[i]); y0 = Math.min(y0, c0.y[i]); y1 = Math.max(y1, c0.y[i]); }
    Hs.push(y1); As.push((y1 - y0) / Math.max(1, x1 - x0));
  }
  // 歩調の周期 = 体の高さの自己相関がいちばん高い遅れ (ゴールの前後)。1歩が2つの小さな蹴りでできていても拾える
  const a = Math.max(0, Math.round((c - 3) * FPS)), b = Math.min(Hs.length, Math.round((c + 5) * FPS));
  const seg = Hs.slice(a, b), mean = seg.reduce((x, y) => x + y, 0) / seg.length, z = seg.map(v => v - mean);
  const v0 = z.reduce((x, v) => x + v * v, 0) / z.length;
  if (v0 < 1) return null; // ほとんど上下しない
  const r = L => { let t = 0; for (let i = 0; i + L < z.length; i++) t += z[i] * z[i + L]; return t / (z.length - L) / v0; };
  let lag = 0, rBest = 0;
  for (let L = Math.round(0.25 * FPS); L <= Math.round(2 * FPS); L++) { const v = r(L); if (v > rBest) { rBest = v; lag = L; } }
  if (rBest < 0.8) return null; // 規則正しくない
  const y0 = r(lag - 1), y2 = r(lag + 1), den = y0 - 2 * rBest + y2;
  const Lc = (lag + (den ? 0.5 * (y0 - y2) / den : 0)) / FPS; // 1コマより細かく
  const tro = [];
  for (let k = 1; k < Hs.length - 1; k++) if (Hs[k] < Hs[k - 1] && Hs[k] <= Hs[k + 1]) tro.push((k + 1) / FPS);
  const tStar = tro.find(t => t >= c); // ゴール直後の着地 = ドロップ
  if (tStar == null || tStar - c > 0.6) return null;
  const pick = (cands, lo, hi, want) => cands.filter(v => v >= lo && v <= hi).sort((x, y) => Math.abs(x - want) - Math.abs(y - want))[0];
  const sV = pick([Lc / 0.5, Lc / 1, Lc / 2], 0.6, 1.5, 1);        // 勝利の走り: 1周期 = 1/2/4 拍
  if (!sV) return null;
  const sA = pick([sV * 2, sV * 4], 1.2, 2.4, 1.7);                // 最後の挑戦: その倍 (8分音符に1歩)
  if (!sA) return null;
  const P = sV * 0.5;                                               // 1拍あたりのシミュレーションの秒
  const delta = clamp(tStar - c + 0.08, 0.15, 0.45);               // 鼻先がゴールを越えるのはスローの中
  // 寝そべって進む? (走っている間の縦横比が、設計図よりずっと平たい)
  let x0 = Infinity, x1 = -Infinity, yy0 = Infinity, yy1 = -Infinity;
  for (const p of body.bp.nodes) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); yy0 = Math.min(yy0, p.y); yy1 = Math.max(yy1, p.y); }
  const run = As.slice(Math.round((c - 2) * FPS), Math.round((c + 4) * FPS)), avgA = run.reduce((x, y) => x + y, 0) / run.length;
  const restA = (yy1 - yy0) / Math.max(1, x1 - x0);
  return { P, tStar, sV, sA, delta, cycle: Lc, regularity: rBest, lying: restA > 1 && avgA < 0.6 * restA };
}
const lock = P.lock;
const finalMap = lock
  ? [[F.final, r2(lock.tStar - lock.delta - (F.slow - F.final) / VFPS * lock.sA)], [F.slow, r2(lock.tStar - lock.delta)], [F.drop, r2(lock.tStar)], [F.cta, r2(lock.tStar + (F.cta - F.drop) / VFPS * lock.sV)]]
  : [[F.final, r2(c - 2.5)], [F.slow, r2(c - 0.25)], [F.drop, r2(c)], [F.cta, r2(c + 6)]];
const finalEnd = finalMap[finalMap.length - 1][1];
// 最終世代が調子よく進んでいる1秒 (着地が拍の頭に来る。上下比較・先出し用)
const runMap = f0 => {
  if (!lock) return [[f0, r2(Math.max(1, c - 3))], [f0 + 30, r2(Math.max(1, c - 3) + 1)]];
  const t0 = lock.tStar - Math.round(3 / lock.P) * lock.P; // ゴールの 3 秒ほど前の着地
  return [[f0, r2(t0)], [f0 + 30, r2(t0 + lock.sV)]];
};
let hookSegs, fI;
if (HOOK === 'fail') {
  const h = hookMapFrom(0); fI = h.fI;
  hookSegs = [{ id: 'hook', from: 0, to: F.m1, genome: 'f0', gen: 0, map: h.map }];
} else if (HOOK === 'compare') {
  const h = hookMapFrom(0); fI = h.fI;
  hookSegs = [
    { id: 'split', from: 0, to: 30, genome: 'f0', gen: 0, map: h.map, genomeB: String(fin.gen), genB: fin.gen, mapB: runMap(0) },
    { id: 'hook', from: 30, to: F.m1, genome: 'f0', gen: 0, map: h.map },
  ];
} else {
  const h = hookMapFrom(30); fI = h.fI;
  hookSegs = [
    { id: 'preview', from: 0, to: 30, genome: String(fin.gen), gen: fin.gen, map: runMap(0) },
    { id: 'hook', from: 30, to: F.m1, genome: 'f0', gen: 0, map: h.map },
  ];
}
const segments = [
  ...hookSegs,
  { id: 'm1', from: F.m1, to: F.m2, genome: String(m1.gen), gen: m1.gen, map: endMap(F.m1, F.m2, 1.5) },
  { id: 'm2', from: F.m2, to: F.almost, genome: String(m2.gen), gen: m2.gen, map: endMap(F.m2, F.almost, 1.5) },
  { id: 'almost', from: F.almost, to: F.final, genome: String(al.gen), gen: al.gen, map: [...endMap(F.almost, F.timeUp, 1.5), [F.final, EVAL]] },
  // 速め → 最後の1拍はスロー (無音) → ドロップ = ゴール直後の着地 → 1歩 = 1拍で勝利の走り
  { id: 'final', from: F.final, to: F.cta, genome: String(fin.gen), gen: fin.gen, map: finalMap },
  // 巻き戻し (なめらかに加速・減速)。最後の数コマは最初のコマと同じ姿 → つなぎ目なくループ
  { id: 'cta', from: F.cta, to: F.end, genome: String(fin.gen), gen: fin.gen, map: [[F.cta, finalEnd], [F.end - 6, 0, 'inOut'], [F.end, 0]], morphTo: 'f0' },
];
const events = [];
if (fI != null) events.push({ f: fI, type: 'bonk' });
for (const f of [...(HOOK === 'fail' ? [] : [30]), F.m1, F.m2, F.almost, F.final]) events.push({ f, type: 'cut' });
events.push({ f: F.timeUp, type: 'fail' }, { f: F.drop, type: 'goal' }, { f: F.result, type: 'count' }, { f: F.cta, type: 'rewind' });

// ─── 生物の色 (筋肉の色・接地の金色とかぶらないもの。番号で順番に) ───
const HUES = { red: 355, orange: 25, lime: 90, teal: 160, blue: 210, purple: 265, pink: 315 };
const MUSCLE_ORDER = ['pink', 'lime', 'blue', 'orange', 'teal', 'purple', 'gold', 'red'];
const used = new Set(MUSCLE_ORDER.slice(0, body.bp.edges.filter(e => e.type === 'muscle').length));
const free = ['purple', 'red', 'teal', 'orange', 'pink', 'lime', 'blue'].filter(k => !used.has(k));
const COLOR = args.color && HUES[args.color] != null ? args.color : (free.length ? free : Object.keys(HUES))[(EP - 1) % (free.length || 7)];

// ─── 文字 (英語) ───
const m = v => `${Math.max(0, v / 100).toFixed(1)} m`;
const gapCm = Math.max(1, Math.round(P.gap));
const pop = settings.population;
const tries = (fin.gen + 1) * pop;
const texts = {
  title: args.title ? String(args.title).toUpperCase() : ROLLING ? 'AI LEARNS TO ROLL' : 'AI LEARNS TO WALK',
  goal: `${G} m`,
  hookSub: 'random brain',
  hookFail: fail.kind === 'fall' ? "CAN'T EVEN STAND" : "CAN'T MOVE",
  compareMid: `${fin.gen} generations later`,
  prev: args.prev ? `#${String(EP - 1).padStart(3, '0')} is now ${String(args.prev).toUpperCase()}` : null,
  timeUp: 'TIME!',
  almost: 'SO CLOSE...',
  almostShort: `${gapCm} cm short`,
  goalBig: 'GOAL!',
  goalSub: ROLLING ? 'nobody taught it to roll' : 'nobody taught it how',
  result: [`GEN 0`, `GEN ${fin.gen}`, m(fail.d), m(fin.nose), `${tries.toLocaleString('en-US')} tries`],
  cta: ['FOLLOW', 'for the next creature', 'Name it ↓'],
};
const hashtags = ['#ai', '#evolution', '#neuralnetwork', '#machinelearning', '#simulation', '#pixelart']; // 少なめ・内容に合うものだけ
const caption = [
  fail.kind === 'fall' ? "Gen 0 couldn't even stand." : "Gen 0 couldn't move an inch.",
  `Gen ${al.gen} missed the ${G} m flag by ${gapCm} cm.`,
  ROLLING
    ? `Gen ${fin.gen} figured out rolling — ${P.turns.toFixed(0)} turns, ${m(fin.nose)} in ${EVAL} s. 🧬`
    : lock && lock.lying && fail.kind === 'fall'
      ? `Gen ${fin.gen} never learned to stand either — it invented its own way to move: ${m(fin.nose)} in ${EVAL} s. 🧬`
      : `Gen ${fin.gen} made it: ${m(fin.nose)} in ${EVAL} s. 🧬`,
  '',
  `Random body, random brain. Nobody taught it how — just ${tries.toLocaleString('en-US')} tries of evolution.`,
  '',
  '👇 Name this creature',
  '',
  hashtags.join(' '),
].join('\n');

const b64 = f => Buffer.from(f.buffer, f.byteOffset, f.byteLength).toString('base64');
const episode = {
  format: 'softevo-reel/2', template: 'drop16', hook: HOOK, shape: SHAPE,
  creature: { name: args.name ? String(args.name).toUpperCase() : null, color: COLOR },
  episode: EP, tag: TAG, seed: SEED, bodySeed: body.seed, generations: GENS,
  fps: VFPS, bpm: BPM, beat: BEAT, frames: F.end, at: F,
  settings, blueprint: body.bp,
  goal: G,
  stride: lock ? { period: r2(lock.P), drop: r2(lock.tStar), victorySpeed: r2(lock.sV), approachSpeed: r2(lock.sA) } : null,
  stats: { turns: r2(P.turns), g0: r2(fail.d / 100), final: r2(fin.nose / 100), finalGen: fin.gen, almostGen: al.gen, gapCm, cross: r2(c), tries, failKind: fail.kind, failIndex: fail.k, nodes: body.bp.nodes.length, muscles: body.bp.edges.filter(e => e.type === 'muscle').length, neurons: layout.sizes.reduce((a, b) => a + b, 0) },
  genomes: { f0: b64(fail.g), [m1.gen]: b64(m1.g), [m2.gen]: b64(m2.g), [al.gen]: b64(al.g), [fin.gen]: b64(fin.g) },
  segments, events, texts,
  cover: { top: texts.title, a: 'GEN 0', b: `GEN ${fin.gen}`, aSub: m(fail.d), bSub: m(fin.nose) },
  caption, hashtags,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(episode, null, 1));
console.log(`\n書き出し: ${path.relative(process.cwd(), OUT)}  (16 秒・${F.end} コマ)`);
console.log(`  ゴール ${G} m (最終世代 ${fin.gen} が ${c.toFixed(2)} 秒で到達・12秒で ${m(fin.nose)})`);
console.log(lock ? `  歩調: 1歩 ${lock.P.toFixed(3)} 秒 → ドロップ = ${lock.tStar.toFixed(3)} 秒の着地・勝利の走り ×${lock.sV.toFixed(2)} (1拍 ${(0.5 * lock.sV / lock.P).toFixed(2)} 歩)` : '  歩調: 不規則なので拍には合わせない');
console.log(`  第0世代 #${fail.k} ${fail.kind}${fI != null ? ` (倒れる瞬間 = ${fI} コマ目)` : ''}  →  第${m1.gen}世代 ${m(m1.nose)}  →  第${m2.gen}世代 ${m(m2.nose)}  →  第${al.gen}世代 ${m(al.nose)} (${gapCm} cm 手前)`);
