#!/usr/bin/env node
/* =====================================================================
   SoftEvo Reels — エピソードをつくる (動画の中身はすべて英語)
   ---------------------------------------------------------------------
   毎回ちがう体 (🎲 おまかせ) を進化させ、見せ場の世代を自動で選んで
   reel/episodes/epNNN.json に書き出す。再生ページ (reel/index.html) がこれを読んで縦動画の画を描く。

   使い方:
     node reel/make-episode.mjs --ep 1                 (体はおまかせ、種は自動)
     node reel/make-episode.mjs --ep 2 --seed 777      (同じ種なら毎回同じ回ができる)
     node reel/make-episode.mjs --ep 3 --body quad     (プリセットの体: inchworm / quad / biped / snake / wheel)
     node reel/make-episode.mjs --ep 4 --gens 300 --name "Wobbly Bob"
     node reel/make-episode.mjs --ep 5 --cast 6       (6体を短く試して、いちばん伸びそうな体で本番)
   ===================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const mod = f => import(pathToFileURL(path.join(here, '..', 'js', f)).href);
const { Evolver } = await mod('evo.js');
const { DEFAULT_SETTINGS, PRESETS, brainLayout, evaluate, gaitDistance } = await mod('sim.js');
const { randomBody } = await mod('randbody.js');

// ─── 引数 ───
const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a.startsWith('--')) { const k = a.slice(2), v = process.argv[i + 1]; if (v == null || v.startsWith('--')) args[k] = true; else { args[k] = v; i++; } }
}
if (!args.ep) { console.error('使い方: node reel/make-episode.mjs --ep <番号> [--seed N] [--gens N] [--body quad] [--name "..."] [--out path]'); process.exit(1); }
const EP = +args.ep, TAG = `#${String(EP).padStart(3, '0')}`;
const SEED = args.seed != null ? (+args.seed >>> 0) : (Math.random() * 2 ** 32) >>> 0;
const GENS = +(args.gens || 200);
const OUT = args.out || path.join(here, 'episodes', `ep${String(EP).padStart(3, '0')}.json`);

// 種から決まる乱数 (mulberry32)
function rng32(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const rand = rng32(SEED);
const pick = arr => arr[Math.floor(rand() * arr.length)];

// ─── 体 ───
const settings = { ...DEFAULT_SETTINGS };
const env = { terrain: settings.terrain, objective: settings.objective, gravity: settings.gravity, friction: settings.friction, evalSeconds: settings.evalSeconds };
let bp, evoSeed;
if (args.body && args.body !== 'random') {
  if (!PRESETS[args.body]) { console.error(`体の名前が違います: ${args.body} (${Object.keys(PRESETS).join(' / ')})`); process.exit(1); }
  bp = JSON.parse(JSON.stringify(PRESETS[args.body].bp));
  evoSeed = (rand() * 2 ** 31) | 0;
} else if (args.cast) {
  // オーディション: 何体か短く進化させて、いちばん伸びた体を選ぶ
  const N = Math.max(2, +args.cast), CG = +(args['cast-gens'] || 40);
  console.log(`${TAG}  オーディション: ${N}体 × ${CG}世代`);
  let best = null;
  for (let k = 0; k < N; k++) {
    const body = randomBody(rand), sd = (rand() * 2 ** 31) | 0;
    const e = new Evolver(body, settings, { seed: sd });
    let s; for (let g = 0; g < CG; g++) s = e.runGeneration();
    console.log(`  候補${k + 1}: ノード${body.nodes.length}  ${(s.bestEver / 100).toFixed(2)} m`);
    if (!best || s.bestEver > best.score) best = { body, sd, score: s.bestEver, k };
  }
  bp = best.body; evoSeed = best.sd;
  console.log(`  → 候補${best.k + 1} に決定`);
} else { bp = randomBody(rand); evoSeed = (rand() * 2 ** 31) | 0; }
const layout = brainLayout(bp, settings);

// ─── 進化 ───
console.log(`${TAG}  seed=${SEED}  nodes=${bp.nodes.length} edges=${bp.edges.length}  ${GENS} 世代を進化中…`);
const ev = new Evolver(bp, settings, { seed: evoSeed });
const H = [];
let lastGait = null;
for (let g = 0; g < GENS; g++) {
  const s = ev.runGeneration();
  let gaitShift = 0;
  if (s.record || g === 0) { if (lastGait && s.champ.gait) gaitShift = gaitDistance(s.champ.gait, lastGait); lastGait = s.champ.gait; }
  H.push({ gen: s.gen, best: s.best, bestEver: s.bestEver, genome: Float32Array.from(s.champ.genome), record: s.record, gaitShift });
  if ((g + 1) % 50 === 0) console.log(`  第${g + 1}世代  最高 ${(s.bestEver / 100).toFixed(2)} m`);
}

// 12秒の距離 (m, 小数1桁) — 決定論なので再生ページでもまったく同じ距離になる
const distOf = genome => evaluate(bp, layout, genome, env).distance / 100;
const m1 = v => `${Math.max(0, v).toFixed(1)} m`;

// ─── 見せ場の世代を選ぶ ───
const g0 = H[0];
let fin = H[0];
for (const e of H) if (e.best > fin.best) fin = e;
const d0 = distOf(g0.genome), dF = distOf(fin.genome);
const gap = Math.max(3, Math.round(GENS * 0.06));
const cands = [];
const firstStep = H.find(e => e.gen > 0 && e.best >= Math.max(100, g0.best * 2 + 50));
if (firstStep) cands.push({ e: firstStep, kind: 'first', sub: 'first steps', pri: 1 });
let leap = null, leapGain = 0;
for (let i = 1; i < H.length; i++) { const gain = H[i].bestEver - H[i - 1].bestEver; if (gain > leapGain) { leapGain = gain; leap = H[i]; } }
if (leap) cands.push({ e: leap, kind: 'leap', sub: 'breakthrough', pri: 2 });
const gaitE = H.filter(e => e.record && e.gaitShift > 0.22).sort((a, b) => b.gaitShift - a.gaitShift)[0];
if (gaitE) cands.push({ e: gaitE, kind: 'gait', sub: 'new way to move', pri: 3 });
for (const T of [30, 20, 15, 10, 5, 2]) {
  const e = H.find(x => x.best >= T * 100);
  if (e) cands.push({ e, kind: 'break', sub: `breaks ${T} m`, pri: 4 + (30 - T) / 100 });
}
cands.sort((a, b) => a.pri - b.pri);
const chosen = [];
const far = gen => Math.abs(gen - 0) >= gap && Math.abs(gen - fin.gen) >= gap && chosen.every(c => Math.abs(c.e.gen - gen) >= gap);
for (const c of cands) if (chosen.length < 3 && far(c.e.gen)) chosen.push(c);
// 足りなければ途中の世代で埋める
for (let k = 1; chosen.length < 3 && k <= 6; k++) {
  const e = H[Math.round(fin.gen * k / 7)];
  if (e && far(e.gen)) chosen.push({ e, kind: 'progress', sub: 'getting better' });
}
chosen.sort((a, b) => a.e.gen - b.e.gen);

// ─── 台本 (すべて英語) ───
const hooks = [
  ["This creature has never walked.", "Watch it learn."],
  ["Gen 0: a random brain.", "Then evolution kicks in."],
  ["Nobody taught it to walk.", "Watch."],
  ["It can't even stand up.", "Give it a few generations."],
];
const hook = pick(hooks);
const name = args.name || null;
const title = name ? `${name.toUpperCase()} ${TAG}` : `CREATURE ${TAG}`;
const shots = [
  { gen: 0, sec: 4.2, speed: 1, caption: 'GEN 0', sub: 'random brain', hook, hookSec: 2.4 },
  ...chosen.map(c => ({ gen: c.e.gen, sec: 3.6, speed: 1, caption: `GEN ${c.e.gen}`, sub: c.sub, kind: c.kind })),
  { gen: fin.gen, sec: 6, speed: 2, caption: `GEN ${fin.gen}`, sub: `${m1(dF)} in 12 s`, ghost: 0, kind: 'final' },
  { end: true, sec: 3.6 },
];
const neurons = layout.sizes.reduce((a, b) => a + b, 0);
let synapses = 0; for (let l = 1; l < layout.sizes.length; l++) synapses += layout.sizes[l - 1] * layout.sizes[l];
const next = `#${String(EP + 1).padStart(3, '0')}`;
const end = {
  big: `${m1(d0)} → ${m1(dF)}`,
  sub: `in ${fin.gen} generations`,
  cta: ['Evolve your own creature', 'link in bio'],
  ask: `Comment a body for ${next}`,
};
const hashtags = ['#evolution', '#neuralnetwork', '#machinelearning', '#geneticalgorithm', '#artificiallife', '#simulation', '#ai', '#creativecoding', '#pixelart', '#indiedev'];
const caption = [
  `${name ? `${name} (Creature ${TAG})` : `Creature ${TAG}`} learned to walk in ${fin.gen} generations.`,
  `Gen 0: ${m1(d0)} → Gen ${fin.gen}: ${m1(dF)} (12 s)`,
  `Nothing here is animated by hand — a ${neurons}-neuron brain shaped only by evolution.`,
  '',
  `👇 Comment a body part and we'll build Creature ${next}.`,
  '🔗 Evolve your own creature: link in bio',
  '',
  hashtags.join(' '),
].join('\n');

const usedGens = [...new Set([0, fin.gen, ...chosen.map(c => c.e.gen)])];
const b64 = f => Buffer.from(f.buffer, f.byteOffset, f.byteLength).toString('base64');
const episode = {
  format: 'softevo-reel/1',
  episode: EP, tag: TAG, title, name, seed: SEED, generations: GENS,
  settings, blueprint: bp,
  stats: { d0: +d0.toFixed(2), dFinal: +dF.toFixed(2), finalGen: fin.gen, neurons, synapses, nodes: bp.nodes.length, muscles: bp.edges.filter(e => e.type === 'muscle').length },
  genomes: Object.fromEntries(usedGens.map(g => [g, b64(H[g].genome)])),
  shots, end,
  cover: { big: TAG, top: 'CREATURE', sub: `GEN 0 → ${fin.gen}`, sub2: `${m1(d0)} → ${m1(dF)}` },
  caption, hashtags,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(episode, null, 1));
const total = shots.reduce((a, s) => a + s.sec, 0);
console.log(`\n書き出し: ${path.relative(process.cwd(), OUT)}  (${total.toFixed(1)} 秒)`);
console.log(`  ${d0.toFixed(2)} m → ${dF.toFixed(2)} m (第${fin.gen}世代)`);
for (const s of shots) console.log(`  ${s.end ? 'END' : s.caption.padEnd(8)}  ${s.sec}s  ${s.sub || ''}`);
